// @vitest-environment jsdom
import {
	connect,
	ConnectionState,
	ControllerSession,
	Cube,
	CubeError,
	CubeIdentity,
	Occupancy,
} from "@variocube/cube-app-sdk";
import React, {act} from "react";
import {createRoot, Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
	bootstrapSession,
	CubeProvider,
	useConnected,
	useConnectionState,
	useIdentity,
	useOccupancies,
	useOccupancy,
	useStorageItem,
	useStorageValue,
} from "../src/index";

vi.mock("@variocube/cube-app-sdk", async importOriginal => ({
	...await importOriginal<typeof import("@variocube/cube-app-sdk")>(),
	connect: vi.fn(),
}));

const appA: CubeIdentity = {cubeId: "cube-1", appId: "app-a"};
const appB: CubeIdentity = {cubeId: "cube-1", appId: "app-b"};
const disconnected = new CubeError("DISCONNECTED", "test disconnect");

function occupancy(uuid: string, changes: Partial<Occupancy> = {}): Occupancy {
	return {
		uuid,
		appId: "app-a",
		boxNumber: "1",
		accessCode: null,
		accessKeys: [],
		created: "2026-09-11T12:00:00.000Z",
		content: null,
		actor: null,
		action: null,
		state: "pending",
		...changes,
	};
}

/** Mirrors the SDK contract: synchronous reads that throw unless the connection is ready. */
class TestCube {
	connection: ConnectionState = {status: "ready"};
	compartments = [];
	devices = [];
	identity: CubeIdentity | undefined = appA;
	data: Occupancy[] = [];
	items = new Map<string, unknown>([["document", "initial"]]);
	occupancies = {
		list: vi.fn(() => {
			this.assertReady();
			return this.data;
		}),
	};
	storage = {
		get: vi.fn((key: string) => {
			this.assertReady();
			return this.items.get(key);
		}),
	};
	listeners = new Map<string, Set<(event: unknown) => void>>();
	onSubscribe?: (name: string) => void;
	close = vi.fn();
	get connected() {
		return this.connection.status === "ready";
	}
	assertReady() {
		if (!this.connected) throw this.connection.error ?? disconnected;
	}
	addEventListener(name: string, listener: (event: unknown) => void) {
		this.onSubscribe?.(name);
		const listeners = this.listeners.get(name) ?? new Set();
		listeners.add(listener);
		this.listeners.set(name, listeners);
		return () => this.removeEventListener(name, listener);
	}
	removeEventListener(name: string, listener: (event: unknown) => void) {
		this.listeners.get(name)?.delete(listener);
	}
	emit(name: string, event: unknown = {}) {
		for (const listener of this.listeners.get(name) ?? []) listener(event);
	}
	setOccupancies(data: Occupancy[]) {
		this.data = data;
		this.emit("occupancies", {occupancies: data});
	}
	setItem(key: string, value: unknown) {
		if (value === undefined) this.items.delete(key);
		else this.items.set(key, value);
		this.emit("storage", {key});
	}
	/** Like the SDK, leaving ready drops identity and data before the connection event. */
	setConnection(connection: ConnectionState, identity: CubeIdentity | undefined = this.identity) {
		const wasReady = this.connected;
		this.connection = connection;
		if (connection.status !== "ready") {
			this.data = [];
			this.items.clear();
			identity = undefined;
		}
		if (identity !== this.identity) {
			this.identity = identity;
			this.emit("identity", {identity});
		}
		this.emit("connection", {connection});
		if (wasReady !== this.connected) this.emit(this.connected ? "open" : "close");
	}
	listenerCount() {
		return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
	}
}

let container: HTMLDivElement;
let root: Root;
let cube: TestCube;

