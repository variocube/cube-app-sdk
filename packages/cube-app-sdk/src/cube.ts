import {CloseEvent, CodeEvent, Compartment, Cube, EventListener, LockEvent, OpenEvent} from "./types";
import {VcmpClient} from "@variocube/vcmp";
import {CodeMessage, CompartmentsMessage, LockMessage} from "./messages";

type EventMap = {
    "code": CodeEvent,
    "lock": LockEvent,
    "open": OpenEvent,
    "close": CloseEvent,
}

type EventListenerTypeMap = {
    [E in keyof EventMap]: EventListener<EventMap[E]>;
}

type EventListenerRegistryMap = {
    [E in keyof EventListenerTypeMap]: Array<EventListenerTypeMap[E]>;
}

export class CubeImpl implements Cube {

    private readonly listeners: EventListenerRegistryMap;
    private readonly client: VcmpClient;
    private compartments: Compartment[];

    constructor() {
        this.listeners = {
            code: [],
            lock: [],
            open: [],
            close: [],
        };
        this.compartments = [];
        this.client = new VcmpClient("ws://localhost:5000", {
            autoStart: true,
        });
        this.client.onOpen = () => this.dispatchEvent("open", {});
        this.client.onClose = () => this.dispatchEvent("close", {});
        this.client.on<CompartmentsMessage>("compartments", ({compartments}) => {
            this.compartments = compartments;
        });
        this.client.on<LockMessage>("lock", e => this.dispatchEvent("lock", e));
		this.client.on<CodeMessage>("code", e => this.dispatchEvent("code", e));
    }

	public close() {
		this.client.stop();
	}

    private dispatchEvent<E extends keyof EventListenerTypeMap>(eventName: E, event: EventMap[E]) {
        for (const listener of this.listeners[eventName]) {
            try {
                listener(event);
            }
            catch (error) {
                console.error("Error in event listener", error);
            }
        }
    }

    addEventListener<E extends keyof EventListenerTypeMap>(eventName: E, listener: EventListenerTypeMap[E]) {
        this.listeners[eventName].push(listener);
    }

	removeEventListener<E extends keyof EventListenerTypeMap>(eventName: E, listener: EventListenerTypeMap[E]) {
		this.listeners[eventName] = this.listeners[eventName].filter(l => l !== listener) as EventListenerRegistryMap[E];
	}

    async restart() {
        await this.client.send({
            "@type": "restart"
        });
    }

    async openLock(lockId: string) {
        await this.client.send({
            "@type": "openLock",
            lockId,
        });
    }

    async openCompartment(compartmentNumber: string) {
        const compartment = this.getCompartment(compartmentNumber);
        if (!compartment) {
            throw new Error(`Compartment ${compartmentNumber} not found`);
        }
        await this.openLock(compartment.lock.id);
    }

    getCompartment(compartmentNumber: string) {
        return this.compartments.find(compartment => compartment.number == compartmentNumber);
    }

    getCompartments() {
        return [...this.compartments];
    }
}
