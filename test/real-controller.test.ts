import {
	bootstrapSession,
	type Compartment,
	connect,
	type ControllerSession,
	type Cube,
	type LockEvent,
} from "@variocube/cube-app-sdk";
import {afterAll, beforeAll, expect, test, vi} from "vitest";
import {WebSocket} from "ws";
// The SDK refuses to send a non-object patch, so the shared vectors reach the controller only with
// that client-side guard stubbed. Imported from source, like the packages' own unit tests.
import {contentPatchSchema} from "../packages/cube-app-sdk/src/schema.js";
import {type Launch, MockDriver, MockKiosk} from "./mock-driver";

// Run an isolated native controller dev --fixture single, then set CONTROLLER_URL.
const endpoint = process.env.CONTROLLER_URL ?? "http://localhost:9000";
// The development simulator that owns the locks. An extension terminal has none; its locks are simulated on main.
const simulator = process.env.CONTROLLER_SIMULATOR_URL ?? endpoint;
const appUrl = "http://localhost:5173/?mode=dev#/home";
// A kiosk with SECONDARY=true adds this parameter; the controller derives the terminal's side from it.
const secondaryUrl = "http://localhost:5173/?mode=dev&secondary=true#/home";
const kiosk = new MockKiosk(endpoint, appUrl);
const unit = new MockDriver(endpoint, "unit", {id: "sdk-test-unit", type: "ComputeUnit"});
let cube: Cube;
let session: ControllerSession;

beforeAll(async () => {
	await kiosk.start();
	await unit.start();
	({session, cube} = await connectLaunch(await kiosk.launch()));
});

afterAll(() => {
	cube?.close();
	session?.close();
	kiosk.stop();
	unit.stop();
	vi.unstubAllGlobals();
});

