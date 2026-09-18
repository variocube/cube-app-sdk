import type {BarcodeReaderConfig} from "@variocube/driver-common/barcode-reader/config";
import type {CubeError} from "./errors.js";

/**
 * Standardized configuration for a code reader.
 *
 * Called "code reader" rather than "barcode reader" because the device decodes more than
 * linear barcodes (QR, DataMatrix, PDF417, Aztec, …). Structurally identical to the
 * `BarcodeReaderConfig` schema shared with the driver via `@variocube/driver-common`.
 */
export type CodeReaderConfig = BarcodeReaderConfig;

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

export type AvailabilityStatus = "loading" | "ready" | "unavailable" | "error";

export interface AvailabilityState {
	status: AvailabilityStatus;
	error?: CubeError;
}

export interface CubeCapabilities {
	occupancies: boolean;
	storage: boolean;
	identity: boolean;
}

/** The controller chooses appId and token audience. expiresAt is Unix epoch seconds. */
export interface CubeIdentity {
	cubeId: string;
	appId: string | null;
	token: string | null;
	expiresAt: number | null;
}

export type OccupancyContent = Record<string, unknown>;

/** Complete controller /app occupancy payload, including pending reservations. */
export interface Occupancy {
	uuid: string;
	appId: string;
	/** The number of the occupied compartment (`Compartment.number`). The controller calls compartments boxes. */
	boxNumber: string;
	accessCode: string | null;
	accessKeys: string[];
	created: string;
	content: OccupancyContent | null;
	actor: string | null;
	action: string | null;
	state: "pending" | "confirmed" | "ended";
}

export interface AccessCodeShape {
	alphabet: string;
	length: number;
}

/** Options shared by both ways of allocating a compartment. */
export interface OccupyOptions extends OpenContext {
	accessCode?: string;
	accessCodeShape?: AccessCodeShape;
	accessKeys?: string[];
	content?: OccupancyContent;
}

/** Lets the controller choose a free compartment of the requested type. */
export interface OccupyTypeRequest extends OccupyOptions {
	type: string;
	group?: string;
	/** Features the allocated compartment must have. */
	features?: CompartmentFeature[];
}

/** Allocates one specific compartment. */
export interface OccupyCompartmentRequest extends OccupyOptions {
	/** The compartment number; named like `Occupancy.boxNumber`. */
	boxNumber: string;
}

export interface ConfirmOccupancyOptions {
	content?: OccupancyContent;
	/** Merge `content` into the existing content instead of replacing it. */
	merge?: boolean;
}

export interface UpdateOccupancyOptions extends ConfirmOccupancyOptions, OpenContext {
}

export interface ChangeOccupancyAccessOptions extends OpenContext {
	accessCode?: string;
	accessCodeShape?: AccessCodeShape;
	accessKeys?: string[];
}

export interface EndOccupancyOptions extends UpdateOccupancyOptions {
	/** Seconds before an ended occupancy's box can be allocated again. */
	gracePeriod?: number;
}

export interface OccupancyState extends AvailabilityState {
	/** Undefined until an authoritative snapshot is available, including after disconnect/app changes. */
	data?: Occupancy[];
}

export interface Occupancies {
	/** The live snapshot (`state.data`) and its availability. */
	readonly state: OccupancyState;
	occupyType(request: OccupyTypeRequest): Promise<Occupancy>;
	occupyCompartment(request: OccupyCompartmentRequest): Promise<Occupancy>;
	confirm(uuid: string, options?: ConfirmOccupancyOptions): Promise<void>;
	cancel(uuid: string): Promise<void>;
	update(uuid: string, options: UpdateOccupancyOptions): Promise<void>;
	changeAccess(uuid: string, options: ChangeOccupancyAccessOptions): Promise<void>;
	end(uuid: string, options?: EndOccupancyOptions): Promise<void>;
	list(access?: string): Promise<Occupancy[]>;
	get(uuid: string): Promise<Occupancy>;
}

/** Controller-backed, Center-write-only storage. No browser persistence is used. */
export interface CubeStorage {
	readonly state: AvailabilityState;
	/** Reads JSON, preserving JSON null. Missing/deleted documents reject with NOT_FOUND. */
	get<T>(key: string): Promise<T>;
	getBlob(key: string): Promise<Blob>;
	keys(): Promise<string[]>;
}

export interface IdentityEvent {
	identity: CubeIdentity | undefined;
}

/** A storage key was written or deleted; read it again. Not the DOM `StorageEvent`. */
export interface StorageChangedEvent {
	key: string;
}

export interface CapabilitiesEvent {
	capabilities: CubeCapabilities | undefined;
}

export interface OccupanciesEvent {
	occupancies: OccupancyState;
}

export interface AvailabilityEvent {
	occupancies: OccupancyState;
	storage: AvailabilityState;
}

