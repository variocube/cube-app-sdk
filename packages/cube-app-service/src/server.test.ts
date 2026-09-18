import type {CubeMessage, Occupancy} from "@variocube/cube-app-sdk";
import {Logger} from "@variocube/driver-common";
import {VcmpError, type VcmpMessage} from "@variocube/vcmp";
import {VcmpServer} from "@variocube/vcmp-server";
import {once} from "node:events";
import {afterEach, describe, expect, it, vi} from "vitest";
import {WebSocket, WebSocketServer} from "ws";
import fixture from "../../../test/fixtures/controller-wire.json";
import {Server, type ServerOptions} from "./server";

interface Reply {
	kind: string;
	id: string;
	value: unknown;
	raw: string;
}

interface Message extends VcmpMessage {
	[key: string]: unknown;
}

class AppPeer {
	readonly messages: Message[] = [];
	readonly replies: Reply[] = [];
	readonly #pending = new Map<string, (reply: Reply) => void>();
	readonly #socket: WebSocket;
	#nextId = 0;

	constructor(url: string) {
		this.#socket = new WebSocket(url);
		this.#socket.on("message", data => {
			const raw = data.toString();
			const kind = raw.slice(0, 3);
			if (kind === "HBT") {
				this.#socket.send(raw);
				return;
			}
			const id = raw.slice(3, 15);
			const value = raw.length > 15 ? JSON.parse(raw.slice(15)) : undefined;
			if (kind === "MSG") {
				this.messages.push(value);
				this.#socket.send(`ACK${id}`);
			}
			else {
				const reply = {kind, id, value, raw};
				this.replies.push(reply);
				this.#pending.get(id)?.(reply);
				this.#pending.delete(id);
			}
		});
	}

	async ready() {
		if (this.#socket.readyState !== WebSocket.OPEN) await once(this.#socket, "open");
	}

	request(message: Message, frameId?: string) {
		const id = frameId ?? String(++this.#nextId).padStart(12, "0");
		return new Promise<Reply>(resolve => {
			this.#pending.set(id, resolve);
			this.#socket.send(`MSG${id}${JSON.stringify(message)}`);
		});
	}

	async close() {
		if (this.#socket.readyState === WebSocket.CLOSED) return;
		const closed = once(this.#socket, "close");
		this.#socket.terminate();
		await closed;
	}
}

const identity: CubeMessage = {
	"@type": "cube",
	cubeId: "test-cube",
	appId: "app-a",
	token: "secret-token-a",
	expiresAt: 2000000000,
};
const occupancy: Occupancy = {
	uuid: "reserved-1",
	appId: "app-a",
	boxNumber: "1",
	accessCode: "1234",
	accessKeys: [],
	created: "2026-09-12T00:00:00Z",
	state: "pending",
	content: {handover: "test"},
	actor: null,
	action: null,
};

const cleanup: (() => Promise<unknown>)[] = [];

afterEach(async () => {
	for (const stop of cleanup.reverse()) await stop();
	cleanup.length = 0;
});

async function controller(initial = true) {
	const sockets = new WebSocketServer({host: "127.0.0.1", port: 0});
	await once(sockets, "listening");
	const address = sockets.address();
	if (!address || typeof address === "string") throw new Error("Missing controller port");
	const vcmp = new VcmpServer({webSocketServer: sockets});
	vcmp.onSessionConnected = session => {
		if (initial) {
			for (const message of [fixture.capabilities, identity, fixture.emptySnapshot]) {
				void session.send(message).catch(() => undefined);
			}
		}
	};
	cleanup.push(async () => {
		for (const socket of sockets.clients) socket.terminate();
		await vcmp.stop();
	});
	return {vcmp, sockets, port: address.port};
}

async function service(controllerPort: number, options: Partial<ServerOptions> = {}) {
	const server = new Server({
		host: "127.0.0.1",
		port: 0,
		controllerHost: "127.0.0.1",
		controllerPort,
		controllerReconnectTimeout: 25,
		...options,
	});
	cleanup.push(() => server.stop());
	await server.ready;
	const address = server.address;
	if (!address || typeof address === "string") throw new Error("Missing service port");
	return {server, url: `ws://127.0.0.1:${address.port}`};
}

async function app(url: string) {
	const peer = new AppPeer(url);
	cleanup.push(() => peer.close());
	await peer.ready();
	return peer;
}

async function waitForMessage(peer: AppPeer, type: string, predicate: (message: Message) => boolean = () => true) {
	await vi.waitFor(() =>
		expect(peer.messages.some(message => message["@type"] === type && predicate(message))).toBe(true)
	);
}

describe("service over real VCMP WebSockets", () => {
	it("preserves typed JSON/null/binary ACKs and exact controller NAKs for the correlated app requester", async () => {
		const upstream = await controller();
		upstream.vcmp.on<Message>("getStorageItem", message => {
			const document = fixture.storage.find(item => item.key === message.key);
			if (!document) throw new VcmpError(fixture.reply as unknown as ConstructorParameters<typeof VcmpError>[0]);
			return document;
		});
		upstream.vcmp.on("getStorageKeys", () => fixture.storage.map(item => item.key));
		upstream.vcmp.on("getToken", () => "secret-refresh-token");
		const {url} = await service(upstream.port);
		const [first, second] = await Promise.all([app(url), app(url)]);
		await waitForMessage(first, "occupancies");
		const [missing, found] = await Promise.all([
			first.request({"@type": "getStorageItem", key: "missing"}, "000000000001"),
			second.request({"@type": "getStorageItem", key: "json"}, "000000000001"),
		]);
		expect(missing.raw.slice(0, 15)).toBe(fixture.replyPrefix);
		expect(missing.value).toEqual(fixture.reply);
		expect(found).toMatchObject({kind: "ACK", id: "000000000001", value: fixture.storage[0]});
		for (const document of fixture.storage.slice(1)) {
			expect(await first.request({"@type": "getStorageItem", key: document.key}))
				.toMatchObject({kind: "ACK", value: document});
		}
		expect((await first.request({"@type": "getStorageKeys"})).value).toEqual(["json", "null", "binary"]);
		expect((await first.request({"@type": "getToken"})).value).toBe("secret-refresh-token");
		expect(first.replies.filter(reply => reply.id === "000000000001" && reply.kind === "NAK")).toHaveLength(1);
	});

	it("initializes late app subscriptions from the latest snapshot, preserving subsequent event order and cancellation", async () => {
		const upstream = await controller();
		const {url} = await service(upstream.port);
		await vi.waitFor(() => expect(upstream.vcmp.sessions).toHaveLength(1));
		await upstream.vcmp.broadcast({"@type": "occupancyCreated", occupancy});
		const peer = await app(url);
		await waitForMessage(peer, "occupancies");
		expect(peer.messages.slice(0, 4).map(message => message["@type"]))
			.toEqual(["availability", "capabilities", "cube", "occupancies"]);
		expect(peer.messages[3].occupancies).toEqual([occupancy]);
		await upstream.vcmp.broadcast({
			"@type": "occupancyUpdated",
			occupancy: {...occupancy, content: {updated: true}},
		});
		await upstream.vcmp.broadcast({
			"@type": "occupancyAccessChanged",
			occupancy: {...occupancy, accessCode: "5678"},
		});
		await upstream.vcmp.broadcast({"@type": "occupancyEnded", uuid: occupancy.uuid});
		await upstream.vcmp.broadcast(fixture.invalidation);
		await waitForMessage(peer, "storageItemChanged");
		expect(peer.messages.slice(-4).map(message => message["@type"]))
			.toEqual(["occupancyUpdated", "occupancyAccessChanged", "occupancyEnded", "storageItemChanged"]);
		const late = await app(url);
		await waitForMessage(late, "occupancies");
		expect(late.messages.find(message => message["@type"] === "occupancies")).toEqual(fixture.emptySnapshot);
	});

	it("rejects lost mutation replies on disconnect, clears app data, and reconnects without replay", async () => {
		const upstream = await controller();
		const mutation = vi.fn(() => new Promise(() => undefined));
		upstream.vcmp.on("occupyBox", mutation);
		const {url} = await service(upstream.port);
		const peer = await app(url);
		await waitForMessage(peer, "occupancies");
		await upstream.vcmp.broadcast({"@type": "occupancyCreated", occupancy});
		const pending = peer.request({"@type": "occupyBox", boxNumber: "1"});
		await vi.waitFor(() => expect(mutation).toHaveBeenCalledTimes(1));
		for (const socket of upstream.sockets.clients) socket.terminate();
		expect(await pending).toMatchObject({kind: "NAK", value: {code: "COMMAND_OUTCOME_UNKNOWN"}});
		await waitForMessage(peer, "availability", message => message.connected === false);
		await vi.waitFor(() => {
			expect(peer.messages.filter(message => message["@type"] === "cube")).toHaveLength(2);
		});
		const late = await app(url);
		await waitForMessage(late, "occupancies");
		expect(late.messages.find(message => message["@type"] === "occupancies")).toEqual(fixture.emptySnapshot);
		expect(mutation).toHaveBeenCalledTimes(1);
	});

	it("reports unsupported for an old controller while keeping hardware commands usable", async () => {
		const upstream = await controller(false);
		const open = vi.fn(() => undefined);
		upstream.vcmp.on("openLock", open);
		const {url} = await service(upstream.port, {capabilityTimeout: 20});
		const peer = await app(url);
		await waitForMessage(peer, "availability", message => message.connected === true);
		expect(await peer.request({"@type": "getStorageKeys"}))
			.toMatchObject({kind: "NAK", value: {code: "UNSUPPORTED"}});
		expect(await peer.request({"@type": "openLock", lock: "fixture-1"})).toMatchObject({kind: "ACK"});
		expect(open).toHaveBeenCalledTimes(1);
		await upstream.vcmp.broadcast(fixture.capabilities);
		upstream.vcmp.on("getStorageKeys", () => ["late"]);
		expect((await peer.request({"@type": "getStorageKeys"})).value).toEqual(["late"]);
	});

	it("rejects in-flight app A credentials on app B identity and waits for B's authoritative snapshot", async () => {
		const upstream = await controller();
		let reply: (token: string) => void = () => {
			throw new Error("Request not started");
		};
		const getToken = vi.fn(() =>
			new Promise<string>(resolve => {
				reply = resolve;
			})
		);
		upstream.vcmp.on("getToken", getToken);
		const {url} = await service(upstream.port);
		const peer = await app(url);
		await waitForMessage(peer, "occupancies");
		await upstream.vcmp.broadcast({"@type": "occupancyCreated", occupancy});
		const pending = peer.request({"@type": "getToken"});
		await vi.waitFor(() => expect(getToken).toHaveBeenCalledTimes(1));
		const newIdentity = {...identity, appId: "app-b", token: "secret-token-b"};
		await upstream.vcmp.broadcast(newIdentity);
		expect(await pending).toMatchObject({kind: "NAK", value: {code: "DISCONNECTED"}});
		reply("secret-token-a");
		const late = await app(url);
		await waitForMessage(late, "devices");
		expect(late.messages.find(message => message["@type"] === "cube")).toEqual(newIdentity);
		expect(late.messages.some(message => message["@type"] === "occupancies")).toBe(false);
		await upstream.vcmp.broadcast(fixture.emptySnapshot);
		await waitForMessage(late, "occupancies");
		expect(late.messages.find(message => message["@type"] === "occupancies")).toEqual(fixture.emptySnapshot);
		expect(peer.replies).toHaveLength(1);
	});

	it("never routes extensions to mock or lets mock identity/hardware overwrite a real controller", async () => {
		const upstream = await controller();
		const {url} = await service(upstream.port, {controllerReconnectTimeout: 60000});
		const peer = await app(url);
		const mock = await app(`${url}/mock`);
		await waitForMessage(peer, "cube");
		expect((await mock.request({...identity, cubeId: "fake-cube", token: "fake-token"})).kind).toBe("NAK");
		await mock.request({"@type": "compartments", compartments: [{number: "fake"}]});
		await mock.request({"@type": "code", code: "fixture-scan", source: "SCANNER"});
		await waitForMessage(peer, "code");
		expect(peer.messages.filter(message => message["@type"] === "cube")).toEqual([identity]);
		expect(peer.messages.some(message => JSON.stringify(message.compartments ?? []).includes("fake"))).toBe(false);
		for (const socket of upstream.sockets.clients) socket.terminate();
		await waitForMessage(peer, "availability", message => message.connected === false);
		const response = await peer.request({"@type": "getStorageItem", key: "json"});
		expect(response).toMatchObject({kind: "NAK", value: {code: "DISCONNECTED"}});
		expect(mock.messages.some(message => message["@type"] === "getStorageItem")).toBe(false);
	});

	// The persistent error listener that replaced `once("error", reject)` still has to reject
	// startup. Its other half — logging and stopping on an error raised after the server is
	// listening — is not reachable from here, because the web server is private to `Server`.
	it("rejects startup when the port is already taken", async () => {
		const upstream = await controller();
		const {url} = await service(upstream.port);
		const second = new Server({
			host: "127.0.0.1",
			port: Number(new URL(url).port),
			controllerHost: "127.0.0.1",
			controllerPort: upstream.port,
		});
		cleanup.push(() => second.stop());
		await expect(second.ready).rejects.toMatchObject({code: "EADDRINUSE"});
	});

	it("suppresses VCMP payload logging, including token replies, and stops controller reconnects", async () => {
		const calls: unknown[][] = [];
		for (const method of ["debug", "info", "warn", "error"] as const) {
			vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
				calls.push(args);
			});
		}
		const upstream = await controller();
		upstream.vcmp.on("getToken", () => "secret-refresh-token");
		const {url, server} = await service(upstream.port);
		const peer = await app(url);
		await waitForMessage(peer, "cube");
		await peer.request({"@type": "getToken"});
		expect(JSON.stringify(calls)).not.toContain("secret-token-a");
		expect(JSON.stringify(calls)).not.toContain("secret-refresh-token");
		const connected = vi.fn();
		upstream.vcmp.onSessionConnected = connected;
		await server.stop();
		await server.stop();
		await vi.waitFor(() => expect(upstream.vcmp.sessions).toHaveLength(0));
		await new Promise(resolve => setTimeout(resolve, 70));
		expect(connected).not.toHaveBeenCalled();
	});
});
