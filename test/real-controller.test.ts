import {createPublicKey, verify} from "node:crypto";
import {afterAll, beforeAll, expect, test, vi} from "vitest";
import {WebSocket, WebSocketServer} from "ws";
import {CubeImpl} from "../packages/cube-app-sdk/src/cube";
import {Server} from "../packages/cube-app-service/src/server";

// Opt-in: controller's test runtime must listen on 19000 and connect its Center client to 17000.
// This peer exercises the real Center write path without contacting a deployed Center.
const controllerUrl = "http://127.0.0.1:19000";
const utf8 = (value: string) => new TextEncoder().encode(value);
let center: WebSocketServer;
let centerSocket: WebSocket | undefined;
let service: Server;
let cube: CubeImpl;
let nextId = 0;
const replies = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();

async function eventually(check: () => void, timeout = 10000) {
	await vi.waitFor(check, {timeout, interval: 25});
}

async function centerMessage(message: Record<string, unknown>) {
	const id = String(++nextId).padStart(12, "0");
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			replies.delete(id);
			reject(new Error("Controller did not acknowledge Center fixture"));
		}, 10000);
		replies.set(id, {
			resolve: () => {
				clearTimeout(timeout);
				resolve();
			},
			reject: error => {
				clearTimeout(timeout);
				reject(error);
			},
		});
		centerSocket!.send(`MSG${id}${JSON.stringify(message)}`);
	});
}

async function install(...ids: string[]) {
	await centerMessage({"@type": "cube:AppSnapshot", apps: ids.map(id => ({id, storage: {}}))});
}

async function store(key: string, contentType: string, bytes: Uint8Array) {
	await centerMessage({
		"@type": "cube:AppStorageItemChanged",
		appId: "e2e-app",
		key,
		value: {contentType, data: Buffer.from(bytes).toString("base64")},
	});
}

beforeAll(async () => {
	vi.stubGlobal("WebSocket", WebSocket);
	center = new WebSocketServer({host: "127.0.0.1", port: 17000});
	center.on("connection", socket => {
		centerSocket = socket;
		socket.on("message", data => {
			const frame = data.toString();
			const type = frame.slice(0, 3);
			if (type === "HBT") socket.send(frame);
			else if (type === "MSG") socket.send(`ACK${frame.slice(3, 15)}`);
			else {
				const id = frame.slice(3, 15);
				const pending = replies.get(id);
				replies.delete(id);
				if (type === "ACK") pending?.resolve();
				else pending?.reject(new Error(`Controller rejected Center fixture: ${frame.slice(15)}`));
			}
		});
	});
	await eventually(() => expect(centerSocket?.readyState).toBe(WebSocket.OPEN), 55000);
	await install("e2e-app");
	await centerMessage({"@type": "cube:OccupancySnapshot", occupancies: []});
	const fixture = await fetch(`${controllerUrl}/test/fixtures`, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify([{number: "1", types: ["small"], lock: "fixture-1"}]),
	});
	expect(fixture.ok).toBe(true);
	service = new Server({host: "127.0.0.1", port: 14000, controllerHost: "127.0.0.1", controllerPort: 19000});
	await service.ready;
	cube = new CubeImpl({host: "127.0.0.1", port: 14000, secondary: false});
	await eventually(() => expect(cube.occupancies.state.status).toBe("ready"));
});

afterAll(async () => {
	cube?.close();
	await service?.stop();
	for (const socket of center?.clients ?? []) socket.terminate();
	if (center) await new Promise<void>(resolve => center.close(() => resolve()));
	vi.unstubAllGlobals();
});

