import {VcmpClient} from "@variocube/vcmp";
import {CodeMessage, CompartmentsMessage, DevicesMessage, LockMessage, OpenLockMessage} from "./messages";
import {
	CloseEvent,
	CodeEvent,
	Compartment,
	CompartmentsEvent,
	Cube,
	Device,
	DevicesEvent,
	EventListener,
	LockEvent,
	OpenContext,
	OpenEvent,
} from "./types";

type EventMap = {
	"code": CodeEvent;
	"lock": LockEvent;
	"open": OpenEvent;
	"close": CloseEvent;
	"compartments": CompartmentsEvent;
	"devices": DevicesEvent;
};

type EventListenerTypeMap = {
	[E in keyof EventMap]: EventListener<EventMap[E]>;
};

type EventListenerRegistryMap = {
	[E in keyof EventListenerTypeMap]: Array<EventListenerTypeMap[E]>;
};

export interface CubeImplOptions {
	host: string;
	port: number;
	secondary: boolean;
}

export class CubeImpl implements Cube {
	readonly #listeners: EventListenerRegistryMap;
	readonly #client: VcmpClient;
	readonly #secondary: boolean;
	#compartments: Compartment[];
	#devices: Device[];

	constructor(options: CubeImplOptions) {
		this.#listeners = {
			code: [],
			lock: [],
			open: [],
			close: [],
			compartments: [],
			devices: [],
		};
		this.#secondary = options.secondary;
		this.#compartments = [];
		this.#devices = [];
		this.#client = new VcmpClient(`ws://${options.host}:${options.port}`, {
			autoStart: true,
		});
		this.#client.onOpen = () => this.#dispatchEvent("open", {});
		this.#client.onClose = () => this.#dispatchEvent("close", {});
		this.#client.on<CompartmentsMessage>("compartments", (e) => {
			this.#compartments = e.compartments;
			this.#dispatchEvent("compartments", e);
		});
		this.#client.on<DevicesMessage>("devices", (e) => {
			this.#devices = e.devices;
			this.#dispatchEvent("devices", e);
		});
		this.#client.on<LockMessage>("lock", e => this.#dispatchEvent("lock", e));
		this.#client.on<CodeMessage>("code", e => this.#dispatchEvent("code", e));
	}

	close() {
		this.#client.stop();
	}

	#dispatchEvent<E extends keyof EventListenerTypeMap>(eventName: E, event: EventMap[E]) {
		for (const listener of this.#listeners[eventName]) {
			try {
				listener(event);
			}
			catch (error) {
				console.error("Error in event listener", error);
			}
		}
	}

	addEventListener<E extends keyof EventListenerTypeMap>(eventName: E, listener: EventListenerTypeMap[E]) {
		this.#listeners[eventName].push(listener);
	}

	removeEventListener<E extends keyof EventListenerTypeMap>(eventName: E, listener: EventListenerTypeMap[E]) {
		this.#listeners[eventName] = this.#listeners[eventName].filter(l =>
			l !== listener
		) as EventListenerRegistryMap[E];
	}

	async restartUserInterface() {
		await this.#client.send({
			"@type": "restartUi",
		});
	}

	async restartOperatingSystem() {
		await this.#client.send({
			"@type": "restartOs",
		});
	}

	async openLock(lock: string, context?: OpenContext) {
		await this.#client.send<OpenLockMessage>({
			"@type": "openLock",
			lock,
			...context,
		});
	}

	async openCompartment(compartmentNumber: string, context?: OpenContext) {
		const lock = this.getCompartmentLock(compartmentNumber);
		if (!lock) {
			throw new Error(`Compartment ${compartmentNumber} has no lock`);
		}
		await this.openLock(lock, context);
	}

	getCompartmentLock(compartmentNumber: string) {
		const compartment = this.getCompartment(compartmentNumber);
		if (!compartment) {
			throw new Error(`Compartment ${compartmentNumber} not found`);
		}
		return this.#secondary ? compartment.secondaryLock : compartment.lock;
	}

	getCompartment(compartmentNumber: string) {
		return this.#compartments.find(compartment => compartment.number == compartmentNumber);
	}

	get compartments() {
		return [...this.#compartments];
	}

	get devices() {
		return [...this.#devices];
	}

	get secondary() {
		return this.#secondary;
	}

	get connected() {
		return Boolean(this.#client.connected);
	}
}
