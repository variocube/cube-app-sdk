import {
	CodeEvent,
	Compartment,
	CompartmentsEvent,
	connect,
	ConnectOptions,
	Cube,
	Device,
	DevicesEvent,
	EventListener,
	LockEvent,
	LockStatus,
} from "@variocube/cube-app-sdk";
import React, {createContext, PropsWithChildren, useContext, useEffect, useMemo, useState} from "react";

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
	const {
		children,
		host,
		port,
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

		const cube = connect({host, port, secondary});
		cube.addEventListener("open", open);
		cube.addEventListener("close", close);
		cube.addEventListener("compartments", compartments);
		cube.addEventListener("devices", devices);
		cube.addEventListener("lock", lock);
		setCube(cube);

		return () => {
			cube.removeEventListener("open", open);
			cube.removeEventListener("close", close);
			cube.removeEventListener("compartments", compartments);
			cube.removeEventListener("devices", devices);
			cube.removeEventListener("lock", lock);
			cube.close();
		};
	}, [host, port, secondary]);

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
	});
}
