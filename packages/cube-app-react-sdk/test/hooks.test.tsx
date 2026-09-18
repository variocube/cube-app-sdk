// @vitest-environment jsdom
import {
	AvailabilityState,
	connect,
	ControllerSession,
	Cube,
	CubeError,
	CubeIdentity,
	Occupancy,
	OccupancyState,
} from "@variocube/cube-app-sdk";
import React, {act} from "react";
import {createRoot, Root} from "react-dom/client";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {CubeProvider, useIdentity, useOccupancies, useOccupancy, useStorageItem, useStorageValue} from "../src/index";

vi.mock("@variocube/cube-app-sdk", async importOriginal => ({
	...await importOriginal<typeof import("@variocube/cube-app-sdk")>(),
	connect: vi.fn(),
}));

const appA: CubeIdentity = {cubeId: "cube-1", appId: "app-a", token: "secret-a", expiresAt: 1000};
const appB: CubeIdentity = {...appA, appId: "app-b", token: "secret-b"};

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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return {promise, resolve, reject};
}

class TestCube {
	connected = true;
	compartments = [];
	devices = [];
	identity: CubeIdentity | undefined = appA;
	occupancies = {state: {status: "ready", data: []} as OccupancyState};
	storage = {state: {status: "ready"} as AvailabilityState, get: vi.fn<(key: string) => Promise<unknown>>()};
	listeners = new Map<string, Set<(event: unknown) => void>>();
	onSubscribe?: (name: string) => void;
	close = vi.fn();
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
	setOccupancies(state: OccupancyState) {
		this.occupancies.state = state;
		this.emit("occupancies", {occupancies: state});
	}
	setApp(identity: CubeIdentity | undefined, status: AvailabilityState["status"] = "loading") {
		this.identity = identity;
		this.storage.state = {status};
		this.occupancies.state = {status};
		this.emit("identity", {identity});
		this.emit("availability", {occupancies: this.occupancies.state, storage: this.storage.state});
	}
	ready(data: Occupancy[] = []) {
		this.storage.state = {status: "ready"};
		this.setOccupancies({status: "ready", data});
		this.emit("availability", {occupancies: this.occupancies.state, storage: this.storage.state});
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
	cube.storage.get.mockResolvedValue("initial");
	vi.mocked(connect).mockReturnValue(cube as unknown as Cube);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	for (const session of sessions.values()) session.close();
	sessions.clear();
});

const sessions = new Map<string, ControllerSession>();
async function render(children: React.ReactNode, host = "first") {
	let session = sessions.get(host);
	if (!session) {
		session = new ControllerSession(`https://${host}.example`, fetch, {
			credential: "test-credential-12345",
			expiresAt: Math.floor(Date.now() / 1000) + 600,
			generation: 1,
		});
		sessions.set(host, session);
	}
	await act(async () => root.render(<CubeProvider session={session}>{children}</CubeProvider>));
}

