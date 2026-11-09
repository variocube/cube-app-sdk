// @vitest-environment jsdom
import {connect, LockEvent, Occupancy} from "@variocube/cube-app-sdk";
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {expect, it, vi} from "vitest";
import fixtures from "../../../test/fixtures/controller-wire.json";
import {CubeImpl} from "../../cube-app-sdk/src/cube";
import {ControllerSessionImpl} from "../../cube-app-sdk/src/session";
import {
	CubeProvider,
	isAllowedCloseLockEvent,
	isReopenedLockEvent,
	LOCK_EVENT_ACTION_ALLOW_CLOSE,
	LOCK_EVENT_ACTION_REOPEN,
	LOCK_EVENT_ACTOR_CONTROLLER,
	useLockEvent,
	useOccupancies,
	useOccupancy,
	usePreventCloseAfterOpenSeconds,
	useStorageItem,
} from "../src/index";

const wire = vi.hoisted(() => ({
	connected: true,
	handlers: new Map<string, (event: unknown, session: { isOpen: boolean }) => void>(),
	onOpen: () => {},
	onClose: () => {},
	send: vi.fn(),
}));

vi.mock("@variocube/vcmp", () => ({
	VcmpClient: class {
		get connected() {
			return wire.connected;
		}
		set onOpen(listener: () => void) {
			wire.onOpen = listener;
		}
		set onClose(listener: () => void) {
			wire.onClose = listener;
		}
		on(type: string, listener: (event: unknown, session: { isOpen: boolean }) => void) {
			wire.handlers.set(type, listener);
		}
		start() {}
		stop() {
			wire.connected = false;
			wire.onClose?.();
		}
		send = wire.send;
	},
}));

vi.mock("@variocube/cube-app-sdk", async importOriginal => ({
	...await importOriginal<typeof import("@variocube/cube-app-sdk")>(),
	connect: vi.fn(),
}));

