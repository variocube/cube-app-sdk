import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import fixture from "../../../test/fixtures/controller-wire.json";
import {CubeImpl} from "../src/cube.js";
import {CubeError} from "../src/errors.js";
import type {CubeIdentity, Occupancy} from "../src/types.js";

class Socket {
	static instances: Socket[] = [];
	readyState = 0;
	onopen?: () => void;
	onclose?: (event: { type: string; code: number; reason: string }) => void;
	onmessage?: (event: { data: string }) => void;
	onerror?: () => void;
	frames: string[] = [];
	constructor(readonly url: string) {
		Socket.instances.push(this);
	}
	open() {
		this.readyState = 1;
		this.onopen?.();
	}
	close() {
		this.readyState = 3;
		this.onclose?.({type: "close", code: 1000, reason: "test"});
	}
	send(frame: string) {
		this.frames.push(frame);
	}
	event(message: object) {
		this.onmessage?.({data: `MSG000000000001${JSON.stringify(message)}`});
	}
	reply(frame: string, value?: unknown, kind = "ACK") {
		this.onmessage?.({data: `${kind}${frame.slice(3, 15)}${value === undefined ? "" : JSON.stringify(value)}`});
	}
	requests() {
		return this.frames.filter(frame => frame.startsWith("MSG"));
	}
	request(type: string) {
		const frames = this.requests().filter(frame => JSON.parse(frame.slice(15))["@type"] === type);
		const frame = frames.at(-1);
		if (!frame) throw new Error(`No ${type} request`);
		return frame;
	}
}

function occupancy(uuid = "one", changes: Partial<Occupancy> = {}): Occupancy {
	return {
		uuid,
		appId: "app-a",
		boxNumber: "1",
		accessCode: "1234",
		accessKeys: ["key"],
		created: "2026-09-12T12:00:00Z",
		content: {handover: "h1"},
		actor: "customer",
		action: "dropoff",
		state: "pending",
		...changes,
	};
}

function token(appId = "app-a", seconds = 3600): string {
	const iat = Math.floor(Date.now() / 1000);
	return `${btoa("{\"alg\":\"ES256\",\"typ\":\"JWT\",\"kid\":\"test\"}")}.${
		btoa(JSON.stringify({iss: "cube-1", sub: "cube-1", aud: appId, iat, exp: iat + seconds}))
	}.test-signature`;
}

function identity(appId: string | null = "app-a", seconds = 3600): CubeIdentity {
	return {
		cubeId: "cube-1",
		appId,
		token: appId ? token(appId, seconds) : null,
		expiresAt: appId ? Math.floor(Date.now() / 1000) + seconds : null,
	};
}

async function flush() {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

let cube: CubeImpl;
let socket: Socket;

async function ready(data: Occupancy[] = []) {
	socket.event(fixture.capabilities);
	socket.event({"@type": "cube", ...identity()});
	socket.event({"@type": "occupancies", occupancies: data});
	await flush();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
	Socket.instances = [];
	vi.stubGlobal("WebSocket", Socket);
	cube = new CubeImpl({host: "localhost", port: 4000, secondary: false});
	socket = Socket.instances[0];
	socket.open();
});