/**
 * Payload of `occupancyCreated`, `occupancyUpdated` and `occupancyAccessChanged`. The names follow the controller:
 * confirming a pending reservation also arrives as `occupancyCreated`, carrying the confirmed occupancy.
 */
export interface OccupancyChangedEvent {
	occupancy: Occupancy;
}

/** The occupancy left the snapshot: it was ended, or a pending reservation was cancelled. */
export interface OccupancyEndedEvent {
	uuid: string;
}

/** Maps every event name to its payload. */
export interface CubeEventMap {
	open: OpenEvent;
	close: CloseEvent;
	lock: LockEvent;
	code: CodeEvent;
	compartments: CompartmentsEvent;
	devices: DevicesEvent;
	occupancies: OccupanciesEvent;
	identity: IdentityEvent;
	storage: StorageChangedEvent;
	capabilities: CapabilitiesEvent;
	availability: AvailabilityEvent;
	occupancyCreated: OccupancyChangedEvent;
	occupancyUpdated: OccupancyChangedEvent;
	occupancyAccessChanged: OccupancyChangedEvent;
	occupancyEnded: OccupancyEndedEvent;
}

export interface Cube {
	readonly occupancies: Occupancies;
	readonly storage: CubeStorage;
	readonly identity: CubeIdentity | undefined;
	readonly capabilities: CubeCapabilities | undefined;
	/** Uses the installed app audience, sharing concurrent refreshes. Never takes an audience argument. */
	getToken(): Promise<string>;
	/** Marks a compartment as requiring maintenance, or clears the mark. */
	setCompartmentMaintenance(compartmentNumber: string, required: boolean): Promise<void>;

	/**
	 * Adds an event listener.
	 * @param eventName The event name
	 * @param listener The event listener
	 * @return A function that removes the listener again.
	 */
	addEventListener<E extends keyof CubeEventMap>(eventName: E, listener: EventListener<CubeEventMap[E]>): () => void;

	/**
	 * Removes an event listener.
	 * @param eventName The event name
	 * @param listener The event listener
	 */
	removeEventListener<E extends keyof CubeEventMap>(eventName: E, listener: EventListener<CubeEventMap[E]>): void;

	/**
	 * Open the locks with the specified id.
	 * @param lock The lock id
	 * @param context The context of the open command
	 * @return A promise that resolves when the open command was successfully handled by the locking hardware.
	 * @throws CubeError if the open command could not be passed to the locking hardware.
	 */
	openLock(lock: string, context?: OpenContext): Promise<void>;

	/**
	 * Opens the lock of the compartment with the specified compartment number.
	 * @param compartmentNumber The compartment number
	 * @param context The context of the open command
	 * @return A promise that resolves when the open command was successfully handled by the locking hardware.
	 * @throws CubeError if the compartment cannot be found, it does not have a lock configured, or the open command could not be passed to the locking hardware.
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
	 * Returns the lock of the specified compartment; the secondary lock if the app runs on the secondary side.
	 * @param compartmentNumber The compartment number
	 * @return The lock, or undefined if the compartment was not found or has no such lock.
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
	 * @throws CubeError if the restart command could not be passed to the service.
	 */
	restartUserInterface(): Promise<void>;

	/**
	 * Restarts the operating system of the cube.
	 * @return A promise that resolves when the restart command was successfully issued.
	 * @throws CubeError if the restart command could not be passed to the service.
	 */
	restartOperatingSystem(): Promise<void>;

	/**
	 * Restarts the controller service of the cube.
	 * @return A promise that resolves when the restart command was successfully issued.
	 * @throws CubeError if the restart command could not be passed to the service.
	 */
	restartController(): Promise<void>;

	/**
	 * Restarts the specified device (driver).
	 * @param deviceId The id of the device to restart.
	 * @return A promise that resolves when the restart command was successfully issued.
	 * @throws CubeError if the restart command could not be passed to the service.
	 */
	restartDevice(deviceId: string): Promise<void>;

	/**
	 * Pushes a standardized configuration to the connected code reader(s).
	 *
	 * The config is validated synchronously before sending, using the shared validation
	 * function from `@variocube/driver-common`. The driver overlays the (possibly partial)
	 * config on its default vendor profile and applies what the reader supports; in v1 the
	 * driver's apply-result is log-only, so no structured success/failure ack is returned.
	 *
	 * The config is applied to all connected code readers; there is no per-device targeting.
	 *
	 * @param config The standardized code reader configuration to apply.
	 * @return A promise that resolves when the config was successfully passed to the service.
	 * @throws CubeError if the config fails validation, or if the message could not be passed to the service.
	 */
	configureCodeReader(config: CodeReaderConfig): Promise<void>;

	/**
	 * Closes the connection to the cube app service.
	 */
	close(): void;
}