test("controller lifecycle, Center storage, identity and app isolation through the service", async () => {
	expect(cube.identity?.appId).toBe("e2e-app");
	expect(cube.occupancies.state.data).toEqual([]);

	const token = await cube.getToken();
	const [headerPart, claimsPart, signature] = token.split(".");
	const header = JSON.parse(Buffer.from(headerPart, "base64url").toString());
	const claims = JSON.parse(Buffer.from(claimsPart, "base64url").toString());
	const identity = await (await fetch(`${controllerUrl}/identity`)).json();
	expect(header).toMatchObject({typ: "JWT", alg: "ES256", kid: identity.kid});
	expect(claims).toMatchObject({iss: "e2e-cube", sub: "e2e-cube", aud: "e2e-app"});
	expect(claims.exp - claims.iat).toBe(3600);
	expect(cube.identity?.expiresAt).toBe(claims.exp);
	expect(verify("sha256", utf8(`${headerPart}.${claimsPart}`), {
		key: createPublicKey({key: identity.jwk, format: "jwk"}),
		dsaEncoding: "ieee-p1363",
	}, Uint8Array.from(Buffer.from(signature, "base64url")))).toBe(true);

	const pending = await cube.occupancies.occupyType({
		type: "small",
		accessCode: "12345",
		content: {handover: "test-55"},
	});
	expect(pending).toMatchObject({appId: "e2e-app", boxNumber: "1", state: "pending"});
	await eventually(() => expect(cube.occupancies.state.data?.[0]?.uuid).toBe(pending.uuid));
	await cube.occupancies.cancel(pending.uuid);
	await eventually(() => expect(cube.occupancies.state.data).toEqual([]));
	await expect(cube.occupancies.get(pending.uuid)).rejects.toMatchObject({code: "NOT_FOUND"});

	const occupied = await cube.occupancies.occupyCompartment({
		boxNumber: "1",
		accessCode: "12345",
		accessKeys: ["key-a"],
	});
	const lockStates: string[] = [];
	cube.addEventListener("lock", event => lockStates.push(event.status));
	await cube.openCompartment("1");
	await eventually(() => expect(lockStates).toContain("OPEN"));
	const closed = await fetch(`${controllerUrl}/test/locks`, {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({lock: "fixture-1", status: "Closed"}),
	});
	expect(closed.ok).toBe(true);
	await eventually(() => expect(lockStates).toContain("CLOSED"));
	await cube.occupancies.confirm(occupied.uuid, {content: {confirmed: true}});
	await eventually(() => expect(cube.occupancies.state.data?.[0]?.state).toBe("confirmed"));
	await cube.occupancies.update(occupied.uuid, {content: {handover: "test-55"}, merge: true, actor: "test"});
	await cube.occupancies.changeAccess(occupied.uuid, {accessCode: "67890", accessKeys: ["key-b"]});
	expect((await cube.occupancies.list("key-b"))[0]?.uuid).toBe(occupied.uuid);
	expect((await cube.occupancies.get(occupied.uuid)).content).toEqual({confirmed: true, handover: "test-55"});
	await cube.occupancies.cancel(occupied.uuid);
	expect((await cube.occupancies.get(occupied.uuid)).state).toBe("confirmed");

	const invalidations: string[] = [];
	cube.addEventListener("storage", ({key}) => invalidations.push(key));
	await store("json", "application/json", utf8("{\"value\":42}"));
	await store("null", "application/json", utf8("null"));
	await store("binary", "application/octet-stream", Uint8Array.from([0, 255, 65]));
	await eventually(() => expect(invalidations).toEqual(expect.arrayContaining(["json", "null", "binary"])));
	expect(await cube.storage.get("json")).toEqual({value: 42});
	expect(await cube.storage.get("null")).toBeNull();
	const binary = await cube.storage.getBlob("binary");
	expect(binary.type).toBe("application/octet-stream");
	expect([...new Uint8Array(await binary.arrayBuffer())]).toEqual([0, 255, 65]);
	expect(JSON.parse(await (await cube.storage.getBlob("json")).text())).toEqual({value: 42});
	expect(await cube.storage.keys()).toEqual(expect.arrayContaining(["json", "null", "binary"]));
	invalidations.length = 0;
	await centerMessage({"@type": "cube:AppStorageItemDeleted", appId: "e2e-app", key: "json"});
	await eventually(() => expect(invalidations).toContain("json"));
	await expect(cube.storage.get("json")).rejects.toMatchObject({code: "NOT_FOUND"});

	await install("app-b");
	await eventually(() => expect(cube.identity?.appId).toBe("app-b"));
	await eventually(() => expect(cube.occupancies.state.data).toEqual([]));
	await expect(cube.occupancies.update(occupied.uuid, {content: {foreign: true}})).rejects.toMatchObject({
		code: "NOT_FOUND",
	});
	await expect(cube.storage.get("null")).rejects.toMatchObject({code: "NOT_FOUND"});
	await install();
	await eventually(() => expect(cube.identity?.appId).toBeNull());
	await expect(cube.storage.keys()).rejects.toMatchObject({code: "APP_NOT_CONFIGURED"});
	await install("e2e-app", "app-b");
	await expect(cube.occupancies.list()).rejects.toMatchObject({code: "APP_NOT_CONFIGURED"});
	await install("e2e-app");
	await eventually(() => expect(cube.occupancies.state.data?.[0]?.uuid).toBe(occupied.uuid));
	await cube.occupancies.end(occupied.uuid);
	await eventually(() => expect(cube.occupancies.state.data).toEqual([]));
	await cube.setCompartmentMaintenance("1", true);
	await cube.setCompartmentMaintenance("1", false);

	// Loss of the Center link leaves the real controller authoritative and usable offline.
	await store("offline", "application/json", utf8("{\"available\":true}"));
	await eventually(() => expect(invalidations).toContain("offline"));
	centerSocket?.close();
	await eventually(() => expect(centerSocket?.readyState).toBe(WebSocket.CLOSED));
	expect(await cube.storage.get("offline")).toEqual({available: true});
	expect(await cube.occupancies.list()).toEqual([]);
});