afterEach(() => {
	cube.close();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("controller wire contract", () => {
	it("pins requests and propagates the shared controller NAK unchanged", async () => {
		await ready();
		const read = cube.storage.get("missing");
		const failure = expect(read).rejects.toMatchObject({code: fixture.reply.code, message: fixture.reply.message});
		const request = socket.request("getStorageItem");
		expect(request.slice(15)).toBe(fixture.requestFrame.slice(15));
		socket.reply(request, fixture.reply, "NAK");
		await failure;
	});

	it("preserves complete occupancies and exact mutation option names", async () => {
		await ready();
		const request = {
			type: "small",
			group: "front",
			accessCodeShape: {alphabet: "123", length: 4},
			accessKeys: ["nfc"],
			content: {handover: "h1"},
			actor: "customer",
			action: "dropoff",
			cooled: true,
			accessible: true,
			charger: true,
			dangerousGoods: true,
		};
		const allocated = cube.occupancies.occupy(request);
		expect(JSON.parse(socket.request("occupyType").slice(15))).toEqual({"@type": "occupyType", ...request});
		socket.reply(socket.request("occupyType"), occupancy());
		await expect(allocated).resolves.toEqual(occupancy());
		const operations: Array<[string, Promise<unknown>, object]> = [
			["occupyBox", cube.occupancies.occupy({boxNumber: "1", content: {}}), {boxNumber: "1", content: {}}],
			["confirmOccupancy", cube.occupancies.confirm("one", {confirmed: true}, true), {
				uuid: "one",
				content: {confirmed: true},
				merge: true,
			}],
			["cancelOccupancy", cube.occupancies.cancel("one"), {uuid: "one"}],
			[
				"updateOccupancy",
				cube.occupancies.update("one", {
					content: {updated: true},
					merge: false,
					actor: "operator",
					action: "edit",
				}),
				{uuid: "one", content: {updated: true}, merge: false, actor: "operator", action: "edit"},
			],
			[
				"changeOccupancyAccess",
				cube.occupancies.changeAccess("one", {accessCode: "5678", accessKeys: ["new"], actor: "operator"}),
				{uuid: "one", accessCode: "5678", accessKeys: ["new"], actor: "operator"},
			],
			[
				"endOccupancy",
				cube.occupancies.end("one", {gracePeriod: 30, content: {done: true}, merge: true, action: "pickup"}),
				{uuid: "one", gracePeriod: 30, content: {done: true}, merge: true, action: "pickup"},
			],
		];
		for (const [type, promise, fields] of operations) {
			const frame = socket.request(type);
			expect(JSON.parse(frame.slice(15))).toEqual({"@type": type, ...fields});
			socket.reply(frame, type === "occupyBox" ? occupancy() : undefined);
			await promise;
		}
		const required = cube.requireBoxMaintenance("1");
		expect(JSON.parse(socket.request("updateBoxMaintenance").slice(15))).toEqual({
			"@type": "updateBoxMaintenance",
			boxNumber: "1",
			maintenanceRequired: true,
		});
		socket.reply(socket.request("updateBoxMaintenance"));
		await required;
		const cleared = cube.setBoxMaintenance("1", false);
		expect(JSON.parse(socket.request("updateBoxMaintenance").slice(15)).maintenanceRequired).toBe(false);
		socket.reply(socket.request("updateBoxMaintenance"));
		await cleared;
	});

	it("decodes JSON, JSON null and binary; deletion remains NOT_FOUND", async () => {
		await ready();
		for (const item of fixture.storage) {
			const read = item.encoding === "json" ? cube.storage.get(item.key) : cube.storage.getBlob(item.key);
			socket.reply(socket.request("getStorageItem"), item);
			if (item.encoding === "json") await expect(read).resolves.toEqual(item.content);
			else {
				const blob = await read as Blob;
				expect(blob.type).toBe(item.contentType);
				expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 255, 65]);
			}
		}
		expect(await (await cube.storage.getBlob("null")).text()).toBe("null");
		await expect(cube.storage.get("binary")).rejects.toMatchObject({code: "INVALID_CONTENT_TYPE"});
		socket.event({"@type": "storageItemChanged", key: "null"});
		await flush();
		const deleted = cube.storage.get("null");
		const failure = expect(deleted).rejects.toMatchObject({code: "NOT_FOUND"});
		socket.reply(socket.request("getStorageItem"), fixture.reply, "NAK");
		await failure;
	});
});

