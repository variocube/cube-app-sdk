import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import fixture from "../../../test/fixtures/controller-wire.json";
import {CubeImpl} from "../src/cube.js";
import {CubeError} from "../src/errors.js";
import {ControllerSession} from "../src/session.js";
import type {CubeIdentity, Occupancy, StorageItem} from "../src/types.js";

class Socket {
	static instances: Socket[] = [];
	readyState = 0;
	onopen?: () => void;
	onclose?: (event: { type: string; code: number; reason: string }) => void;
	onmessage?: (event: { data: string }) => void;
	onerror?: () => void;
	frames: string[] = [];
	revision = 0;
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
		this.onmessage?.({
			data: `MSG000000000001${JSON.stringify({generation: 1, revision: ++this.revision, ...message})}`,
		});
	}
	reply(frame: string, value?: unknown, kind = "ACK") {
		if (kind === "ACK") value = {generation: 1, revision: this.revision, result: value};
		this.onmessage?.({data: `${kind}${frame.slice(3, 15)}${value === undefined ? "" : JSON.stringify(value)}`});
	}
	requests() {
		return this.frames.filter(frame =>
			frame.startsWith("MSG") && JSON.parse(frame.slice(15))["@type"] !== "authenticate"
		);
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

async function authenticate(protocolMajor = 6) {
	await flush();
	const frame = socket.frames.find(frame =>
		frame.startsWith("MSG") && JSON.parse(frame.slice(15))["@type"] === "authenticate"
	);
	if (!frame) throw new Error("Missing authentication frame");
	socket.onmessage?.({data: `ACK${frame.slice(3, 15)}${JSON.stringify({protocolMajor, generation: 1})}`});
	await flush();
}

function initial(data: Occupancy[] = [], revision = 0) {
	socket.event({
		"@type": "initialState",
		revision,
		generation: 1,
		identity: identity(),
		compartments: [],
		devices: [],
		occupancies: data,
	});
	socket.revision = revision;
}
async function ready(data: Occupancy[] = [], items: StorageItem[] = fixture.storage as StorageItem[]) {
	await authenticate();
	initial(data);
	for (const item of items) socket.event({"@type": "storageItem", ...item});
	socket.event({"@type": "ready"});
	await flush();
}
function chunks(item: StorageItem, size = 48 * 1024) {
	const bytes = new TextEncoder().encode(JSON.stringify(item));
	const total = Math.ceil(bytes.length / size);
	for (let index = 0; index < total; index++) {
		const part = bytes.slice(index * size, (index + 1) * size);
		socket.event({
			"@type": "storageChunk",
			key: item.key,
			index,
			total,
			content: btoa(String.fromCharCode(...part)),
		});
	}
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
	Socket.instances = [];
	vi.stubGlobal("WebSocket", Socket);
	cube = new CubeImpl({
		session: new ControllerSession("http://localhost:9000", fetch, {
			credential: "test-credential-123456",
			expiresAt: Math.floor(Date.now() / 1000) + 600,
			generation: 1,
		}),
	});
	socket = Socket.instances[0];
	socket.open();
});

