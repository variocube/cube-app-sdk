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
	| "DoorBell"
	| "PowerManagement";

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
	info?: unknown;
}

/** The context of opening a lock/compartment. */
export interface OpenContext {
	/** The actor who is opening the lock/compartment. */
	actor?: string;

	/** The action associated with opening the lock/compartment. */
	action?: string;
}

/** An event listener */
export type EventListener<E> = (event: E) => unknown;

export type AvailabilityStatus = "loading" | "ready" | "unavailable" | "error";

export interface AvailabilityState {
	status: AvailabilityStatus;
	error?: CubeError;
}

export interface ConnectionState {
	status: "disconnected" | "initializing" | "ready" | "unavailable" | "error";
	generation?: number;
	revision?: number;
	error?: CubeError;
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
	boxNumber: string;
	accessCode: string | null;
	accessKeys: string[];
	created: string;
	/** Absent content remains distinct from explicit JSON null. */
	content?: OccupancyContent | null;
	actor: string | null;
	action: string | null;
	state: "pending" | "confirmed" | "ended";
}

export interface AccessCodeShape {
	alphabet: string;
	length: number;
}

export interface OccupyCommon extends OpenContext {
	accessCode?: string;
	accessCodeShape?: AccessCodeShape;
	accessKeys?: string[];
	content?: OccupancyContent | null;
}

export interface OccupyType extends OccupyCommon {
	type: string;
	group?: string;
	accessible?: boolean;
	cooled?: boolean;
	dangerousGoods?: boolean;
	charger?: boolean;
}

export interface OccupyBox extends OccupyCommon {
	boxNumber: string;
}

export type OccupyRequest = OccupyType | OccupyBox;

export interface UpdateOccupancyOptions extends OpenContext {
	content?: OccupancyContent | null;
	merge?: boolean;
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
	readonly state: OccupancyState;
	readonly snapshot: Occupancy[] | undefined;
	occupy(request: OccupyRequest): Promise<Occupancy>;
	occupyType(request: OccupyType): Promise<Occupancy>;
	occupyBox(request: OccupyBox): Promise<Occupancy>;
	confirm(uuid: string, content?: OccupancyContent | null, merge?: boolean): Promise<void>;
	cancel(uuid: string): Promise<void>;
	update(uuid: string, options: UpdateOccupancyOptions): Promise<void>;
	changeAccess(uuid: string, options: ChangeOccupancyAccessOptions): Promise<void>;
	end(uuid: string, options?: EndOccupancyOptions): Promise<void>;
	/** Reads the latest pushed snapshot, optionally matching accessCode or an access key. */
	list(access?: string): Promise<Occupancy[]>;
	get(uuid: string): Promise<Occupancy>;
}

export interface StorageItem {
	key: string;
	contentType: string;
	encoding: "json" | "base64";
	content: unknown;
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

export interface StorageEvent {
	key: string;
}

export interface AvailabilityEvent {
	occupancies: OccupancyState;
	storage: AvailabilityState;
}

export interface OccupancyChangedEvent {
	occupancy: Occupancy;
}

export interface OccupancyEndedEvent {
	uuid: string;
}

export interface Cube {
	readonly occupancies: Occupancies;
	readonly storage: CubeStorage;
	readonly identity: CubeIdentity | undefined;
	readonly state: ConnectionState;
	/** Reads the current pushed token for the installed app; rejects expired tokens. Never sends a refresh request. */
	getToken(): Promise<string>;
	setBoxMaintenance(boxNumber: string, required: boolean): Promise<void>;
	requireBoxMaintenance(boxNumber: string): Promise<void>;

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
	addEventListener(eventName: "occupancies", listener: EventListener<OccupancyState>): void;
	addEventListener(eventName: "identity", listener: EventListener<IdentityEvent>): void;
	addEventListener(eventName: "storage", listener: EventListener<StorageEvent>): void;
	addEventListener(eventName: "state", listener: EventListener<ConnectionState>): void;
	addEventListener(eventName: "availability", listener: EventListener<AvailabilityEvent>): void;
	addEventListener(eventName: "occupancyCreated", listener: EventListener<OccupancyChangedEvent>): void;
	addEventListener(eventName: "occupancyUpdated", listener: EventListener<OccupancyChangedEvent>): void;
	addEventListener(eventName: "occupancyAccessChanged", listener: EventListener<OccupancyChangedEvent>): void;
	addEventListener(eventName: "occupancyEnded", listener: EventListener<OccupancyEndedEvent>): void;

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
	removeEventListener(eventName: "occupancies", listener: EventListener<OccupancyState>): void;
	removeEventListener(eventName: "identity", listener: EventListener<IdentityEvent>): void;
	removeEventListener(eventName: "storage", listener: EventListener<StorageEvent>): void;
	removeEventListener(eventName: "state", listener: EventListener<ConnectionState>): void;
	removeEventListener(eventName: "availability", listener: EventListener<AvailabilityEvent>): void;
	removeEventListener(eventName: "occupancyCreated", listener: EventListener<OccupancyChangedEvent>): void;
	removeEventListener(eventName: "occupancyUpdated", listener: EventListener<OccupancyChangedEvent>): void;
	removeEventListener(eventName: "occupancyAccessChanged", listener: EventListener<OccupancyChangedEvent>): void;
	removeEventListener(eventName: "occupancyEnded", listener: EventListener<OccupancyEndedEvent>): void;

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
	 * Restarts the controller service of the cube.
	 * @return A promise that resolves when the restart command was successfully issued.
	 * @throws Error if the restart command could not be passed to the service.
	 */
	restartController(): Promise<void>;

	/**
	 * Restarts the specified device (driver).
	 * @param deviceId The id of the device to restart.
	 * @return A promise that resolves when the restart command was successfully issued.
	 * @throws Error if the restart command could not be passed to the service.
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
	 * @throws Error if the config fails validation, or if the message could not be passed to the service.
	 */
	configureCodeReader(config: CodeReaderConfig): Promise<void>;

	/**
	 * Closes the connection to the cube app service.
	 */
	close(): void;
}
