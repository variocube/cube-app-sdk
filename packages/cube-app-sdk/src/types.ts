export type LockStatus = "OPEN" | "CLOSED" | "BREAKIN" | "BLOCKED";

/**
 * An event that is dispatched when a lock status changes
 */
export interface LockEvent {
    /**
     * The id of the lock which status has changed.
     */
    lockId: string;

    /**
     * The number of the compartment the lock is assigned to,
     * or undefined if the lock is not assigned to a compartment.
     */
    compartmentNumber?: string;

    /**
     * The new status of the lock.
     */
    status: LockStatus;
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
 * An event that is dispatched when the connection to the Variocube locker is opened.
 */
export interface OpenEvent {
}

/**
 * An event that is dispatched when the connection to the Variocube locker was closed.
 */
export interface CloseEvent {
}


/**
 * Describes a lock.
 */
export interface Lock {
    /** The lock id. */
    id: string;

    /** The lock status. */
    status: LockStatus;
}

/**
 * Features of a compartment.
 */
export type CompartmentFeature =
    "COOLED"            // The compartment has a cooling unit.
    | "ACCESSIBLE"      // The compartment is accessible for handicapped people.
    | "CHARGER"         // The compartment has a charger.
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
    lock: Lock;
}

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

    /**
     * Open the locks with the specified id.
     * @param lockId The lock id
     * @return A promise that resolves when the open command was successfully handled by the locking hardware.
     */
    openLock(lockId: string): Promise<void>;

    /**
     * Opens the lock of the compartment with the specified compartment number.
     * @param compartmentNumber The compartment number
     * @return A promise that resolves when the open command was successfully handled by the locking hardware.
     */
    openCompartment(compartmentNumber: string): Promise<void>;

    /**
     * Returns the compartments of the cube.
     * @return The compartments of the cube.
     */
    getCompartments(): Compartment[];

    /**
     * Restarts the cube.
     * @return A promise that resolves when the restart command was successfully issued.
     */
    restart(): Promise<void>;
}
