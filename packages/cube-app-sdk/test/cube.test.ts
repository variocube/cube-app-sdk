import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import fixture from "../../../test/fixtures/controller-wire.json";
import {CubeImpl} from "../src/cube.js";
import {CubeError} from "../src/errors.js";
import type {CubeMessageIdentity, StorageItem} from "../src/messages.js";
import {ControllerSessionImpl as ControllerSession} from "../src/session.js";
import type {Occupancy} from "../src/types.js";

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

function identity(appId: string | null = "app-a", seconds = 3600): CubeMessageIdentity {
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
		expect(cube.connection.status).toBe("initializing");
		expect(() => cube.storage.keys()).toThrow(expect.objectContaining({code: "NOT_READY"}));
		for (const item of fixture.storage) socket.event({"@type": "storageItem", ...item});
		socket.event({"@type": "ready"});
		await flush();
		expect(cube.connection.status).toBe("ready");
		expect(cube.storage.keys()).toEqual(["binary", "json", "null"]);
		expect(cube.storage.get("json")).toEqual(fixture.storage[0].content);
		expect(cube.storage.get("null")).toBeNull();
		const blob = cube.storage.getBlob("binary");
		expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([0, 255, 65]);
		expect(await cube.storage.getBlob("null")!.text()).toBe("null");
		expect(cube.storage.getBlob("missing")).toBeUndefined();
		expect(() => cube.storage.get("binary")).toThrow(expect.objectContaining({code: "INVALID_CONTENT_TYPE"}));
		expect(cube.storage.get("missing")).toBeUndefined();
		expect(cube.occupancies.get("missing")).toBeUndefined();
		expect(cube.occupancies.list("key")).toEqual([occupancy()]);
		expect(cube.occupancies.list("1234")).toEqual([occupancy()]);
		expect(cube.occupancies.list("other")).toEqual([]);
		const copy = cube.storage.get<{ value: number }>("json");
		copy!.value = 999;
		expect(cube.storage.get("json")).toEqual(fixture.storage[0].content);
		expect(cube.storage.get("json", value => Object.keys(value as object))).toEqual(
			Object.keys(fixture.storage[0].content as object),
		);
		expect(() =>
			cube.storage.get("json", () => {
				throw new CubeError("INVALID_RESPONSE", "rejected by the app's parser");
			})
		).toThrow(expect.objectContaining({code: "INVALID_RESPONSE"}));
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
		expect(cube.storage.get("large")).toEqual(value.content);
		socket.event({
			"@type": "storageItem",
			key: "json",
			contentType: "application/json",
			encoding: "json",
			content: null,
		});
		socket.event({"@type": "storageItemRemoved", key: "large"});
		await flush();
		expect(cube.storage.get("json")).toBeNull();
		expect(cube.storage.get("large")).toBeUndefined();
		expect(socket.requests()).toEqual([]);
	});

	it("replaces a same-generation snapshot at ready without rejecting an in-flight mutation", async () => {
		await ready([occupancy()]);
		const command = cube.occupancies.end("one");
		initial([occupancy("replacement")], socket.revision + 1);
		await flush();
		expect(() => cube.storage.get("json")).toThrow(expect.objectContaining({code: "NOT_READY"}));
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
		expect(cube.storage.keys()).toEqual(["new"]);
		expect(cube.occupancies.list()).toEqual([occupancy("replacement")]);
	});

	it("applies lifecycle upserts and removals before subsequent local reads", async () => {
		await ready();
		for (const type of ["occupancyCreated", "occupancyUpdated", "occupancyAccessChanged"]) {
			socket.event({"@type": type, occupancy: occupancy("one", {content: {type}})});
			await flush();
			expect(cube.occupancies.get("one")).toMatchObject({content: {type}});
		}
		socket.event({"@type": "occupancyEnded", uuid: "one"});
		await flush();
		expect(cube.occupancies.list()).toEqual([]);
		expect(cube.occupancies.get("one")).toBeUndefined();
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
			expect(cube.connection.status).toBe("error");
			// Reads report why the connection failed, not a generic disconnect.
			expect(() => cube.storage.get("key")).toThrow(expect.objectContaining({code: "INVALID_RESPONSE"}));
		},
	);

	it("bounds incomplete transfers and never reports an incomplete snapshot ready", async () => {
		await authenticate();
		initial();
		socket.event({"@type": "storageChunk", key: "key", index: 0, total: 2, content: btoa("{")});
		await flush();
		await vi.advanceTimersByTimeAsync(10000);
		expect(cube.connection).toMatchObject({status: "error", error: {code: "TIMEOUT"}});
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
		expect(cube.storage.keys()).toHaveLength(150);
		expect(cube.storage.get("k0")).toBe(0);
		socket.event({
			"@type": "storageItem",
			key: "oversize",
			contentType: "application/json",
			encoding: "json",
			content: "x".repeat(1048576 + 4096),
		});
		await flush();
		expect(cube.connection).toMatchObject({status: "error", error: {code: "LIMIT_EXCEEDED"}});
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
		expect(cube.connection).toMatchObject({status: "error", error: {code: "INVALID_RESPONSE"}});
		expect(cube.connection.error?.message).not.toContain("sensitive-payload");
	});

	it("clears cached data on close; reads throw and a pending token read rejects", async () => {
		await ready([occupancy()]);
		const listener = vi.fn();
		cube.addEventListener("occupancies", listener);
		const pendingToken = expect(cube.getToken()).rejects.toMatchObject({code: "DISCONNECTED"});
		cube.close();
		await pendingToken;
		expect(listener).toHaveBeenLastCalledWith({occupancies: undefined});
		expect(cube.identity).toBeUndefined();
		for (
			const read of [
				() => cube.storage.get("json"),
				() => cube.storage.getBlob("json"),
				() => cube.storage.keys(),
				() => cube.occupancies.list(),
				() => cube.occupancies.get("one"),
			]
		) expect(read).toThrow(expect.objectContaining({code: "DISCONNECTED"}));
	});
});