describe("authoritative state and invalidation", () => {
	it("distinguishes loading from an empty snapshot and applies lifecycle/cancellation events", async () => {
		expect(cube.occupancies.state).toEqual({status: "loading"});
		const listener = vi.fn();
		cube.addEventListener("occupancies", listener);
		await ready();
		expect(cube.occupancies.state).toEqual({status: "ready", data: []});
		for (
			const [type, value] of [["occupancyCreated", occupancy()], [
				"occupancyUpdated",
				occupancy("one", {content: {edited: true}}),
			], ["occupancyAccessChanged", occupancy("one", {accessCode: "5678", state: "confirmed"})]] as const
		) {
			socket.event({"@type": type, occupancy: value});
			await flush();
			expect(cube.occupancies.snapshot).toEqual([value]);
		}
		socket.event({"@type": "occupancyEnded", uuid: "one"});
		await flush();
		expect(cube.occupancies.snapshot).toEqual([]);
		socket.event({"@type": "occupancies", occupancies: [occupancy("replacement")]});
		await flush();
		expect(cube.occupancies.snapshot?.map(o => o.uuid)).toEqual(["replacement"]);
		cube.removeEventListener("occupancies", listener);
		const count = listener.mock.calls.length;
		socket.event(fixture.emptySnapshot);
		await flush();
		expect(listener).toHaveBeenCalledTimes(count);
	});

	it("rejects stale requests and clears all app A state before app B's empty snapshot", async () => {
		await ready([occupancy()]);
		const read = cube.storage.get("json");
		const readFailure = expect(read).rejects.toMatchObject({code: "DISCONNECTED"});
		const original = socket.request("getStorageItem");
		const mutation = cube.occupancies.end("one");
		const mutationFailure = expect(mutation).rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
		socket.event({"@type": "cube", ...identity("app-b")});
		await flush();
		await readFailure;
		await mutationFailure;
		expect(cube.identity?.appId).toBe("app-b");
		expect(cube.occupancies.state).toEqual({status: "loading"});
		socket.reply(original, fixture.storage[0]);
		socket.event(fixture.emptySnapshot);
		await flush();
		expect(cube.occupancies.state).toEqual({status: "ready", data: []});
		const next = cube.storage.get("json");
		expect(socket.request("getStorageItem")).not.toBe(original);
		socket.reply(socket.request("getStorageItem"), {...fixture.storage[0], content: {app: "b"}});
		await expect(next).resolves.toEqual({app: "b"});
	});

	it("keeps null identity unavailable and requests the controller's installed-ID diagnostic", async () => {
		await ready();
		socket.event({"@type": "cube", ...identity(null)});
		socket.event(fixture.emptySnapshot);
		await flush();
		expect(cube.identity).toEqual(identity(null));
		expect(cube.occupancies.state).toMatchObject({status: "unavailable", error: {code: "APP_NOT_CONFIGURED"}});
		expect(cube.occupancies.snapshot).toBeUndefined();
		const query = cube.occupancies.list();
		const failure = expect(query).rejects.toMatchObject({
			code: "APP_NOT_CONFIGURED",
			message: "Expected one installed app; installed IDs: [a, b]",
		});
		socket.reply(socket.request("getOccupancies"), {
			title: "App not configured",
			status: 409,
			code: "APP_NOT_CONFIGURED",
			message: "Expected one installed app; installed IDs: [a, b]",
		}, "NAK");
		await failure;
	});

	it("discards storage responses invalidated during the read and shares current reads", async () => {
		await ready();
		const old = cube.storage.get("json");
		const stale = expect(old).rejects.toMatchObject({code: "STALE_RESPONSE"});
		const oldFrame = socket.request("getStorageItem");
		socket.event(fixture.invalidation);
		await flush();
		const current = cube.storage.get("json");
		const shared = cube.storage.get("json");
		expect(socket.requests().filter(f => JSON.parse(f.slice(15))["@type"] === "getStorageItem")).toHaveLength(2);
		socket.reply(socket.request("getStorageItem"), {...fixture.storage[0], content: {value: 43}});
		socket.reply(oldFrame, fixture.storage[0]);
		await stale;
		await expect(current).resolves.toEqual({value: 43});
		await expect(shared).resolves.toEqual({value: 43});
		await expect(cube.storage.get("json")).resolves.toEqual({value: 43});
	});

	it("rejects a cached JSON/blob read when invalidation or close runs before its continuation", async () => {
		await ready();
		const seed = cube.storage.get("json");
		socket.reply(socket.request("getStorageItem"), fixture.storage[0]);
		await seed;
		// Queue invalidation before beginning the cached read, so it executes before the await continuation.
		socket.event(fixture.invalidation);
		const stale = cube.storage.get("json");
		await expect(stale).rejects.toMatchObject({code: "STALE_RESPONSE"});
		const reload = cube.storage.get("json");
		socket.reply(socket.request("getStorageItem"), fixture.storage[0]);
		await reload;
		const cachedJson = cube.storage.get("json");
		const cachedBlob = cube.storage.getBlob("json");
		const rejectedJson = expect(cachedJson).rejects.toMatchObject({code: "DISCONNECTED"});
		const rejectedBlob = expect(cachedBlob).rejects.toMatchObject({code: "DISCONNECTED"});
		cube.close();
		await rejectedJson;
		await rejectedBlob;
	});

	it("does not let an older list reply replace a newer event snapshot", async () => {
		await ready();
		const list = cube.occupancies.list();
		socket.event({"@type": "occupancyCreated", occupancy: occupancy()});
		await flush();
		socket.reply(socket.request("getOccupancies"), []);
		await list;
		expect(cube.occupancies.snapshot).toEqual([occupancy()]);
	});
});