afterEach(() => {
	for (const current of Socket.instances) {
		for (const frame of current.requests()) expect(JSON.parse(frame.slice(15))["@type"]).not.toMatch(/^get/);
	}
	cube.close();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("pushed state and local reads", () => {
	it("waits for the storage barrier and reads JSON, null, binary and missing keys without requests", async () => {
		await authenticate();
		initial([occupancy()]);
		await flush();
		expect(cube.state.status).toBe("initializing");
		await expect(cube.storage.keys()).rejects.toMatchObject({code: "NOT_READY"});
		for (const item of fixture.storage) socket.event({"@type": "storageItem", ...item});
		socket.event({"@type": "ready"});
		await flush();
		expect(cube.state.status).toBe("ready");
		await expect(cube.storage.keys()).resolves.toEqual(["binary", "json", "null"]);
		await expect(cube.storage.get("json")).resolves.toEqual(fixture.storage[0].content);
		await expect(cube.storage.get("null")).resolves.toBeNull();
		const blob = await cube.storage.getBlob("binary");
		expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 255, 65]);
		expect(await (await cube.storage.getBlob("null")).text()).toBe("null");
		await expect(cube.storage.get("binary")).rejects.toMatchObject({code: "INVALID_CONTENT_TYPE"});
		await expect(cube.storage.get("missing")).rejects.toMatchObject({code: "NOT_FOUND"});
		await expect(cube.occupancies.get("missing")).rejects.toMatchObject({code: "NOT_FOUND"});
		await expect(cube.occupancies.list("key")).resolves.toEqual([occupancy()]);
		await expect(cube.occupancies.list("1234")).resolves.toEqual([occupancy()]);
		await expect(cube.occupancies.list("other")).resolves.toEqual([]);
		const copy = await cube.storage.get<{ value: number }>("json");
		copy.value = 999;
		await expect(cube.storage.get("json")).resolves.toEqual(fixture.storage[0].content);
		expect(socket.requests()).toEqual([]);
	});

	it("assembles chunked UTF8 values atomically and applies replacement and deletion pushes", async () => {
		await ready();
		const value = {
			key: "large",
			contentType: "application/json",
			encoding: "json",
			content: {text: "å☃".repeat(50000)},
		} satisfies StorageItem;
		chunks(value);
		await flush();
		await expect(cube.storage.get("large")).resolves.toEqual(value.content);
		socket.event({
			"@type": "storageItem",
			key: "json",
			contentType: "application/json",
			encoding: "json",
			content: null,
		});
		socket.event({"@type": "storageItemRemoved", key: "large"});
		await flush();
		await expect(cube.storage.get("json")).resolves.toBeNull();
		await expect(cube.storage.get("large")).rejects.toMatchObject({code: "NOT_FOUND"});
		expect(socket.requests()).toEqual([]);
	});

	it("replaces a same-generation snapshot at ready without rejecting an in-flight mutation", async () => {
		await ready([occupancy()]);
		const command = cube.occupancies.end("one");
		initial([occupancy("replacement")], socket.revision + 1);
		await flush();
		await expect(cube.storage.get("json")).rejects.toMatchObject({code: "NOT_READY"});
		socket.event({
			"@type": "storageItem",
			key: "new",
			contentType: "application/json",
			encoding: "json",
			content: {ok: true},
		});
		socket.event({"@type": "ready"});
		await flush();
		socket.reply(socket.request("endOccupancy"));
		await command;
		await expect(cube.storage.keys()).resolves.toEqual(["new"]);
		await expect(cube.occupancies.list()).resolves.toEqual([occupancy("replacement")]);
	});

	it("applies lifecycle upserts and removals before subsequent local reads", async () => {
		await ready();
		for (const type of ["occupancyCreated", "occupancyUpdated", "occupancyAccessChanged"]) {
			socket.event({"@type": type, occupancy: occupancy("one", {content: {type}})});
			await flush();
			await expect(cube.occupancies.get("one")).resolves.toMatchObject({content: {type}});
		}
		socket.event({"@type": "occupancyEnded", uuid: "one"});
		await flush();
		await expect(cube.occupancies.list()).resolves.toEqual([]);
		await expect(cube.occupancies.get("one")).rejects.toMatchObject({code: "NOT_FOUND"});
	});

	it.each(["duplicate", "out of order", "wrong key", "oversized", "truncated"])(
		"rejects %s storage chunks without retaining partial data",
		async kind => {
			await authenticate();
			initial();
			await flush();
			const part = {"@type": "storageChunk", key: "key", index: 0, total: 2, content: btoa("{")};
			socket.event(part);
			if (kind === "duplicate") socket.event(part);
			if (kind === "out of order") socket.event({...part, index: 2});
			if (kind === "wrong key") socket.event({...part, index: 1, key: "other"});
			if (kind === "oversized") socket.event({...part, index: 1, content: btoa("x".repeat(48 * 1024 + 1))});
			if (kind === "truncated") socket.event({"@type": "ready"});
			await flush();
			expect(cube.state.status).toBe("error");
			await expect(cube.storage.get("key")).rejects.toMatchObject({code: "DISCONNECTED"});
		},
	);

	it("bounds incomplete transfers and never reports an incomplete snapshot ready", async () => {
		await authenticate();
		initial();
		socket.event({"@type": "storageChunk", key: "key", index: 0, total: 2, content: btoa("{")});
		await flush();
		await vi.advanceTimersByTimeAsync(10000);
		expect(cube.state).toMatchObject({status: "error", error: {code: "TIMEOUT"}});
	});

	it("retains more than the former 128 cached values and rejects oversized values without partial readiness", async () => {
		const items = Array.from(
			{length: 150},
			(_, index) =>
				({
					key: `k${index}`,
					contentType: "application/json",
					encoding: "json",
					content: index,
				}) satisfies StorageItem,
		);
		await ready([], items);
		await expect(cube.storage.keys()).resolves.toHaveLength(150);
		await expect(cube.storage.get("k0")).resolves.toBe(0);
		socket.event({
			"@type": "storageItem",
			key: "oversize",
			contentType: "application/json",
			encoding: "json",
			content: "x".repeat(1048576 + 4096),
		});
		await flush();
		expect(cube.state).toMatchObject({status: "error", error: {code: "LIMIT_EXCEEDED"}});
	});

	it("redacts malformed serialized storage and rejects inconsistent chunk keys", async () => {
		await ready();
		socket.event({
			"@type": "storageChunk",
			key: "bad",
			index: 0,
			total: 1,
			content: btoa("{\"private\":\"sensitive-payload\" BROKEN}"),
		});
		await flush();
		expect(cube.state).toMatchObject({status: "error", error: {code: "INVALID_RESPONSE"}});
		expect(cube.state.error?.message).not.toContain("sensitive-payload");
	});

	it("clears cached data on disconnect before asynchronous reads settle", async () => {
		await ready([occupancy()]);
		const reads = [
			cube.storage.get("json"),
			cube.storage.keys(),
			cube.occupancies.list(),
			cube.occupancies.get("one"),
			cube.getToken(),
		];
		const failures = reads.map(read => expect(read).rejects.toMatchObject({code: "DISCONNECTED"}));
		cube.close();
		await Promise.all(failures);
		expect(cube.identity).toBeUndefined();
		expect(cube.occupancies.snapshot).toBeUndefined();
	});
});

