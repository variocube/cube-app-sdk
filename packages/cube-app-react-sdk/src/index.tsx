import {
	CodeEvent,
	Compartment,
	connect,
	ConnectionState,
	ConnectionStatus,
	ConnectOptions,
	ControllerSession,
	Cube,
	CubeError,
	CubeIdentity,
	Device,
	EventListener,
	LockEvent,
	LockStatus,
	Occupancy,
} from "@variocube/cube-app-sdk";
import React, {createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState} from "react";

// Re-export the SDK's types via `export type *` so runtime values like `connect` are NOT
// re-exported — React SDK consumers should use CubeProvider instead of connecting directly.
// What an app needs at runtime is re-exported explicitly below: session bootstrap (call it before
// loading React), error handling and the reader configuration helpers.
// `dprint-ignore` because dprint 0.77.0 wrongly strips the `type` from `export type *`.
// dprint-ignore
export type * from "@variocube/cube-app-sdk";
export { bootstrapSession, CubeError, Symbology, validateCodeReaderConfig } from "@variocube/cube-app-sdk";

export type Locks = Record<string, LockStatus>;

interface CubeContextContent {
	cube?: Cube;
	connected: boolean;
	compartments: Compartment[];
	devices: Device[];
	locks: Locks;
}

const CubeContext = createContext<CubeContextContent>({
	connected: false,
	compartments: [],
	devices: [],
	locks: {},
});

/**
 * A React component that establishes a React context for a cube.
 * @param props The properties
 */
export function CubeProvider(props: PropsWithChildren<ConnectOptions>) {
	// A changed session owns a new connection and subtree. Never render the old cube's
	// identity or business data while the replacement connection is being established.
	return <CubeConnection key={`${sessionKey(props.session)}:${props.secondary}`} {...props} />;
}

const sessionKeys = new WeakMap<ControllerSession, number>();
let nextSessionKey = 0;

function sessionKey(session: ControllerSession) {
	if (!sessionKeys.has(session)) sessionKeys.set(session, nextSessionKey++);
	return sessionKeys.get(session);
}

function CubeConnection(props: PropsWithChildren<ConnectOptions>) {
	const {
		children,
		session,
		secondary,
	} = props;

	const [cube, setCube] = useState<Cube>();
	const [connected, setConnected] = useState(false);
	const [compartments, setCompartments] = useState<Compartment[]>([]);
	const [devices, setDevices] = useState<Device[]>([]);
	const [locks, setLocks] = useState<Record<string, LockStatus>>({});

	useEffect(() => {
		const cube = connect({session, secondary});
		const unsubscribe = [
			cube.addEventListener("open", () => setConnected(true)),
			cube.addEventListener("close", () => setConnected(false)),
			cube.addEventListener("compartments", ({compartments}) => setCompartments(compartments)),
			cube.addEventListener("devices", ({devices}) => setDevices(devices)),
			cube.addEventListener("lock", ({lock, status}) => setLocks(prev => ({...prev, [lock]: status}))),
		];
		setConnected(cube.connected);
		setCompartments(cube.compartments);
		setDevices(cube.devices);
		setLocks({});
		setCube(cube);

		return () => {
			unsubscribe.forEach(remove => remove());
			cube.close();
		};
	}, [session, secondary]);

	const value = useMemo(() => ({
		cube,
		connected,
		compartments,
		devices,
		locks,
	}), [cube, connected, compartments, devices, locks]);

	// Hacky, but this allows us to wait until the `cube` state has been initialized.
	// This happens directly after the first render in the `useEffect` above.
	if (!cube) {
		return null;
	}

	return (
		<CubeContext.Provider value={value}>
			{children}
		</CubeContext.Provider>
	);
}

/**
 * Returns the cube.
 */
export function useCube() {
	const {cube} = useContext(CubeContext);
	if (!cube) {
		throw new Error("No cube found in context. Are you missing a CubeProvider?");
	}
	return cube;
}

/**
 * Returns whether the cube is currently connected.
 */
export function useConnected() {
	const {connected} = useContext(CubeContext);
	return connected;
}

/**
 * Returns the lock status of the specified compartment
 * @param number The compartment number
 */
export function useCompartmentLockStatus(number: string) {
	const cube = useCube();
	const locks = useLocks();

	const lock = cube.getCompartmentLock(number);

	return lock ? locks[lock] : undefined;
}

/**
 * Returns the currently connected devices.
 */
export function useDevices() {
	const {devices} = useContext(CubeContext);
	return devices;
}

/**
 * Returns the compartments.
 */
export function useCompartments() {
	const {compartments} = useContext(CubeContext);
	return compartments;
}