/** Exchanges a launch's grant like the app's first page load and connects the SDK until it is ready. */
async function connectLaunch(launch: Launch): Promise<{ session: ControllerSession; cube: Cube }> {
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
	const session = await bootstrapSession({
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
	const cube = connect({session});
	await vi.waitFor(() => expect(cube.connection.status).toBe("ready"), {timeout: 10000});
	return {session, cube};
}

/** Enabled compartments without an active occupancy, which an app may open. */
function freeCompartments() {
	return cube.compartments.filter(box =>
		box.enabled && !cube.occupancies.list().some(o => o.boxNumber === box.number)
	);
}

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
	// The end is enumerable without knowing its key, with the content the patches produced.
	expect(cube.occupancies.ended().find(o => o.uuid === first.uuid)?.content)
		.toEqual({ledger: {left: {count: 1}, right: {count: 2}}});
	cube.close();
	cube = connect({session});
	await vi.waitFor(() => expect(cube.connection.status).toBe("ready"), {timeout: 10000});
	expect(cube.occupancies.getByIdempotencyKey(key)?.uuid).toBe(first.uuid);
	// The controller pushes the retained record in the fresh snapshot, so ended() sees it after a restart too.
	expect(cube.occupancies.ended().map(o => o.uuid)).toContain(first.uuid);
	expect(cube.occupancies.list().map(o => o.uuid)).not.toContain(first.uuid);
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
				// controller's own rejection, which the local guard would otherwise hide. The
				// fixture's `error` only marks the vector as rejected; the controller's wire code
				// for an invalid patch is INVALID_REQUEST.
				const guard = vi.spyOn(contentPatchSchema, "safeParse").mockReturnValue({
					success: true,
					data: patch,
				});
				try {
					await expect(cube.occupancies.patch(record.uuid, patch)).rejects.toMatchObject({
						code: "INVALID_REQUEST",
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

// A compartment opens only with a lock on the terminal's own side, never the other one. Which lock opened, and for
// whom, shows in the observed lock event.
test("openCompartment on a primary terminal opens compartments with a primary lock", async () => {
	expect(cube.secondary).toBe(false);
	const boxes = freeCompartments();
	expect(boxes.some(box => box.lock)).toBe(true);
	for (const box of boxes) {
		expect(cube.getCompartmentLock(box.number)).toBe(box.lock);
		await expectOpen(box, "lock");
	}
	await expect(cube.openCompartment("no-such-compartment")).rejects.toMatchObject({code: "NOT_FOUND"});
});

// Keep this last: moving the terminal to the other side ends the sessions every other test uses.
test("openCompartment on a secondary terminal opens only secondary locks", async () => {
	const primary = cube;
	const launch = await kiosk.launch(secondaryUrl);
	// A side change ends the terminal's sessions like an app change, so the primary connection cannot stay ready.
	await vi.waitFor(() => expect(primary.connection.status).not.toBe("ready"), {timeout: 10000});
	primary.close();
	session.close();
	({session, cube} = await connectLaunch(launch));
	try {
		expect(cube.secondary).toBe(true);
		const boxes = freeCompartments();
		expect(boxes.length).toBeGreaterThan(0);
		for (const box of boxes) {
			expect(cube.getCompartmentLock(box.number)).toBe(box.secondaryLock);
			await expectOpen(box, "secondaryLock");
		}
	}
	finally {
		// Leave the terminal on the primary side, as a fresh controller starts.
		await kiosk.launch();
	}
});

/**
 * A compartment with a lock on this side opens exactly that lock, and its lock event carries the app's attribution.
 * One without is UNAVAILABLE rather than opening the other side.
 */
async function expectOpen(box: Compartment, side: "lock" | "secondaryLock") {
	const lock = box[side];
	const other = box[side === "lock" ? "secondaryLock" : "lock"];
	// A lock event reports only an observed change, so both of the box's locks start closed: the expected one then
	// has to change, and opening the other one would show as well. Locks stay open from earlier runs or terminals.
	for (const id of [lock, other]) if (id) await closeLock(id);
	const context = {actor: `sdk-native:${crypto.randomUUID()}`, action: "collect"};
	const events: LockEvent[] = [];
	const remove = cube.addEventListener("lock", event => events.push(event));
	try {
		const opened = cube.openCompartment(box.number, context);
		if (!lock) {
			await expect(opened).rejects.toMatchObject({code: "UNAVAILABLE"});
			return;
		}
		await opened;
		await vi.waitFor(
			() => expect(events).toContainEqual(expect.objectContaining({lock, status: "OPEN", ...context})),
			{timeout: 10000},
		);
		expect(events.filter(event => event.status === "OPEN").map(event => event.lock)).toEqual([lock]);
		const command = (await simulatorState()).commands.find(command => command.kind === "locking:OpenLock");
		expect(command).toMatchObject({device: lock, outcome: "OPENED"});
	}
	finally {
		remove();
	}
}

interface SimulatorState {
	locks: Array<{ id: string; status: string }>;
	/** Newest first. */
	commands: Array<{ kind: string; device: string; outcome: string }>;
}

async function simulatorState(): Promise<SimulatorState> {
	const response = await fetch(new URL("/dev/state", simulator));
	expect(response.ok, `${simulator} must be a development controller with simulated hardware`).toBe(true);
	return await response.json() as SimulatorState;
}

/**
 * Closes a simulated lock through the development simulator. Injections are awaited one at a time: concurrent ones
 * for the same lock may apply in either order. The simulator's state must show the lock closed before it is opened.
 */
async function closeLock(lock: string) {
	const response = await fetch(new URL("/dev/simulate", simulator), {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({
			operation: "driver",
			message: {"@type": "locking:LockStatusChanged", id: lock, status: "Closed"},
		}),
	});
	expect(response.ok, `${simulator}/dev/simulate must accept simulated lock status`).toBe(true);
	expect(await response.json()).toMatchObject({accepted: true});
	await vi.waitFor(async () => {
		expect((await simulatorState()).locks.find(entry => entry.id === lock)?.status).toBe("Closed");
	}, {timeout: 10000});
}
