import {bootstrapSession, connect, type ControllerSession, type Cube} from "@variocube/cube-app-sdk";
import {afterAll, beforeAll, expect, test, vi} from "vitest";
import {WebSocket} from "ws";
// The SDK refuses to send a non-object patch, so the shared vectors reach the controller only with
// that client-side guard stubbed. Imported from source, like the packages' own unit tests.
import {contentPatchSchema} from "../packages/cube-app-sdk/src/schema.js";
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
	session = await bootstrapSession({
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
	await vi.waitFor(() => expect(cube.connection.status).toBe("ready"), {timeout: 10000});
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
		box.enabled && !cube.occupancies.list().some(o => o.boxNumber === box.number)
	);
	expect(available).toBeDefined();
	const occupancy = await cube.occupancies.occupyCompartment({
		boxNumber: available!.number,
		content: {handover: "sdk-native"},
	});
	expect(occupancy.state).toBe("pending");
	await cube.occupancies.confirm(occupancy.uuid, {content: {step: "confirmed"}, merge: true});
	await cube.occupancies.changeAccess(occupancy.uuid, {accessKeys: ["sdk-key"]});
	await cube.occupancies.update(occupancy.uuid, {content: null});
	// A local read can trail the acknowledged mutation until its publication arrives.
	await vi.waitFor(() => expect(cube.occupancies.get(occupancy.uuid)?.content).toBeNull());
	await cube.occupancies.end(occupancy.uuid, {gracePeriod: 0});
	expect(cube.storage.get("configuration")).toEqual({theme: "light"});
	expect(cube.storage.get("nullable")).toBeNull();
	expect([...new Uint8Array(await cube.storage.getBlob("binary")!.arrayBuffer())]).toEqual([0, 1, 255]);
	expect(cube.storage.get("missing")).toBeUndefined();
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
	expect(cube.connection.status).toBe("ready");
});

test("native keyed allocation, concurrent merge patches and retained ended reconnect", async () => {
	const key = `sdk-native:${crypto.randomUUID()}:deposit`;
	const box = cube.compartments.find(box =>
		box.enabled && !cube.occupancies.list().some(o => o.boxNumber === box.number)
	)!;
	const [first, repeated] = await Promise.all([
		cube.occupancies.occupyCompartment({
			boxNumber: box.number,
			idempotencyKey: key,
			content: {ledger: {remove: 0}},
		}),
		cube.occupancies.occupyCompartment({
			boxNumber: box.number,
			idempotencyKey: key,
			content: {ledger: {remove: 0}},
		}),
	]);
	expect(first.uuid).toBe(repeated.uuid);
	await cube.occupancies.confirm(first.uuid);
	await Promise.all([
		cube.occupancies.patch(first.uuid, {ledger: {left: {count: 1}, remove: null}}),
		cube.occupancies.patch(first.uuid, {ledger: {right: {count: 2}}}),
	]);
	await vi.waitFor(() =>
		expect(cube.occupancies.get(first.uuid)?.content).toEqual({ledger: {left: {count: 1}, right: {count: 2}}})
	);
	await cube.occupancies.end(first.uuid);
	await vi.waitFor(() => expect(cube.occupancies.getByIdempotencyKey(key)?.state).toBe("ended"));
	expect(cube.occupancies.list().some(o => o.uuid === first.uuid)).toBe(false);
	cube.close();
	cube = connect({session});
	await vi.waitFor(() => expect(cube.connection.status).toBe("ready"), {timeout: 10000});
	expect(cube.occupancies.getByIdempotencyKey(key)?.uuid).toBe(first.uuid);
	const ended = await cube.occupancies.occupyType({type: "not-a-type", idempotencyKey: key});
	expect(ended.uuid).toBe(first.uuid);
	expect(ended.state).toBe("ended");
});

test("shared merge-patch vectors against the native controller", async () => {
	const {default: vectors} = await import("./fixtures/occupancy-merge-patch.json");
	const box = cube.compartments.find(box =>
		box.enabled && !cube.occupancies.list().some(o => o.boxNumber === box.number)
	)!;
	const record = await cube.occupancies.occupyCompartment({boxNumber: box.number});
	try {
		for (const vector of vectors) {
			await cube.occupancies.update(record.uuid, {content: vector.target});
			const patch = vector.patch as unknown as Record<string, unknown>;
			if ("error" in vector) {
				await expect(cube.occupancies.patch(record.uuid, patch)).rejects.toMatchObject({
					code: "INVALID_REQUEST",
				});
				// Then again on the wire: the fixture is shared with controller-rs to pin the
				// controller's own rejection, which the local guard would otherwise hide.
				const guard = vi.spyOn(contentPatchSchema, "safeParse").mockReturnValue({
					success: true,
					data: patch,
				});
				try {
					await expect(cube.occupancies.patch(record.uuid, patch)).rejects.toMatchObject({
						code: vector.error,
					});
				}
				finally {
					guard.mockRestore();
				}
			}
			else {
				await cube.occupancies.patch(record.uuid, patch);
				await vi.waitFor(() => expect(cube.occupancies.get(record.uuid)?.content).toEqual(vector.expected));
			}
		}
	}
	finally {
		await cube.occupancies.cancel(record.uuid);
	}
});
