// @vitest-environment jsdom
import {connect, Occupancy} from "@variocube/cube-app-sdk";
import React, {act} from "react";
import {createRoot} from "react-dom/client";
import {expect, it, vi} from "vitest";
import fixtures from "../../../test/fixtures/controller-wire.json";
import {CubeImpl} from "../../cube-app-sdk/src/cube";
import {CubeProvider, useOccupancies, useOccupancy} from "../src/index";

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
			wire.onClose();
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
	const cube = new CubeImpl({host: "test", port: 4000, secondary: false});
	vi.mocked(connect).mockReturnValue(cube);
	const container = document.createElement("div");
	const root = createRoot(container);
	function Probe() {
		const all = useOccupancies();
		const item = useOccupancy("reservation");
		return <output>{JSON.stringify({all, item})}</output>;
	}
	const read = () => JSON.parse(container.textContent ?? "null");
	const emit = (event: { "@type": string; [key: string]: unknown }) =>
		wire.handlers.get(event["@type"])?.(event, {isOpen: true});
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
				<CubeProvider>
					<Probe />
				</CubeProvider>,
			)
		);
		await act(async () => {
			wire.onOpen();
			emit(fixtures.capabilities);
			emit({"@type": "cube", cubeId: "cube-1", appId: "app-a", token: null, expiresAt: null});
		});
		expect(read().all.status).toBe("loading");
		await act(async () => emit({"@type": "occupancies", occupancies: [pending]}));
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
		expect(read().all.status).toBe("unavailable");
		expect(read().all).not.toHaveProperty("data");
	}
	finally {
		await act(async () => root.unmount());
	}
});