function StorageProbe({documentKey}: { documentKey: string }) {
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
	it("renders an initial loading state, JSON null, and deleted/not-found distinctly", async () => {
		const pending = deferred<unknown>();
		cube.storage.get.mockReturnValueOnce(pending.promise);
		await render(<StorageProbe documentKey="document" />);
		expect(output()).toEqual({key: "document", status: "loading"});
		await act(async () => pending.resolve(null));
		expect(output()).toEqual({key: "document", status: "ready", data: null});
		cube.storage.get.mockRejectedValueOnce(new CubeError("NOT_FOUND", "Document was deleted"));
		await act(async () => cube.emit("storage", {key: "document"}));
		expect(output()).toMatchObject({status: "not-found", code: "NOT_FOUND"});
		expect(output()).not.toHaveProperty("data");
	});

	it("clears invalidated values and ignores older invalidation responses", async () => {
		await render(<StorageProbe documentKey="document" />);
		const oldRead = deferred<unknown>();
		const latestRead = deferred<unknown>();
		cube.storage.get.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(latestRead.promise);
		await act(async () => cube.emit("storage", {key: "unrelated"}));
		expect(cube.storage.get).toHaveBeenCalledTimes(1);
		await act(async () => cube.emit("storage", {key: "document"}));
		expect(output()).toEqual({key: "document", status: "loading"});
		await act(async () => cube.emit("storage", {key: "document"}));
		await act(async () => latestRead.resolve("latest"));
		await act(async () => oldRead.resolve("old"));
		expect(output().data).toBe("latest");
	});

	it("does not lose an invalidation arriving during the initial read", async () => {
		const staleRead = deferred<unknown>();
		cube.storage.get.mockImplementationOnce(() => {
			cube.emit("storage", {key: "document"});
			return staleRead.promise;
		}).mockResolvedValueOnce("replacement");
		await render(<StorageProbe documentKey="document" />);
		expect(output().data).toBe("replacement");
		await act(async () => staleRead.resolve("stale"));
		expect(output().data).toBe("replacement");
	});

	it("changes keys without exposing the previous value or accepting late reads", async () => {
		const oldRead = deferred<unknown>();
		const nextRead = deferred<unknown>();
		await render(<StorageProbe documentKey="old" />);
		expect(output().data).toBe("initial");
		cube.storage.get.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(nextRead.promise);
		await act(async () => cube.emit("storage", {key: "old"}));
		await render(<StorageProbe documentKey="next" />);
		expect(output()).toEqual({key: "next", status: "loading"});
		await act(async () => oldRead.resolve("old"));
		expect(output()).not.toHaveProperty("data");
		await act(async () => nextRead.resolve("next"));
		expect(output()).toEqual({key: "next", status: "ready", data: "next"});
	});

	it("retains a loaded document when only the token is renewed", async () => {
		await render(<StorageProbe documentKey="document" />);
		await act(async () => {
			cube.identity = {...appA, token: "renewed", expiresAt: 2000};
			cube.emit("identity", {identity: cube.identity});
		});
		expect(output().data).toBe("initial");
		expect(cube.storage.get).toHaveBeenCalledOnce();
	});

	it("re-reads after disconnect/reconnect and direct app A to B changes", async () => {
		await render(<StorageProbe documentKey="document" />);
		const oldAppRead = deferred<unknown>();
		cube.storage.get.mockReturnValueOnce(oldAppRead.promise);
		await act(async () => cube.emit("storage", {key: "document"}));
		await act(async () => cube.setApp(appB));
		expect(output().status).toBe("loading");
		cube.storage.get.mockResolvedValue("app-b");
		await act(async () => cube.ready());
		await act(async () => oldAppRead.resolve("app-a"));
		expect(output().data).toBe("app-b");
		await act(async () => {
			cube.setApp(undefined, "unavailable");
			cube.emit("close");
		});
		expect(output()).toEqual({key: "document", status: "unavailable"});
		cube.storage.get.mockResolvedValue("reconnected");
		await act(async () => {
			cube.setApp(appB);
			cube.emit("open");
			cube.ready();
		});
		expect(output().data).toBe("reconnected");
	});

	it("replaces the provider, rejects old responses, and removes every subscription", async () => {
		const oldRead = deferred<unknown>();
		cube.storage.get.mockReturnValueOnce(oldRead.promise);
		await render(<StorageProbe documentKey="document" />);
		const replacement = new TestCube();
		replacement.storage.get.mockResolvedValue("replacement");
		vi.mocked(connect).mockReturnValue(replacement as unknown as Cube);
		await render(<StorageProbe documentKey="document" />, "second");
		expect(cube.close).toHaveBeenCalledOnce();
		expect(cube.listenerCount()).toBe(0);
		await act(async () => oldRead.resolve("stale"));
		expect(output().data).toBe("replacement");
		await act(async () => root.unmount());
		expect(replacement.listenerCount()).toBe(0);
		expect(replacement.close).toHaveBeenCalledOnce();
	});

	it("reports unsupported and read failures without a current value", async () => {
		cube.storage.state = {status: "unavailable", error: new CubeError("UNSUPPORTED", "Old controller")};
		await render(<StorageProbe documentKey="document" />);
		expect(output()).toMatchObject({status: "unavailable", code: "UNSUPPORTED"});
		expect(cube.storage.get).not.toHaveBeenCalled();
		cube.storage.get.mockRejectedValue(new CubeError("INVALID_CONTENT_TYPE", "Use getBlob"));
		await act(async () => cube.ready());
		expect(output()).toMatchObject({status: "error", code: "INVALID_CONTENT_TYPE"});
	});

	it("value-only convenience preserves null and clears on deletion", async () => {
		function ValueProbe() {
			const value = useStorageValue<unknown>("document");
			return <output>{value === undefined ? "undefined" : JSON.stringify(value)}</output>;
		}
		cube.storage.get.mockResolvedValue(null);
		await render(<ValueProbe />);
		expect(container.textContent).toBe("null");
		cube.storage.get.mockRejectedValue(new CubeError("NOT_FOUND", "Deleted"));
		await act(async () => cube.emit("storage", {key: "document"}));
		expect(container.textContent).toBe("undefined");
	});
});

