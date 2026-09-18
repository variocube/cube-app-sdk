import type {CubeMessage, OccupanciesMessage, Occupancy} from "@variocube/cube-app-sdk";
import {VcmpError, type VcmpMessage} from "@variocube/vcmp";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import fixture from "../../../test/fixtures/controller-wire.json";
import {ControllerRelay, extensionCommands} from "./controllerRelay";
import type {CapabilitiesMessage} from "./legacy";

const capabilities: CapabilitiesMessage = {...fixture.capabilities, "@type": "capabilities"};
const identity: CubeMessage = {
	"@type": "cube",
	cubeId: "test-cube",
	appId: "app-a",
	token: "secret-token-a",
	expiresAt: 2000000000,
};
const occupancy: Occupancy = {
	uuid: "occ-a",
	appId: "app-a",
	boxNumber: "1",
	state: "pending",
	accessCode: "1234",
	accessKeys: ["key"],
	created: "2026-09-12T00:00:00Z",
	content: {handover: "handover-a"},
	actor: null,
	action: null,
};

function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error("Promise not initialized");
	};
	const promise = new Promise<T>(success => {
		resolve = success;
	});
	return {promise, resolve};
}

function setup(ready = true) {
	const send = vi.fn<(message: VcmpMessage) => Promise<unknown>>().mockResolvedValue(undefined);
	const broadcast = vi.fn<(message: VcmpMessage) => void>();
	const relay = new ControllerRelay({send, broadcast});
	relay.open();
	if (ready) {
		relay.capabilities(capabilities);
		relay.identity(identity);
		relay.snapshot({"@type": "occupancies", occupancies: []});
	}
	return {relay, send, broadcast};
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe("controller relay", () => {
	it("relays every extension's return value and preserves the controller's problem envelope", async () => {
		const {relay, send} = setup();
		for (const type of Object.keys(extensionCommands)) {
			const result = type === "getToken" ? "secret-token" : {result: type};
			send.mockResolvedValueOnce(result);
			await expect(relay.request({"@type": type})).resolves.toEqual(result);
		}
		send.mockRejectedValueOnce(
			new VcmpError(fixture.reply as unknown as ConstructorParameters<typeof VcmpError>[0]),
		);
		const error = await relay.request({"@type": "getStorageItem"}).catch(error => error);
		expect(JSON.parse(JSON.stringify(error))).toEqual(fixture.reply);
	});

	it("waits at most five seconds for capabilities and accepts a late upgrade", async () => {
		const {relay, send, broadcast} = setup(false);
		const pending = relay.request({"@type": "getStorageKeys"});
		const rejected = expect(pending).rejects.toMatchObject({code: "UNSUPPORTED"});
		await vi.advanceTimersByTimeAsync(4999);
		expect(send).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		await rejected;
		expect(broadcast).toHaveBeenLastCalledWith({
			"@type": "capabilities",
			occupancies: false,
			storage: false,
			identity: false,
		});
		// Hardware retains the board-trust model on controllers without extensions.
		await expect(relay.request({"@type": "openLock"}, true)).resolves.toBeUndefined();
		relay.capabilities(capabilities);
		send.mockResolvedValueOnce(["key"]);
		await expect(relay.request({"@type": "getStorageKeys"})).resolves.toEqual(["key"]);
	});

	it("rejects unsent calls on disconnect and never dispatches them after reconnect", async () => {
		const {relay, send} = setup(false);
		const rejected = expect(relay.request({"@type": "occupyBox"})).rejects.toMatchObject({code: "DISCONNECTED"});
		relay.close();
		await rejected;
		relay.open();
		relay.capabilities(capabilities);
		expect(send).not.toHaveBeenCalled();
	});

	it.each(["occupyBox", "openLock", "endOccupancy"])(
		"reports unknown outcome for lost %s reply without replay",
		async type => {
			const {relay, send} = setup();
			const response = deferred<unknown>();
			send.mockReturnValueOnce(response.promise);
			const rejected = expect(relay.request({"@type": type}, type === "openLock"))
				.rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
			await vi.advanceTimersByTimeAsync(10000);
			await rejected;
			response.resolve(occupancy);
			relay.close();
			relay.open();
			relay.capabilities(capabilities);
			await vi.advanceTimersByTimeAsync(10000);
			expect(send).toHaveBeenCalledTimes(1);
		},
	);

	it("times out reads separately from mutations", async () => {
		const {relay, send} = setup();
		send.mockReturnValueOnce(new Promise(() => undefined));
		const rejected = expect(relay.request({"@type": "getStorageKeys"})).rejects.toMatchObject({code: "TIMEOUT"});
		await vi.advanceTimersByTimeAsync(10000);
		await rejected;
	});

	it("treats an unreadable mutation ACK as unknown outcome", async () => {
		const {relay, send} = setup();
		send.mockRejectedValueOnce(
			new VcmpError({
				title: "Invalid acknowledgement",
				status: 500,
				detail: "The ACK payload could not be parsed.",
			}),
		);
		await expect(relay.request({"@type": "occupyBox"}))
			.rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
	});

	it("clears app A, rejects pending requests, and suppresses late results when app B is installed", async () => {
		const {relay, send, broadcast} = setup();
		relay.snapshot({"@type": "occupancies", occupancies: [occupancy]});
		const read = deferred<unknown>();
		const mutation = deferred<unknown>();
		send.mockReturnValueOnce(read.promise).mockReturnValueOnce(mutation.promise);
		const readRejected = expect(relay.request({"@type": "getToken"})).rejects.toMatchObject({code: "DISCONNECTED"});
		const mutationRejected = expect(relay.request({"@type": "occupyBox"}))
			.rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
		relay.identity({...identity, appId: "app-b", token: "secret-token-b"});
		await Promise.all([readRejected, mutationRejected]);
		expect(relay.initialMessages.map(message => message["@type"])).toEqual([
			"availability",
			"capabilities",
			"cube",
		]);
		read.resolve("secret-token-a");
		mutation.resolve(occupancy);
		const count = broadcast.mock.calls.length;
		relay.occupancyChanged({"@type": "occupancyCreated", occupancy});
		expect(broadcast.mock.calls.length).toBe(count);
		// App A's entry is filtered out of the snapshot rather than dropping the whole snapshot, so
		// app B learns it has no occupancies instead of keeping whatever it last saw.
		relay.snapshot({"@type": "occupancies", occupancies: [occupancy]});
		expect(broadcast).toHaveBeenLastCalledWith(fixture.emptySnapshot);
		expect(relay.initialMessages.at(-1)).toEqual(fixture.emptySnapshot);
		relay.snapshot({"@type": "occupancies", occupancies: []});
		expect(relay.initialMessages.at(-1)).toEqual(fixture.emptySnapshot);
	});

	it("keeps a mixed snapshot, relaying only the installed app's entries", () => {
		const {relay, broadcast} = setup();
		const foreign: Occupancy = {...occupancy, uuid: "occ-b", appId: "app-b"};
		relay.snapshot({"@type": "occupancies", occupancies: [occupancy, foreign]});
		// A foreign entry filters out; it must not discard the whole snapshot and strand attached
		// apps on a stale list, and the relayed snapshot must not leak the other app's occupancy.
		const expected = {"@type": "occupancies", occupancies: [occupancy]};
		expect(broadcast).toHaveBeenLastCalledWith(expected);
		expect(relay.initialMessages.at(-1)).toEqual(expected);
	});

	it("scopes an end, which carries no appId, to the installed app's snapshot", () => {
		const {relay, broadcast} = setup();
		relay.snapshot({"@type": "occupancies", occupancies: [occupancy]});
		const count = broadcast.mock.calls.length;
		relay.occupancyChanged({"@type": "occupancyEnded", uuid: "occ-b"});
		expect(broadcast.mock.calls.length).toBe(count);
		relay.occupancyChanged({"@type": "occupancyEnded", uuid: occupancy.uuid});
		expect(broadcast).toHaveBeenLastCalledWith({"@type": "occupancyEnded", uuid: occupancy.uuid});
		expect(relay.initialMessages.at(-1)).toEqual(fixture.emptySnapshot);
	});

	it("replaces snapshots and upserts pending, confirmed, updated and access changes; cancellation removes reservations", () => {
		const {relay, broadcast} = setup();
		relay.occupancyChanged({"@type": "occupancyCreated", occupancy});
		const confirmed = {...occupancy, state: "confirmed" as const};
		relay.occupancyChanged({"@type": "occupancyCreated", occupancy: confirmed});
		const updated = {...confirmed, content: {updated: true}};
		relay.occupancyChanged({"@type": "occupancyUpdated", occupancy: updated});
		const changedAccess = {...updated, accessCode: "5678"};
		relay.occupancyChanged({"@type": "occupancyAccessChanged", occupancy: changedAccess});
		expect(relay.initialMessages.at(-1)).toEqual({"@type": "occupancies", occupancies: [changedAccess]});
		relay.occupancyChanged({"@type": "occupancyEnded", uuid: occupancy.uuid});
		expect(relay.initialMessages.at(-1)).toEqual(fixture.emptySnapshot);
		relay.snapshot({"@type": "occupancies", occupancies: [occupancy]});
		relay.snapshot({"@type": "occupancies", occupancies: []});
		expect((relay.initialMessages.at(-1) as OccupanciesMessage).occupancies).toEqual([]);
		expect(broadcast.mock.calls.slice(4).map(([message]) => message["@type"])).toEqual([
			"occupancyCreated",
			"occupancyCreated",
			"occupancyUpdated",
			"occupancyAccessChanged",
			"occupancyEnded",
			"occupancies",
			"occupancies",
		]);
	});

	it("retains no identity or snapshot after disconnect and ignores disconnected events", () => {
		const {relay, broadcast} = setup();
		relay.close();
		expect(relay.initialMessages).toEqual([{"@type": "availability", connected: false}]);
		const count = broadcast.mock.calls.length;
		relay.identity(identity);
		relay.snapshot({"@type": "occupancies", occupancies: [occupancy]});
		relay.storageChanged({"@type": "storageItemChanged"});
		relay.capabilities(capabilities);
		expect(broadcast.mock.calls.length).toBe(count);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("retains the controller's diagnostic when no single app is configured", async () => {
		const {relay, send} = setup();
		relay.identity({...identity, appId: null, token: null, expiresAt: null});
		send.mockRejectedValueOnce(
			new VcmpError({
				title: "App not configured",
				status: 409,
				code: "APP_NOT_CONFIGURED",
				detail: "Expected exactly one installed app; installed IDs: [app-a, app-b]",
			}),
		);
		await expect(relay.request({"@type": "getOccupancies"})).rejects.toMatchObject({
			code: "APP_NOT_CONFIGURED",
			message: "Expected exactly one installed app; installed IDs: [app-a, app-b]",
		});
		expect(relay.initialMessages.at(-1)).toEqual({...identity, appId: null, token: null, expiresAt: null});
	});
});