/**
 * Returns the locks.
 */
export function useLocks() {
	const {locks} = useContext(CubeContext);
	return locks;
}

/**
 * Attaches the specified code event listener
 * @param listener The code event listener
 */
export function useCodeEvent(listener: EventListener<CodeEvent>) {
	const cube = useCube();
	useEffect(() => cube.addEventListener("code", listener), [cube, listener]);
}

/**
 * Attaches the specified lock event listener
 * @param listener The lock event listener
 */
export function useLockEvent(listener: EventListener<LockEvent>) {
	const cube = useCube();
	useEffect(() => cube.addEventListener("lock", listener), [cube, listener]);
}

/**
 * Data that is only known while the connection is ready. Any other status carries no data, so loading or a lost
 * connection is never mistaken for empty or absent data.
 */
export type CubeResult<T> =
	| { status: "ready"; data: T; error?: undefined }
	| { status: Exclude<ConnectionStatus, "ready">; data?: undefined; error?: CubeError };

type Subscription = (cube: Cube, listener: () => void) => () => void;

function useCubeSnapshot<T>(read: (cube: Cube) => T, subscribe: Subscription): T {
	const cube = useCube();
	const [snapshot, setSnapshot] = useState(() => ({cube, read, value: read(cube)}));
	useEffect(() => {
		const update = () => setSnapshot({cube, read, value: read(cube)});
		const unsubscribe = subscribe(cube, update);
		// Subscribe first, then read: an event between render and effect must not be lost.
		update();
		return unsubscribe;
	}, [cube, read, subscribe]);
	// Never return what was read from a previous cube or for a previous key.
	return snapshot.cube === cube && snapshot.read === read ? snapshot.value : read(cube);
}

function readResult<T>(cube: Cube, read: () => T): CubeResult<T> {
	const {status, error} = cube.connection;
	if (status !== "ready") return {status, error};
	try {
		return {status, data: read()};
	}
	catch (cause) {
		return {
			status: "error",
			error: cause instanceof CubeError ? cause : new CubeError("INTERNAL_ERROR", String(cause)),
		};
	}
}

const readConnection = (cube: Cube) => cube.connection;
const subscribeConnection: Subscription = (cube, listener) => cube.addEventListener("connection", listener);

/** Authentication and snapshot readiness; `useConnected()` is the shorthand for status `ready`. */
export function useConnectionState(): ConnectionState {
	return useCubeSnapshot(readConnection, subscribeConnection);
}

const readIdentity = (cube: Cube) => cube.identity;
const subscribeIdentity: Subscription = (cube, listener) => cube.addEventListener("identity", listener);

/** The cube and installed app; undefined while unknown. Tokens come from `useCube().getToken()`. */
export function useIdentity(): CubeIdentity | undefined {
	return useCubeSnapshot(readIdentity, subscribeIdentity);
}

const readOccupancies = (cube: Cube) => readResult(cube, () => cube.occupancies.list());
const subscribeOccupancies: Subscription = (cube, listener) => {
	const unsubscribe = [
		cube.addEventListener("occupancies", listener),
		cube.addEventListener("connection", listener),
	];
	return () => unsubscribe.forEach(remove => remove());
};

/** The controller's live, authoritative occupancies. A ready empty array means there are none. */
export function useOccupancies(): CubeResult<Occupancy[]> {
	return useCubeSnapshot(readOccupancies, subscribeOccupancies);
}

/** One occupancy; ready with undefined data means the controller has none with this UUID. */
export function useOccupancy(uuid: string): CubeResult<Occupancy | undefined> {
	const result = useOccupancies();
	return useMemo(
		() => result.status === "ready" ? {...result, data: result.data.find(o => o.uuid === uuid)} : result,
		[result, uuid],
	);
}

/**
 * A JSON value from storage, following writes and deletions. Ready with undefined data means the key is missing or
 * deleted; a stored JSON null is ready with null.
 */
export function useStorageItem<T>(key: string): CubeResult<T | undefined> {
	const read = useCallback((cube: Cube) => readResult(cube, () => cube.storage.get<T>(key)), [key]);
	const subscribe = useCallback<Subscription>((cube, listener) => {
		const unsubscribe = [
			cube.addEventListener("storage", event => {
				if (event.key === key) listener();
			}),
			cube.addEventListener("connection", listener),
		];
		return () => unsubscribe.forEach(remove => remove());
	}, [key]);
	return useCubeSnapshot(read, subscribe);
}

/** Value-only convenience. Use useStorageItem to establish absence for business decisions. */
export function useStorageValue<T>(key: string): T | undefined {
	return useStorageItem<T>(key).data;
}
