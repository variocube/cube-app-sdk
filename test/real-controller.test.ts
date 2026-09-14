import {bootstrapController, connect, type ControllerSession, type Cube} from "@variocube/cube-app-sdk";
import {afterAll, beforeAll, expect, test, vi} from "vitest";
import {WebSocket} from "ws";
import {MockDriver, MockKiosk} from "./mock-driver";

// Run an isolated native controller dev --fixture single, then set CONTROLLER_URL.
const endpoint = process.env.CONTROLLER_URL ?? "http://localhost:9000";
const kiosk = new MockKiosk(endpoint, "http://localhost:5173/?mode=dev#/home");
const unit = new MockDriver(endpoint, "unit", {id: "sdk-test-unit", type: "ComputeUnit"});
let cube: Cube;
let session: ControllerSession;

beforeAll(async () => {
	await kiosk.start();
	await unit.start();
	const launch = await kiosk.launch();
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
	kiosk.stop();
	unit.stop();
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

test("native SDK restarts target the registered local kiosk and ComputeUnit through VCMP ACK", async () => {
	await cube.restartUserInterface();
	expect(kiosk.accepted).toEqual([{"@type": "device:Restart", id: kiosk.id}]);
	expect(unit.accepted).toEqual([]);
	await cube.restartOperatingSystem();
	await cube.restartController();
	expect(unit.accepted).toEqual([
		{"@type": "device:Restart", id: unit.id},
		{"@type": "unit:RestartService", name: "variocube-controller"},
	]);
	// These drivers acknowledge only; the test never executes an OS or browser lifecycle action.
	expect(cube.state.status).toBe("ready");
});
