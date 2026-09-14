import {bootstrapController, connect, type ControllerSession, type Cube} from "@variocube/cube-app-sdk";
import {request} from "node:http";
import {afterAll, beforeAll, expect, test, vi} from "vitest";
import {WebSocket} from "ws";

// Run a native controller dev --fixture single, then set CONTROLLER_KIOSK_SOCKET to that instance's socket.
const endpoint = process.env.CONTROLLER_URL ?? "http://localhost:9000";
const socketPath = process.env.CONTROLLER_KIOSK_SOCKET;
let cube: Cube;
let session: ControllerSession;

beforeAll(async () => {
	if (!socketPath) throw new Error("Set CONTROLLER_KIOSK_SOCKET to the native development instance's kiosk.sock.");
	const launch = await new Promise<{ url: string }>((resolve, reject) => {
		const req = request({socketPath, path: "/launch", method: "POST"}, response => {
			let data = "";
			response.setEncoding("utf8");
			response.on("data", chunk => {
				data += chunk;
			});
			response.on("end", () => {
				if (response.statusCode !== 200) return reject(new Error("Trusted development launch rejected."));
				try {
					resolve(JSON.parse(data));
				}
				catch {
					reject(new Error("Invalid launch."));
				}
			});
		});
		req.on("error", reject);
		req.end();
	});
	const origin = new URL(launch.url).origin;
	class AppWebSocket extends WebSocket {
		constructor(url: string) {
			super(url, {origin});
		}
	}
	vi.stubGlobal("WebSocket", AppWebSocket);
	let cleaned = "";
	const browserFetch: typeof fetch = (input, options) => {
		const headers = new Headers(options?.headers);
		headers.set("Origin", origin);
		return fetch(input, {...options, headers});
	};
	session = await bootstrapController({
		endpoint,
		location: {href: launch.url},
		history: {
			state: null,
			replaceState: (_data, _title, url) => {
				cleaned = String(url);
			},
		},
		fetch: browserFetch,
	});
	expect(cleaned).not.toContain("vc-bootstrap");
	cube = connect({session});
	await vi.waitFor(() => expect(cube.state.status).toBe("ready"), {timeout: 10000});
});

afterAll(() => {
	cube?.close();
	session?.close();
	vi.unstubAllGlobals();
});

test("native authenticated reserve/confirm/access/update/end and read-only JSON/binary storage", async () => {
	expect(cube.identity?.appId).toBe("dev-app");
	const available = cube.compartments.find(box =>
		box.enabled && !cube.occupancies.snapshot?.some(o => o.boxNumber === box.number)
	);
	expect(available).toBeDefined();
	const occupancy = await cube.occupancies.occupyBox({
		boxNumber: available!.number,
		content: {handover: "sdk-native"},
	});
	expect(occupancy.state).toBe("pending");
	await cube.occupancies.confirm(occupancy.uuid, {step: "confirmed"}, true);
	await cube.occupancies.changeAccess(occupancy.uuid, {accessKeys: ["sdk-key"]});
	await cube.occupancies.update(occupancy.uuid, {content: null});
	expect((await cube.occupancies.get(occupancy.uuid)).content).toBeNull();
	await cube.occupancies.end(occupancy.uuid, {gracePeriod: 0});
	expect(await cube.storage.get("configuration")).toEqual({theme: "light"});
	expect(await cube.storage.get("nullable")).toBeNull();
	expect([...new Uint8Array(await (await cube.storage.getBlob("binary")).arrayBuffer())]).toEqual([0, 1, 255]);
	await expect(cube.storage.get("missing")).rejects.toMatchObject({code: "NOT_FOUND"});
	const token = await cube.getToken();
	const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
	expect(claims.aud).toBe("dev-app");
	expect(claims.sub).toBe(cube.identity?.cubeId);
});

test("raw browser access without credentials is rejected", async () => {
	const response = await fetch(new URL("/app/renew", endpoint), {method: "POST"});
	expect([401, 403]).toContain(response.status);
});