describe("connection, capabilities and unknown outcomes", () => {
	it("marks an old controller unsupported at 5 seconds, keeps hardware, and accepts late capabilities", async () => {
		const query = cube.occupancies.list();
		const unsupported = expect(query).rejects.toMatchObject({code: "UNSUPPORTED"});
		expect(socket.requests()).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(4999);
		expect(cube.occupancies.state.status).toBe("loading");
		await vi.advanceTimersByTimeAsync(1);
		await unsupported;
		expect(cube.storage.state).toMatchObject({status: "unavailable", error: {code: "UNSUPPORTED"}});
		const hardware = cube.openLock("board:1");
		socket.reply(socket.request("openLock"));
		await hardware;
		await ready();
		expect(cube.occupancies.state).toEqual({status: "ready", data: []});
	});

	it("does not route extension commands to a mock-only service", async () => {
		socket.event({"@type": "availability", connected: false});
		await flush();
		await expect(cube.occupancies.occupyBox({boxNumber: "1"})).rejects.toMatchObject({code: "DISCONNECTED"});
		await expect(cube.storage.keys()).rejects.toMatchObject({code: "DISCONNECTED"});
		expect(socket.requests()).toHaveLength(0);
	});

	it("times out a sent mutation as unknown without replaying it, and queries as TIMEOUT", async () => {
		await ready();
		const mutation = cube.occupancies.occupyBox({boxNumber: "1", content: {handover: "reconcile-me"}});
		const unknown = expect(mutation).rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
		const query = cube.storage.keys();
		const timeout = expect(query).rejects.toMatchObject({code: "TIMEOUT"});
		await vi.advanceTimersByTimeAsync(10000);
		await unknown;
		await timeout;
		socket.reply(socket.request("occupyBox"), occupancy());
		socket.event({"@type": "availability", connected: false});
		await flush();
		socket.event({"@type": "availability", connected: true});
		await flush();
		await ready([occupancy()]);
		expect(socket.requests().filter(f => JSON.parse(f.slice(15))["@type"] === "occupyBox")).toHaveLength(1);
		expect(cube.occupancies.snapshot).toEqual([occupancy()]);
	});

	it("treats a malformed ACK for a sent mutation as an unknown outcome", async () => {
		await ready();
		const mutation = cube.occupancies.end("one");
		const failure = expect(mutation).rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
		socket.onmessage?.({data: `ACK${socket.request("endOccupancy").slice(3, 15)}{broken-json`});
		await failure;
	});

	it("clears state on controller disconnect and suppresses events from a closed socket after reconnect", async () => {
		await ready([occupancy()]);
		const pending = cube.openLock("board:1");
		const unknown = expect(pending).rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
		const oldSocket = socket;
		socket.close();
		await unknown;
		expect(cube.identity).toBeUndefined();
		expect(cube.occupancies.snapshot).toBeUndefined();
		expect(cube.occupancies.state.status).toBe("unavailable");
		await vi.advanceTimersByTimeAsync(10000);
		socket = Socket.instances[1];
		socket.open();
		await ready();
		oldSocket.event({"@type": "occupancies", occupancies: [occupancy("stale")]});
		oldSocket.event({"@type": "cube", ...identity("old-app")});
		await flush();
		expect(cube.identity?.appId).toBe("app-a");
		expect(cube.occupancies.snapshot).toEqual([]);
	});
});