beforeEach(() => {
	(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
	cube = new TestCube();
	vi.mocked(connect).mockReturnValue(cube as unknown as Cube);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
});

// `connect` is mocked, so the provider only needs distinct session objects.
const sessions = new Map<string, ControllerSession>();
async function render(children: React.ReactNode, host = "first") {
	let session = sessions.get(host);
	if (!session) {
		session = {endpoint: `https://${host}.example`, openMaintenance: vi.fn(), close: vi.fn()};
		sessions.set(host, session);
	}
	await act(async () => root.render(<CubeProvider session={session}>{children}</CubeProvider>));
}

function StorageProbe({documentKey = "document"}: { documentKey?: string }) {
	const result = useStorageItem<unknown>(documentKey);
	return <output>{JSON.stringify({key: documentKey, ...result, code: result.error?.code})}</output>;
}

function OccupancyProbe({uuid = "one"}: { uuid?: string }) {
	const result = useOccupancies();
	const selected = useOccupancy(uuid);
	const identity = useIdentity();
	return <output>{JSON.stringify({result, selected, identity})}</output>;
}

function output() {
	return JSON.parse(container.querySelector("output")?.textContent ?? "null");
}

describe("storage hooks", () => {
	it("distinguishes not ready, a stored JSON null, a value and a missing or deleted key", async () => {
		cube.connection = {status: "initializing"};
		await render(<StorageProbe />);
		expect(output()).toEqual({key: "document", status: "initializing"});
		await act(async () => cube.setConnection({status: "ready"}));
		expect(output()).toEqual({key: "document", status: "ready", data: "initial"});
		await act(async () => cube.setItem("document", null));
		expect(output()).toEqual({key: "document", status: "ready", data: null});
		await act(async () => cube.setItem("document", undefined));
		// Ready without data: the key is authoritatively absent.
		expect(output()).toEqual({key: "document", status: "ready"});
	});

	it("re-reads only when its own key changes", async () => {
		await render(<StorageProbe />);
		const reads = cube.storage.get.mock.calls.length;
		await act(async () => cube.setItem("other", "ignored"));
		expect(cube.storage.get).toHaveBeenCalledTimes(reads);
		await act(async () => cube.setItem("document", "changed"));
		expect(output().data).toBe("changed");
	});

	it("does not lose a change arriving between render and subscription", async () => {
		cube.onSubscribe = name => {
			if (name === "storage") {
				cube.onSubscribe = undefined;
				cube.setItem("document", "fresh");
			}
		};
		await render(<StorageProbe />);
		expect(output().data).toBe("fresh");
	});

	it("changes keys without exposing the previous key's value", async () => {
		cube.items.set("second", "two");
		await render(<StorageProbe documentKey="document" />);
		await render(<StorageProbe documentKey="second" />);
		expect(output()).toEqual({key: "second", status: "ready", data: "two"});
		await act(async () => cube.setItem("document", "late change of the old key"));
		expect(output().data).toBe("two");
	});

	it("drops the value with the connection and reads the new snapshot after reconnect", async () => {
		await render(<StorageProbe />);
		await act(async () => cube.setConnection({status: "disconnected"}));
		expect(output()).toEqual({key: "document", status: "disconnected"});
		cube.items.set("document", "after reconnect");
		await act(async () => cube.setConnection({status: "ready"}, appB));
		expect(output()).toEqual({key: "document", status: "ready", data: "after reconnect"});
	});

	it("reports the connection's failure and read failures without a value", async () => {
		await render(<StorageProbe />);
		const failure = new CubeError("AUTHENTICATION_REQUIRED", "A fresh kiosk launch is required.");
		await act(async () => cube.setConnection({status: "unavailable", error: failure}));
		expect(output()).toMatchObject({status: "unavailable", code: "AUTHENTICATION_REQUIRED"});
		expect(output()).not.toHaveProperty("data");
		cube.storage.get.mockImplementation(() => {
			throw new CubeError("INVALID_CONTENT_TYPE", "binary");
		});
		await act(async () => cube.setConnection({status: "ready"}, appA));
		expect(output()).toMatchObject({status: "error", code: "INVALID_CONTENT_TYPE"});
		expect(output()).not.toHaveProperty("data");
	});

	it("replaces the provider and removes every subscription", async () => {
		await render(<StorageProbe />);
		const replacement = new TestCube();
		replacement.items.set("document", "replacement");
		vi.mocked(connect).mockReturnValue(replacement as unknown as Cube);
		await render(<StorageProbe />, "second");
		expect(output().data).toBe("replacement");
		expect(cube.close).toHaveBeenCalled();
		expect(cube.listenerCount()).toBe(0);
		await act(async () => root.unmount());
		expect(replacement.listenerCount()).toBe(0);
	});

	it("value-only convenience preserves null and clears on deletion", async () => {
		function Probe() {
			const value = useStorageValue<string | null>("document");
			return <output>{JSON.stringify({value, defined: value !== undefined})}</output>;
		}
		cube.items.set("document", null);
		await render(<Probe />);
		expect(output()).toEqual({value: null, defined: true});
		await act(async () => cube.setItem("document", undefined));
		expect(output()).toEqual({defined: false});
	});
});

describe("occupancy, identity and connection hooks", () => {
	it("renders not ready separately from loaded empty", async () => {
		cube.connection = {status: "initializing"};
		await render(<OccupancyProbe />);
		expect(output().result).toEqual({status: "initializing"});
		expect(output().selected).toEqual({status: "initializing"});
		await act(async () => cube.setConnection({status: "ready"}));
		expect(output().result).toEqual({status: "ready", data: []});
		expect(output().selected).toEqual({status: "ready"});
	});

	it("reads a snapshot delivered between render and subscription", async () => {
		cube.onSubscribe = name => {
			if (name === "occupancies") {
				cube.onSubscribe = undefined;
				cube.setOccupancies([occupancy("one")]);
			}
		};
		await render(<OccupancyProbe />);
		expect(output().selected.data.uuid).toBe("one");
	});

	it("renders create, confirm/update, access, end, cancellation, and full snapshot replacement", async () => {
		await render(<OccupancyProbe />);
		const created = occupancy("one");
		await act(async () => cube.setOccupancies([created]));
		expect(output().selected.data.state).toBe("pending");
		const updated = {...created, state: "confirmed" as const, content: {handover: "test"}};
		await act(async () => cube.setOccupancies([updated]));
		expect(output().selected.data).toMatchObject({state: "confirmed", content: {handover: "test"}});
		await act(async () => cube.setOccupancies([{...updated, accessKeys: ["new-key"]}]));
		expect(output().selected.data.accessKeys).toEqual(["new-key"]);
		await act(async () => cube.setOccupancies([]));
		expect(output().selected).toEqual({status: "ready"});
		await act(async () => cube.setOccupancies([occupancy("two")]));
		expect(output().result.data.map((item: Occupancy) => item.uuid)).toEqual(["two"]);
	});

	it("selects a changed UUID immediately and distinguishes unknown from an absent entry", async () => {
		cube.data = [occupancy("one"), occupancy("two")];
		await render(<OccupancyProbe uuid="one" />);
		await render(<OccupancyProbe uuid="two" />);
		expect(output().selected.data.uuid).toBe("two");
		await render(<OccupancyProbe uuid="missing" />);
		expect(output().selected).toEqual({status: "ready"});
		await act(async () => cube.setConnection({status: "disconnected"}));
		expect(output().selected).toEqual({status: "disconnected"});
		expect(output()).not.toHaveProperty("identity");
	});

	it("follows identity and clears occupancy data across reconnects", async () => {
		cube.data = [occupancy("one")];
		await render(<OccupancyProbe />);
		expect(output().identity).toEqual(appA);
		await act(async () => cube.setConnection({status: "disconnected"}));
		expect(output().result).toEqual({status: "disconnected"});
		await act(async () => cube.setConnection({status: "ready"}, appB));
		expect(output().identity).toEqual(appB);
		expect(output().result).toEqual({status: "ready", data: []});
	});

	it("replaces provider identity/snapshot and cleans up occupancy and identity listeners", async () => {
		cube.data = [occupancy("one")];
		await render(<OccupancyProbe />);
		const replacement = new TestCube();
		replacement.identity = appB;
		vi.mocked(connect).mockReturnValue(replacement as unknown as Cube);
		await render(<OccupancyProbe />, "second");
		expect(output().identity.appId).toBe("app-b");
		expect(output().result.data).toEqual([]);
		expect(cube.listenerCount()).toBe(0);
		await act(async () => root.unmount());
		expect(replacement.listenerCount()).toBe(0);
	});

	it("keeps useConnected and useConnectionState on the same readiness model", async () => {
		function Probe() {
			return <output>{JSON.stringify({connected: useConnected(), status: useConnectionState().status})}</output>;
		}
		cube.connection = {status: "initializing"};
		await render(<Probe />);
		expect(output()).toEqual({connected: false, status: "initializing"});
		await act(async () => cube.setConnection({status: "ready"}));
		expect(output()).toEqual({connected: true, status: "ready"});
		await act(async () => cube.setConnection({status: "error", error: disconnected}));
		expect(output()).toEqual({connected: false, status: "error"});
	});

	it("re-exports the session bootstrap so React apps need no second package", () => {
		expect(bootstrapSession).toBeTypeOf("function");
	});
});