describe("commands and authentication", () => {
	it("returns undefined for unknown compartments or locks and rejects opening them with NOT_FOUND", async () => {
		await ready();
		socket.event({
			"@type": "compartments",
			compartments: [{number: "1", enabled: true, types: [], features: [], lock: "lock-1"}, {
				number: "2",
				enabled: true,
				types: [],
				features: [],
			}],
		});
		await flush();
		expect(cube.getCompartmentLock("1")).toBe("lock-1");
		expect(cube.getCompartmentLock("2")).toBeUndefined();
		expect(cube.getCompartmentLock("missing")).toBeUndefined();
		await expect(cube.openCompartment("2")).rejects.toMatchObject({code: "NOT_FOUND"});
		await expect(cube.openCompartment("missing")).rejects.toMatchObject({code: "NOT_FOUND"});
		await expect(cube.configureCodeReader({indicators: {beeper: {volume: 101}}})).rejects.toMatchObject({
			code: "INVALID_REQUEST",
		});
		expect(socket.requests()).toEqual([]);
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
		};
		const allocated = cube.occupancies.occupyType({
			...request,
			features: ["COOLED", "ACCESSIBLE", "CHARGER", "DANGEROUS_GOODS"],
		});
		expect(JSON.parse(socket.request("occupyType").slice(15))).toEqual({
			"@type": "occupyType",
			...request,
			cooled: true,
			accessible: true,
			charger: true,
			dangerousGoods: true,
		});
		socket.reply(socket.request("occupyType"), occupancy());
		await expect(allocated).resolves.toEqual(occupancy());
		const operations: Array<[string, Promise<unknown>, object]> = [
			[
				"occupyBox",
				cube.occupancies.occupyCompartment({boxNumber: "1", content: {}}),
				{boxNumber: "1", content: {}},
			],
			["confirmOccupancy", cube.occupancies.confirm("one", {content: {confirmed: true}, merge: true}), {
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
		const required = cube.setCompartmentMaintenance("1", true);
		expect(JSON.parse(socket.request("updateBoxMaintenance").slice(15))).toEqual({
			"@type": "updateBoxMaintenance",
			boxNumber: "1",
			maintenanceRequired: true,
		});
		socket.reply(socket.request("updateBoxMaintenance"));
		await required;
		const cleared = cube.setCompartmentMaintenance("1", false);
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
		const mutation = cube.occupancies.occupyCompartment({boxNumber: "1"});
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
		expect(cube.connection.status).toBe("ready");
	});

	it("rejects incompatible authentication and bounded duplicate initial publications", async () => {
		await authenticate(5);
		expect(cube.connection).toMatchObject({status: "error", error: {code: "PROTOCOL_MISMATCH"}});
		// One side needs new software, so repeating the same handshake cannot resolve it.
		await vi.advanceTimersByTimeAsync(60000);
		expect(cube.connection).toMatchObject({status: "error", error: {code: "PROTOCOL_MISMATCH"}});
		expect(Socket.instances).toHaveLength(1);
	});
	it("rejects duplicate initial publications while storage is loading", async () => {
		await flush();
		initial();
		initial();
		await flush();
		expect(cube.connection).toMatchObject({status: "error", error: {code: "LIMIT_EXCEEDED"}});
	});

	it("accepts a repeated ready barrier without announcing another connection", async () => {
		const opened = vi.fn();
		cube.addEventListener("open", opened);
		await ready();
		socket.event({"@type": "ready"});
		await flush();
		expect(opened).toHaveBeenCalledTimes(1);
	});

	it("has one readiness model: connected, open/close and the connection event all follow status ready", async () => {
		const events: string[] = [];
		cube.addEventListener("open", () => events.push("open"));
		cube.addEventListener("close", () => events.push("close"));
		cube.addEventListener("connection", ({connection}) => events.push(connection.status));
		await authenticate();
		initial();
		await flush();
		// An open socket with an incomplete snapshot is not a connection yet.
		expect(cube.connected).toBe(false);
		socket.event({"@type": "ready"});
		await flush();
		expect(cube.connected).toBe(true);
		// Ordinary publications advance the wire revision without touching the public connection state.
		socket.event({"@type": "lock", lock: "lock-1", status: "OPEN"});
		socket.event({"@type": "cube", ...identity("app-a", 250)});
		await flush();
		expect(events).toEqual(["ready", "open"]);
		// A failure leaves ready exactly once, with the reason on the connection.
		socket.event({"@type": "cube", ...identity("other")});
		await flush();
		expect(cube.connected).toBe(false);
		expect(events).toEqual(["ready", "open", "unavailable", "close"]);
	});

	it("keeps the token out of identity and does not announce rotations as identity changes", async () => {
		const identities = vi.fn();
		cube.addEventListener("identity", identities);
		await ready();
		expect(cube.identity).toEqual({cubeId: "cube-1", appId: "app-a"});
		expect(identities).toHaveBeenCalledTimes(1);
		socket.event({"@type": "cube", ...identity("app-a", 250)});
		await flush();
		expect(identities).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(identities.mock.calls)).not.toContain("signature");
	});

	it("resynchronizes revision gaps and discards closed-socket state", async () => {
		await ready([occupancy()]);
		const old = socket;
		socket.event({"@type": "occupancyEnded", uuid: "one", revision: 99});
		await flush();
		expect(cube.connection.status).toBe("initializing");
		expect(() => cube.occupancies.list()).toThrow(expect.objectContaining({code: "NOT_READY"}));
		socket = Socket.instances[1];
		socket.open();
		await ready();
		old.event({"@type": "storageItem", ...fixture.storage[0], content: "stale"});
		await flush();
		expect(cube.storage.get("json")).toEqual(fixture.storage[0].content);
	});

	it("rebuilds the connection after a transient failure instead of stranding the app in error", async () => {
		await ready([occupancy()]);
		// A malformed frame fails the connection, but a fresh socket can resolve it.
		socket.event({"@type": "storageChunk", key: "bad", index: 0, total: 1, content: btoa("{BROKEN")});
		await flush();
		expect(cube.connection).toMatchObject({status: "error", error: {code: "INVALID_RESPONSE"}});
		expect(Socket.instances).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(10000);
		expect(cube.connection.status).toBe("initializing");
		socket = Socket.instances[1];
		socket.open();
		await ready([occupancy()]);
		expect(cube.connection.status).toBe("ready");
		expect(cube.occupancies.list()).toEqual([occupancy()]);
	});

	it("does not retry a failure that needs a fresh kiosk launch", async () => {
		await ready();
		socket.event({"@type": "cube", ...identity("other")});
		await flush();
		await vi.advanceTimersByTimeAsync(60000);
		expect(cube.connection).toMatchObject({status: "unavailable", error: {code: "AUTHENTICATION_REQUIRED"}});
		expect(Socket.instances).toHaveLength(1);
	});

	it("survives enum values a newer controller adds, dropping the value rather than the connection", async () => {
		const locks = vi.fn();
		const codes = vi.fn();
		cube.addEventListener("lock", locks);
		cube.addEventListener("code", codes);
		await authenticate();
		socket.event({
			"@type": "initialState",
			revision: 0,
			generation: 1,
			identity: identity(),
			compartments: [{number: "1", enabled: true, types: ["S"], features: ["COOLED", "IRRADIATED"]}],
			devices: [{id: "d1", types: ["Locking", "Telepathy"]}, {id: "d2", types: ["Telepathy"]}],
			occupancies: [],
		});
		socket.revision = 0;
		socket.event({"@type": "ready"});
		await flush();
		// Only the capability this app cannot name is dropped; the locker still connects.
		expect(cube.connection.status).toBe("ready");
		expect(cube.compartments[0].features).toEqual(["COOLED"]);
		expect(cube.devices).toEqual([{id: "d1", types: ["Locking"]}, {id: "d2", types: []}]);
		// A scalar the app cannot interpret costs its own event, not the connection.
		socket.event({"@type": "lock", lock: "lock-1", status: "MELTED"});
		socket.event({"@type": "code", code: "1234", source: "TELEPATHY"});
		await flush();
		expect(cube.connection.status).toBe("ready");
		expect(locks).not.toHaveBeenCalled();
		expect(codes).not.toHaveBeenCalled();
		socket.event({"@type": "lock", lock: "lock-1", status: "OPEN"});
		socket.event({"@type": "code", code: "1234", source: "KEYPAD"});
		await flush();
		expect(locks).toHaveBeenCalledTimes(1);
		expect(codes).toHaveBeenCalledTimes(1);
	});

	it("revokes cached state and uncertain commands when the installed app changes", async () => {
		await ready([occupancy()]);
		const command = cube.occupancies.end("one");
		const failure = expect(command).rejects.toMatchObject({code: "COMMAND_OUTCOME_UNKNOWN"});
		socket.event({"@type": "cube", ...identity("other")});
		await flush();
		await failure;
		expect(cube.identity).toBeUndefined();
		expect(cube.connection).toMatchObject({status: "unavailable", error: {code: "AUTHENTICATION_REQUIRED"}});
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
