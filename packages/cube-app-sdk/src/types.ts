/** The status of a lock. */
export type LockStatus = "OPEN" | "CLOSED" | "BREAKIN" | "BLOCKED";

/**
 * An event that is dispatched when a lock status changes
 */
export interface LockEvent {
	/**
	 * The lock which status has changed.
	 */
	lock: string;

	/**
	 * The number of the compartment the lock is assigned to,
	 * or undefined if the lock is not assigned to a compartment.
	 */
	compartmentNumber?: string;

	/**
	 * The new status of the lock.
	 */
	status: LockStatus;

	/**
	 * The actor that was passed in the open command leading to this lock event.
	 */
	actor?: string;

	/**
	 * The action that was passed in the open command leading to this lock event.
	 */
	action?: string;
}

/**
 * An event that is dispatched when a code was entered or scanned.
 */
export interface CodeEvent {
	/**
	 * The code was entered or scanned.
	 */
	code: string;

	/**
	 * The source of the code.
	 */
	source: "KEYPAD" | "SCANNER" | "NFC";
}

/**
 * An event that is dispatched when the connection to the locker is opened.
 */
export interface OpenEvent {
}

/**
 * An event that is dispatched when the connection to the locker was closed.
 */
export interface CloseEvent {
}

/**
 * An event that is dispatched when the compartments of the locker changed.
 */
export interface CompartmentsEvent {
	compartments: Compartment[];
}

/**
 * An event that is dispatched when the devices of the locker changed.
 */
export interface DevicesEvent {
	devices: Device[];
}

/**
 * Features of a compartment.
 */
export type CompartmentFeature =
	| "COOLED" // The compartment has a cooling unit.
	| "ACCESSIBLE" // The compartment is accessible for handicapped people.
	| "CHARGER" // The compartment has a charger.
	| "DANGEROUS_GOODS" // The compartment is suitable for dangerous goods.
;

/**
 * Describes a compartment.
 */
export interface Compartment {
	/**
	 * The compartment number
	 */
	number: string;

	/**
	 * Whether the compartment is enabled
	 */
	enabled: boolean;

	/**
	 * The compartment's types, i.e. S, M, L
	 */
	types: string[];

	/**
	 * The compartment's features
	 */
	features: CompartmentFeature[];

	/**
	 * The lock that is assigned to the compartment.
	 */
	lock?: string;

	/**
	 * The secondary lock that is assigned to the compartment.
	 */
	secondaryLock?: string;
}

/** The device type */
export type DeviceType =
	| "NfcReader"
	| "PaymentTerminal"
	| "Locking"
	| "BarcodeReader"
	| "Admission"
	| "ComputeUnit"
	| "Kiosk"
	| "Keypad"
	| "DoorBell";

/** Describes a device. */
export interface Device {
	/** The device's id. */
	id: string;

	/** The device's types. */
	types: DeviceType[];

	/** The vendor of the device. */
	vendor?: string;

	/** The device's model. */
	model?: string;

	/** The device's serial number. */
	serialNumber?: string;

	/** Additional information specific to the device. */
	info?: any;
}

/** The context of opening a lock/compartment. */
export interface OpenContext {
	/** The actor who is opening the lock/compartment. */
	actor?: string;

	/** The action associated with opening the lock/compartment. */
	action?: string;
}

/** An event listener */
export type EventListener<E> = (event: E) => any;

export interface Cube {
	/**
	 * Adds an event listener.
	 * @param eventName The event name
	 * @param listener The event listener
	 */
	addEventListener(eventName: "open", listener: EventListener<OpenEvent>): void;
	addEventListener(eventName: "close", listener: EventListener<CloseEvent>): void;
	addEventListener(eventName: "lock", listener: EventListener<LockEvent>): void;
	addEventListener(eventName: "code", listener: EventListener<CodeEvent>): void;
	addEventListener(eventName: "compartments", listener: EventListener<CompartmentsEvent>): void;
	addEventListener(eventName: "devices", listener: EventListener<DevicesEvent>): void;

	/**
	 * Removes an event listener.
	 * @param eventName The event name
	 * @param listener The event listener
	 */
	removeEventListener(eventName: "open", listener: EventListener<OpenEvent>): void;
	removeEventListener(eventName: "close", listener: EventListener<CloseEvent>): void;
	removeEventListener(eventName: "lock", listener: EventListener<LockEvent>): void;
	removeEventListener(eventName: "code", listener: EventListener<CodeEvent>): void;
	removeEventListener(eventName: "compartments", listener: EventListener<CompartmentsEvent>): void;
	removeEventListener(eventName: "devices", listener: EventListener<DevicesEvent>): void;

	/**
	 * Open the locks with the specified id.
	 * @param lock The lock id
	 * @param context The context of the open command
	 * @return A promise that resolves when the open command was successfully handled by the locking hardware.
	 * @throws Error if the open command could not be passed to the locking hardware.
	 */
	openLock(lock: string, context?: OpenContext): Promise<void>;

	/**
	 * Opens the lock of the compartment with the specified compartment number.
	 * @param compartmentNumber The compartment number
	 * @param context The context of the open command
	 * @return A promise that resolves when the open command was successfully handled by the locking hardware.
	 * @throws Error if the compartment cannot be found, it does not have a lock configured, or the open command could not be passed to the locking hardware.
	 */
	openCompartment(compartmentNumber: string, context?: OpenContext): Promise<void>;

	/**
	 * The compartments of the cube.
	 */
	compartments: Compartment[];

	/**
	 * Returns the compartment with the specified compartment number, or undefined, if the compartment was not found.
	 * @param compartmentNumber The compartment number
	 * @return The compartment
	 */
	getCompartment(compartmentNumber: string): Compartment | undefined;

	/**
	 * Returns the lock of the specified compartment.
	 * @param compartmentNumber The compartment number
	 * @return The lock assigned to this compartment.
	 */
	getCompartmentLock(compartmentNumber: string): string | undefined;

	/**
	 * The devices of the cube.
	 */
	devices: Device[];

	/**
	 * Whether the app runs on the secondary side of the cube.
	 */
	secondary: boolean;

	/**
	 * Whether the connection to the cube app service is currently open.
	 */
	connected: boolean;

	/**
	 * Restarts the user interface of the cube.
	 * @return A promise that resolves when the restart command was successfully issued.
	 * @throws Error if the restart command could not be passed to the service.
	 */
	restartUserInterface(): Promise<void>;

	/**
	 * Restarts the operating system of the cube.
	 * @return A promise that resolves when the restart command was successfully issued.
	 * @throws Error if the restart command could not be passed to the service.
	 */
	restartOperatingSystem(): Promise<void>;

	/**
	 * Closes the connection to the cube app service.
	 */
	close(): void;
}