describe("app tokens", () => {
	it("uses fresh cached tokens, deduplicates refreshes at 300 seconds, and accepts proactive renewal", async () => {
		await ready();
		await expect(cube.getToken()).resolves.toBe(identity().token);
		expect(socket.requests()).toHaveLength(0);
		socket.event({"@type": "cube", ...identity("app-a", 300)});
		await flush();
		const first = cube.getToken();
		const second = cube.getToken();
		expect(first).toBe(second);
		expect(JSON.parse(socket.request("getToken").slice(15))).toEqual({"@type": "getToken"});
		socket.reply(socket.request("getToken"), token());
		await expect(first).resolves.toBe(token());
		expect(cube.identity?.expiresAt).toBe(Math.floor(Date.now() / 1000) + 3600);
		const renewed = identity("app-a", 3500);
		socket.event({"@type": "cube", ...renewed});
		await flush();
		await expect(cube.getToken()).resolves.toBe(renewed.token);
		expect(socket.requests()).toHaveLength(1);
	});

	it("rejects refresh failures and expired/wrong-audience replies without returning cached stale credentials", async () => {
		await ready();
		socket.event({"@type": "cube", ...identity("app-a", 10)});
		await flush();
		for (const invalid of [token("app-a", 0), token("other-app"), "malformed"]) {
			const refresh = cube.getToken();
			const failure = expect(refresh).rejects.toMatchObject({code: "INVALID_RESPONSE"});
			socket.reply(socket.request("getToken"), invalid);
			await failure;
		}
		const refresh = cube.getToken();
		const failed = expect(refresh).rejects.toBeInstanceOf(CubeError);
		socket.reply(socket.request("getToken"), fixture.reply, "NAK");
		await failed;
	});

	it("rejects a cached token when disconnect precedes the promise continuation", async () => {
		await ready();
		const cached = cube.getToken();
		const failure = expect(cached).rejects.toMatchObject({code: "DISCONNECTED"});
		cube.close();
		await failure;
	});

	it.each(["synchronous close", "queued close", "queued app switch"])(
		"rejects refresh results invalidated by an identity listener: %s",
		async action => {
			await ready();
			socket.event({"@type": "cube", ...identity("app-a", 10)});
			await flush();
			const refreshed = token();
			const listener = (event: { identity: CubeIdentity | undefined }) => {
				if (event.identity?.token !== refreshed) return;
				cube.removeEventListener("identity", listener);
				if (action === "synchronous close") cube.close();
				else if (action === "queued close") queueMicrotask(() => cube.close());
				else socket.event({"@type": "cube", ...identity("app-b")});
			};
			cube.addEventListener("identity", listener);
			const refresh = cube.getToken();
			const shared = cube.getToken();
			expect(shared).toBe(refresh);
			const failure = expect(refresh).rejects.toMatchObject({code: "DISCONNECTED"});
			socket.reply(socket.request("getToken"), refreshed);
			await failure;
			if (action === "queued app switch") {
				expect(cube.identity?.appId).toBe("app-b");
				await expect(cube.getToken()).resolves.toBe(identity("app-b").token);
			}
			else expect(cube.identity).toBeUndefined();
		},
	);

	it("discards an app A token refresh after switching to app B", async () => {
		await ready();
		socket.event({"@type": "cube", ...identity("app-a", 10)});
		await flush();
		const old = cube.getToken();
		const failure = expect(old).rejects.toMatchObject({code: "DISCONNECTED"});
		const frame = socket.request("getToken");
		socket.event({"@type": "cube", ...identity("app-b")});
		await flush();
		socket.reply(frame, token("app-a"));
		await failure;
		await expect(cube.getToken()).resolves.toBe(identity("app-b").token);
	});
});