describe("occupancy and identity hooks", () => {
	it("renders loading separately from loaded empty and captures snapshot changes during mount", async () => {
		cube.occupancies.state = {status: "loading"};
		await render(<OccupancyProbe />);
		expect(output().result).toEqual({status: "loading"});
		await act(async () => cube.setOccupancies({status: "ready", data: []}));
		expect(output().result).toEqual({status: "ready", data: []});
		expect(output().selected).toEqual({status: "ready"});
	});

	it("reads a snapshot delivered between render and subscription", async () => {
		cube.onSubscribe = name => {
			if (name === "occupancies") {
				cube.onSubscribe = undefined;
				cube.setOccupancies({status: "ready", data: [occupancy("one")]});
			}
		};
		await render(<OccupancyProbe />);
		expect(output().selected.data.uuid).toBe("one");
	});

	it("renders create, confirm/update, access, end, cancellation, and full snapshot replacement", async () => {
		await render(<OccupancyProbe />);
		const created = occupancy("one");
		await act(async () => cube.setOccupancies({status: "ready", data: [created]}));
		expect(output().selected.data.state).toBe("pending");
		const updated = {...created, state: "confirmed" as const, content: {handover: "test"}};
		await act(async () => cube.setOccupancies({status: "ready", data: [updated]}));
		expect(output().selected.data).toMatchObject({state: "confirmed", content: {handover: "test"}});
		await act(async () => cube.setOccupancies({status: "ready", data: [{...updated, accessKeys: ["new-key"]}]}));
		expect(output().selected.data.accessKeys).toEqual(["new-key"]);
		await act(async () => cube.setOccupancies({status: "ready", data: []}));
		expect(output().selected).toEqual({status: "ready"});
		await act(async () => cube.setOccupancies({status: "ready", data: [created]}));
		await act(async () => cube.setOccupancies({status: "ready", data: []}));
		expect(output().result.data).toEqual([]);
		await act(async () => cube.setOccupancies({status: "ready", data: [occupancy("two")]}));
		expect(output().result.data.map((item: Occupancy) => item.uuid)).toEqual(["two"]);
	});

	it("selects a changed UUID immediately and distinguishes unknown from an absent entry", async () => {
		cube.occupancies.state = {status: "ready", data: [occupancy("one"), occupancy("two")]};
		await render(<OccupancyProbe uuid="one" />);
		await render(<OccupancyProbe uuid="two" />);
		expect(output().selected.data.uuid).toBe("two");
		await render(<OccupancyProbe uuid="missing" />);
		expect(output().selected).toEqual({status: "ready"});
		await act(async () => cube.setApp(undefined, "unavailable"));
		expect(output().selected).toEqual({status: "unavailable"});
		expect(output()).not.toHaveProperty("identity");
	});

	it("updates identity on renewal and clears occupancy data on app changes and reconnect", async () => {
		cube.occupancies.state = {status: "ready", data: [occupancy("one")]};
		await render(<OccupancyProbe />);
		await act(async () => {
			cube.identity = {...appA, token: "renewed", expiresAt: 2000};
			cube.emit("identity", {identity: cube.identity});
		});
		expect(output().identity.expiresAt).toBe(2000);
		await act(async () => cube.setApp(appB));
		expect(output().identity.appId).toBe("app-b");
		expect(output().result).toEqual({status: "loading"});
		await act(async () => cube.ready());
		expect(output().result).toEqual({status: "ready", data: []});
		await act(async () => cube.setApp(undefined, "unavailable"));
		expect(output().result).toEqual({status: "unavailable"});
		await act(async () => cube.setApp(appB));
		await act(async () => cube.ready());
		expect(output().result).toEqual({status: "ready", data: []});
	});

	it("replaces provider identity/snapshot and cleans up occupancy and identity listeners", async () => {
		cube.occupancies.state = {status: "ready", data: [occupancy("one")]};
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
});
