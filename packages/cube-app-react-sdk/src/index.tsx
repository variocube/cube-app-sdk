import {
	AvailabilityState,
	CodeEvent,
	Compartment,
	CompartmentsEvent,
	connect,
	ConnectOptions,
	Cube,
	CubeError,
	CubeIdentity,
	Device,
	DevicesEvent,
	EventListener,
	LockEvent,
	LockStatus,
	Occupancy,
	OccupancyState,
} from "@variocube/cube-app-sdk";
import React, {createContext, PropsWithChildren, useContext, useEffect, useMemo, useState} from "react";

// Re-export the SDK's types via `export type *` so runtime values like `connect` are NOT
// re-exported — React SDK consumers should use CubeProvider instead of connecting directly.
// Runtime error handling and reader configuration helpers are re-exported explicitly below.
// `dprint-ignore` because dprint 0.77.0 wrongly strips the `type` from `export type *`.
// dprint-ignore
export type * from "@variocube/cube-app-sdk";
export { CubeError, Symbology, validateCodeReaderConfig } from "@variocube/cube-app-sdk";

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
	// A changed endpoint owns a new connection and subtree. Never render the old cube's
	// identity or business data while the replacement connection is being established.
	return (
		<CubeConnection
			key={JSON.stringify([props.session.endpoint, props.session.generation, props.secondary])}
			{...props}
		/>
	);
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
		const open = () => setConnected(true);
		const close = () => setConnected(false);
		const lock = ({lock, status}: LockEvent) => setLocks(prev => ({...prev, [lock]: status}));
		const compartments = ({compartments}: CompartmentsEvent) => setCompartments(compartments);
		const devices = ({devices}: DevicesEvent) => setDevices(devices);

		const cube = connect({session, secondary});
		cube.addEventListener("open", open);
		cube.addEventListener("close", close);
		cube.addEventListener("compartments", compartments);
		cube.addEventListener("devices", devices);
		cube.addEventListener("lock", lock);
		setConnected(cube.connected);
		setCompartments(cube.compartments);
		setDevices(cube.devices);
		setLocks({});
		setCube(cube);

		return () => {
			cube.removeEventListener("open", open);
			cube.removeEventListener("close", close);
			cube.removeEventListener("compartments", compartments);
			cube.removeEventListener("devices", devices);
			cube.removeEventListener("lock", lock);
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
	useEffect(() => {
		cube.addEventListener("code", listener);
		return () => cube.removeEventListener("code", listener);
	}, [cube, listener]);
}

/**
 * Attaches the specified lock event listener
 * @param listener The lock event listener
 */
export function useLockEvent(listener: EventListener<LockEvent>) {
	const cube = useCube();
	useEffect(() => {
		cube.addEventListener("lock", listener);
		return () => cube.removeEventListener("lock", listener);
	}, [cube, listener]);
}

/** A JSON document read. JSON null is ready; a missing or deleted document is not-found. */
export type StorageItemResult<T> =
	| { status: "ready"; data: T; error?: undefined }
	| { status: "loading" | "unavailable" | "error" | "not-found"; data?: undefined; error?: CubeError };

/** A selected occupancy is absent only when status is ready and data is undefined. */
export interface OccupancyResult extends AvailabilityState {
	data?: Occupancy;
}

type Subscription = (cube: Cube, listener: () => void) => () => void;

function useCubeSnapshot<T>(read: (cube: Cube) => T, subscribe: Subscription): T {
	const cube = useCube();
	const [snapshot, setSnapshot] = useState(() => ({cube, value: read(cube)}));
	useEffect(() => {
		const update = () => setSnapshot({cube, value: read(cube)});
		const unsubscribe = subscribe(cube, update);
		// Subscribe first, then read: an event between render and effect must not be lost.
		update();
		return unsubscribe;
	}, [cube, read, subscribe]);
	return snapshot.cube === cube ? snapshot.value : read(cube);
}

const readOccupancies = (cube: Cube) => cube.occupancies.state;
const subscribeOccupancies: Subscription = (cube, listener) => {
	cube.addEventListener("occupancies", listener);
	cube.addEventListener("availability", listener);
	cube.addEventListener("identity", listener);
	return () => {
		cube.removeEventListener("occupancies", listener);
		cube.removeEventListener("availability", listener);
		cube.removeEventListener("identity", listener);
	};
};