it("renders controller lifecycle events through the real SDK cache, including cancellation", async () => {
	(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	const session = new ControllerSessionImpl("http://localhost:9000", fetch, {
		credential: "test-credential-12345",
		expiresAt: Math.floor(Date.now() / 1000) + 600,
		generation: 1,
	});
	wire.send.mockResolvedValue({protocolMajor: 6, generation: 1});
	const cube = new CubeImpl({session});
	vi.mocked(connect).mockReturnValue(cube);
	const container = document.createElement("div");
	const root = createRoot(container);
	function Probe() {
		const all = useOccupancies();
		const item = useOccupancy("reservation");
		const stored = useStorageItem("config");
		return <output>{JSON.stringify({all, item, stored})}</output>;
	}
	const read = () => JSON.parse(container.textContent ?? "null");
	let revision = 0;
	const emit = (event: { "@type": string; [key: string]: unknown }) =>
		wire.handlers.get(event["@type"])?.({generation: 1, revision: ++revision, ...event}, {isOpen: true});
	const pending: Occupancy = {
		uuid: "reservation",
		appId: "app-a",
		boxNumber: "1",
		accessCode: null,
		accessKeys: [],
		created: "2026-09-11T12:00:00Z",
		state: "pending",
		content: null,
		actor: null,
		action: null,
	};
	try {
		await act(async () =>
			root.render(
				<CubeProvider session={session}>
					<Probe />
				</CubeProvider>,
			)
		);
		await act(async () => {
			wire.onOpen();
		});
		expect(read().all.status).toBe("initializing");
		await act(async () =>
			emit({
				"@type": "initialState",
				identity: {cubeId: "cube-1", appId: "app-a", token: null, expiresAt: null},
				compartments: [],
				devices: [],
				occupancies: [pending],
			})
		);
		expect(read().stored.status).toBe("initializing");
		await act(async () =>
			emit({
				"@type": "storageItem",
				key: "config",
				encoding: "json",
				contentType: "application/json",
				content: null,
			})
		);
		expect(read().stored.status).toBe("initializing");
		await act(async () => emit({"@type": "ready"}));
		expect(read().stored).toEqual({status: "ready", data: null});
		await act(async () =>
			emit({
				"@type": "storageItem",
				key: "config",
				encoding: "json",
				contentType: "application/json",
				content: {value: 1},
			})
		);
		expect(read().stored).toEqual({status: "ready", data: {value: 1}});
		await act(async () => emit({"@type": "storageItemRemoved", key: "config"}));
		// JSON.stringify drops the undefined data of a missing key.
		expect(read().stored).toEqual({status: "ready"});
		expect(read().item.data.state).toBe("pending");
		const confirmed = {...pending, state: "confirmed"};
		await act(async () => emit({"@type": "occupancyCreated", occupancy: confirmed}));
		expect(read().item.data.state).toBe("confirmed");
		const updated = {...confirmed, content: {handover: "one"}};
		await act(async () => emit({"@type": "occupancyUpdated", occupancy: updated}));
		expect(read().item.data.content).toEqual({handover: "one"});
		await act(async () => emit({"@type": "occupancyAccessChanged", occupancy: {...updated, accessKeys: ["key"]}}));
		expect(read().item.data.accessKeys).toEqual(["key"]);
		await act(async () => emit({"@type": "occupancyEnded", uuid: "reservation"}));
		expect(read().all).toEqual({status: "ready", data: []});
		await act(async () => emit({"@type": "occupancies", occupancies: [pending]}));
		// Controller cancellation emits the same removal event as ending a confirmed occupancy.
		await act(async () => emit({"@type": "occupancyEnded", uuid: "reservation"}));
		expect(read().item).toEqual({status: "ready"});
		await act(async () => emit(fixtures.emptySnapshot));
		expect(read().all).toEqual({status: "ready", data: []});
		await act(async () => emit({"@type": "availability", connected: false}));
		// The hooks share the connection's status and reason instead of a separate per-domain availability.
		expect(read().all).toMatchObject({status: "error", error: {code: "UNAVAILABLE"}});
		expect(read().all).not.toHaveProperty("data");
	}
	finally {
		await act(async () => session.close());
		await act(async () => root.unmount());
	}
});

it("follows the close-after-open time through the real SDK across snapshots, resnapshots and disconnect", async () => {
	(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	wire.connected = true;
	const session = new ControllerSessionImpl("http://localhost:9000", fetch, {
		credential: "test-credential-12345",
		expiresAt: Math.floor(Date.now() / 1000) + 600,
		generation: 1,
	});
	wire.send.mockResolvedValue({protocolMajor: 6, generation: 1});
	const cube = new CubeImpl({session});
	vi.mocked(connect).mockReturnValue(cube);
	const container = document.createElement("div");
	const root = createRoot(container);
	const tags: string[] = [];
	const onLock = (event: LockEvent) => {
		if (isReopenedLockEvent(event)) tags.push(`${event.status} reopened`);
		if (isAllowedCloseLockEvent(event)) tags.push(`${event.status} allowed`);
	};
	function Probe() {
		const seconds = usePreventCloseAfterOpenSeconds();
		useLockEvent(onLock);
		return <output>{seconds === undefined ? "off" : `close within ${seconds}s`}</output>;
	}
	const read = () => container.textContent;
	let revision = 0;
	const emit = (event: { "@type": string; [key: string]: unknown }) =>
		wire.handlers.get(event["@type"])?.({generation: 1, revision: ++revision, ...event}, {isOpen: true});
	const snapshot = (extra: object) =>
		emit({
			"@type": "initialState",
			identity: {cubeId: "cube-1", appId: "app-a", token: null, expiresAt: null},
			compartments: [],
			devices: [],
			occupancies: [],
			...extra,
		});
	try {
		await act(async () =>
			root.render(
				<CubeProvider session={session}>
					<Probe />
				</CubeProvider>,
			)
		);
		await act(async () => {
			wire.onOpen();
		});
		expect(read()).toBe("off");
		// The setting is known with the snapshot, before the storage barrier makes the connection ready.
		await act(async () => snapshot({preventCloseAfterOpenSeconds: 120}));
		expect(read()).toBe("close within 120s");
		await act(async () => emit({"@type": "ready"}));
		expect(read()).toBe("close within 120s");
		await act(async () =>
			emit({"@type": "lock", lock: "l", status: "OPEN", actor: "controller", action: "reopen"})
		);
		await act(async () =>
			emit({"@type": "lock", lock: "l", status: "CLOSED", actor: "controller", action: "allow close"})
		);
		await act(async () => emit({"@type": "lock", lock: "l", status: "OPEN", actor: "customer", action: "collect"}));
		expect(tags).toEqual(["OPEN reopened", "CLOSED allowed"]);
		// The React package re-exports the same values as the SDK.
		expect([LOCK_EVENT_ACTOR_CONTROLLER, LOCK_EVENT_ACTION_REOPEN, LOCK_EVENT_ACTION_ALLOW_CLOSE]).toEqual([
			"controller",
			"reopen",
			"allow close",
		]);
		// A same-generation resnapshot replaces the setting; null and an absent key both read as off.
		await act(async () => snapshot({preventCloseAfterOpenSeconds: 45}));
		expect(read()).toBe("close within 45s");
		await act(async () => emit({"@type": "ready"}));
		await act(async () => snapshot({preventCloseAfterOpenSeconds: null}));
		expect(read()).toBe("off");
		await act(async () => emit({"@type": "ready"}));
		await act(async () => snapshot({preventCloseAfterOpenSeconds: 60}));
		await act(async () => emit({"@type": "ready"}));
		expect(read()).toBe("close within 60s");
		await act(async () => {
			wire.onClose();
		});
		expect(cube.connection.status).toBe("disconnected");
		expect(read()).toBe("off");
		// A reconnect to a controller that does not send the setting stays off and still becomes ready.
		revision = 0;
		await act(async () => {
			wire.onOpen();
		});
		await act(async () => snapshot({}));
		await act(async () => emit({"@type": "ready"}));
		expect(cube.connection.status).toBe("ready");
		expect(read()).toBe("off");
	}
	finally {
		await act(async () => session.close());
		await act(async () => root.unmount());
	}
});