describe("commands and authentication", () => {
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

	it("propagates mutation NAK and never retries unknown physical outcomes", async () => {
		await ready();
		const rejected = cube.openLock("one");
		const failure = expect(rejected).rejects.toMatchObject({
			code: fixture.reply.code,
			message: fixture.reply.message,
		});
		socket.reply(socket.request("openLock"), fixture.reply, "NAK");
		await failure;
		const mutation = cube.occupancies.occupyBox({boxNumber: "1"});
		const unknown = expect(mutation).rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
		await vi.advanceTimersByTimeAsync(10000);
		await unknown;
		expect(socket.requests()).toHaveLength(2);
		expect(Socket.instances[1].requests()).toEqual([]);
	});

	it.each([
		{status: 503, title: "Session closed before ack"},
		{status: 503, title: "Service Unavailable"},
	])("treats uncoded transport NAK before socket close as unknown: $title", async problem => {
		await ready();
		const command = cube.openLock("one");
		const failure = expect(command).rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
		socket.reply(socket.request("openLock"), problem, "NAK");
		await failure;
		expect(socket.readyState).toBe(1);
		expect(socket.requests()).toHaveLength(1);
		socket.close();
		await vi.advanceTimersByTimeAsync(10000);
		expect(Socket.instances.flatMap(client => client.requests())).toHaveLength(1);
	});

	it.each(["OVERLOADED", "UNAVAILABLE", "COMMAND_OUTCOME_UNKNOWN"])(
		"preserves explicit controller 503 code %s",
		async code => {
			await ready();
			const command = cube.openLock("one");
			const failure = expect(command).rejects.toMatchObject({code, message: "controller rejection"});
			socket.reply(socket.request("openLock"), {
				status: 503,
				title: "controller rejection",
				detail: "controller rejection",
				code,
			}, "NAK");
			await failure;
			expect(socket.requests()).toHaveLength(1);
		},
	);

	it("accepts protected state only after authentication and the full ready barrier", async () => {
		await flush();
		initial();
		socket.event({"@type": "ready"});
		await flush();
		expect(cube.identity).toBeUndefined();
		await expect(cube.openLock("one")).rejects.toMatchObject({code: "NOT_READY"});
		await authenticate();
		expect(cube.state.status).toBe("ready");
	});

	it("rejects incompatible authentication and bounded duplicate initial publications", async () => {
		await authenticate(5);
		expect(cube.state).toMatchObject({status: "error", error: {code: "PROTOCOL_MISMATCH"}});
	});
	it("rejects duplicate initial publications while storage is loading", async () => {
		await flush();
		initial();
		initial();
		await flush();
		expect(cube.state).toMatchObject({status: "error", error: {code: "LIMIT_EXCEEDED"}});
	});

	it("accepts a repeated ready barrier without announcing another connection", async () => {
		const opened = vi.fn();
		cube.addEventListener("open", opened);
		await ready();
		socket.event({"@type": "ready"});
		await flush();
		expect(opened).toHaveBeenCalledTimes(1);
	});

	it("resynchronizes revision gaps and discards closed-socket state", async () => {
		await ready([occupancy()]);
		const old = socket;
		socket.event({"@type": "occupancyEnded", uuid: "one", revision: 99});
		await flush();
		expect(cube.state.status).toBe("initializing");
		expect(cube.occupancies.snapshot).toBeUndefined();
		socket = Socket.instances[1];
		socket.open();
		await ready();
		old.event({"@type": "storageItem", ...fixture.storage[0], content: "stale"});
		await flush();
		await expect(cube.storage.get("json")).resolves.toEqual(fixture.storage[0].content);
	});

	it("revokes cached state and uncertain commands when the installed app changes", async () => {
		await ready([occupancy()]);
		const command = cube.occupancies.end("one");
		const failure = expect(command).rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
		socket.event({"@type": "cube", ...identity("other")});
		await flush();
		await failure;
		expect(cube.identity).toBeUndefined();
		expect(cube.state).toMatchObject({status: "unavailable", error: {code: "AUTHENTICATION_REQUIRED"}});
	});
});

describe("pushed app tokens", () => {
	it("returns only the current pushed token, including rotation below the former refresh threshold", async () => {
		await ready();
		await expect(cube.getToken()).resolves.toBe(identity().token);
		const rotated = identity("app-a", 250);
		socket.event({"@type": "cube", ...rotated});
		await flush();
		await expect(cube.getToken()).resolves.toBe(rotated.token);
		expect(socket.requests()).toEqual([]);
	});

	it.each(["expired", "audience", "malformed", "expiry mismatch"])(
		"rejects %s cached tokens without sending refresh requests",
		async kind => {
			await ready();
			const invalid = {
				...identity(),
				token: kind === "expired"
					? token("app-a", 0)
					: kind === "audience"
					? token("other")
					: kind === "malformed"
					? "bad"
					: token("app-a", 100),
			};
			socket.event({"@type": "cube", ...invalid});
			await flush();
			await expect(cube.getToken()).rejects.toBeInstanceOf(CubeError);
			expect(socket.requests()).toEqual([]);
		},
	);
});