/** The controller's live, authoritative occupancy snapshot and its availability. */
export function useOccupancies(): OccupancyState {
	return useCubeSnapshot(readOccupancies, subscribeOccupancies);
}

/** Select an occupancy without retaining a previous UUID's result. */
export function useOccupancy(uuid: string): OccupancyResult {
	const state = useOccupancies();
	return useMemo(() => ({
		status: state.status,
		error: state.error,
		data: state.status === "ready" ? state.data?.find(occupancy => occupancy.uuid === uuid) : undefined,
	}), [state, uuid]);
}

const readIdentity = (cube: Cube) => cube.identity;
const subscribeIdentity: Subscription = (cube, listener) => {
	cube.addEventListener("identity", listener);
	return () => cube.removeEventListener("identity", listener);
};

/** Current cube/app identity, including renewals; undefined while disconnected. */
export function useCubeIdentity(): CubeIdentity | undefined {
	return useCubeSnapshot(readIdentity, subscribeIdentity);
}

function initialStorageResult<T>(cube: Cube): StorageItemResult<T> {
	const {status, error} = cube.storage.state;
	return {status: status === "ready" ? "loading" : status, error};
}

/** Read JSON initially and after invalidation, reconnect, or a change of installed app. */
export function useStorageItem<T>(key: string): StorageItemResult<T> {
	const cube = useCube();
	const [snapshot, setSnapshot] = useState(() => ({cube, key, result: initialStorageResult<T>(cube)}));
	useEffect(() => {
		let active = true;
		let generation = 0;
		let availability = cube.storage.state;
		let identity = cube.identity;
		const publish = (result: StorageItemResult<T>) => setSnapshot({cube, key, result});
		const refresh = () => {
			const requestGeneration = ++generation;
			availability = cube.storage.state;
			identity = cube.identity;
			publish(initialStorageResult<T>(cube));
			if (availability.status !== "ready") return;
			void cube.storage.get<T>(key).then(data => {
				if (active && requestGeneration === generation) publish({status: "ready", data});
			}, cause => {
				if (!active || requestGeneration !== generation) return;
				const error = cause instanceof CubeError ? cause : new CubeError("INTERNAL_ERROR", String(cause));
				const status = error.code === "NOT_FOUND"
					? "not-found"
					: ["DISCONNECTED", "AUTHENTICATION_REQUIRED", "APP_NOT_CONFIGURED"].includes(error.code)
					? "unavailable"
					: "error";
				publish({status, error});
			});
		};
		const storageChanged = ({key: changedKey}: { key: string }) => {
			if (changedKey === key) refresh();
		};
		const availabilityChanged = () => {
			if (availability !== cube.storage.state) refresh();
		};
		const identityChanged = () => {
			const next = cube.identity;
			if (identity?.cubeId !== next?.cubeId || identity?.appId !== next?.appId) refresh();
		};
		cube.addEventListener("storage", storageChanged);
		cube.addEventListener("availability", availabilityChanged);
		cube.addEventListener("identity", identityChanged);
		cube.addEventListener("open", refresh);
		cube.addEventListener("close", refresh);
		refresh();
		return () => {
			active = false;
			generation++;
			cube.removeEventListener("storage", storageChanged);
			cube.removeEventListener("availability", availabilityChanged);
			cube.removeEventListener("identity", identityChanged);
			cube.removeEventListener("open", refresh);
			cube.removeEventListener("close", refresh);
		};
	}, [cube, key]);
	return snapshot.cube === cube && snapshot.key === key ? snapshot.result : initialStorageResult<T>(cube);
}

/** Value-only convenience. Use useStorageItem to establish absence for business decisions. */
export function useStorageValue<T>(key: string): T | undefined {
	const result = useStorageItem<T>(key);
	return result.status === "ready" ? result.data : undefined;
}

const readConnection = (cube: Cube) => cube.state;
const subscribeConnection: Subscription = (cube, listener) => {
	cube.addEventListener("state", listener);
	return () => cube.removeEventListener("state", listener);
};

/** Authentication and initial snapshot readiness, distinct from socket connectivity. */
export function useConnectionState() {
	return useCubeSnapshot(readConnection, subscribeConnection);
}
