import {validateBarcodeConfig as validateCodeReaderConfig} from "@variocube/driver-common/barcode-reader/config";
import {VcmpClient, type VcmpMessage, type VcmpSession} from "@variocube/vcmp";
import {CubeError, toCubeError} from "./errors.js";
import type {
	AvailabilityMessage,
	CapabilitiesMessage,
	CodeMessage,
	CompartmentsMessage,
	CubeMessage,
	DevicesMessage,
	LockMessage,
	OccupanciesMessage,
	OccupancyAccessChangedMessage,
	OccupancyCreatedMessage,
	OccupancyEndedMessage,
	OccupancyUpdatedMessage,
	StorageItemChangedMessage,
} from "./messages.js";
import type {
	AvailabilityEvent,
	AvailabilityState,
	CapabilitiesEvent,
	CloseEvent,
	CodeEvent,
	CodeReaderConfig,
	Compartment,
	CompartmentsEvent,
	Cube,
	CubeCapabilities,
	CubeIdentity,
	CubeStorage,
	Device,
	DevicesEvent,
	EventListener,
	IdentityEvent,
	LockEvent,
	Occupancies,
	Occupancy,
	OccupancyChangedEvent,
	OccupancyEndedEvent,
	OccupancyState,
	OpenContext,
	OpenEvent,
	StorageEvent,
	StorageItem,
} from "./types.js";

interface EventMap {
	code: CodeEvent;
	lock: LockEvent;
	open: OpenEvent;
	close: CloseEvent;
	compartments: CompartmentsEvent;
	devices: DevicesEvent;
	occupancies: OccupancyState;
	identity: IdentityEvent;
	storage: StorageEvent;
	capabilities: CapabilitiesEvent;
	availability: AvailabilityEvent;
	occupancyCreated: OccupancyChangedEvent;
	occupancyUpdated: OccupancyChangedEvent;
	occupancyAccessChanged: OccupancyChangedEvent;
	occupancyEnded: OccupancyEndedEvent;
}

type ListenerRegistry = { [E in keyof EventMap]: Array<EventListener<EventMap[E]>> };
type Feature = keyof CubeCapabilities;

interface PendingRequest {
	sent: boolean;
	mutation: boolean;
	reject(error: CubeError): void;
}

export interface CubeImplOptions {
	host: string;
	port: number;
	secondary: boolean;
}

export class CubeImpl implements Cube {
	readonly #listeners: ListenerRegistry = {
		code: [],
		lock: [],
		open: [],
		close: [],
		compartments: [],
		devices: [],
		occupancies: [],
		identity: [],
		storage: [],
		capabilities: [],
		availability: [],
		occupancyCreated: [],
		occupancyUpdated: [],
		occupancyAccessChanged: [],
		occupancyEnded: [],
	};
	readonly #client: VcmpClient;
	readonly #secondary: boolean;
	#compartments: Compartment[] = [];
	#devices: Device[] = [];
	#identity: CubeIdentity | undefined;
	#capabilities: CubeCapabilities | undefined;
	#controllerConnected: boolean | undefined;
	#generation = 0;
	#occupancyRevision = 0;
	#occupancyState: OccupancyState = {status: "unavailable", error: disconnected()};
	#storageState: AvailabilityState = {status: "unavailable", error: disconnected()};
	#capabilityTimer: ReturnType<typeof setTimeout> | undefined;
	readonly #capabilityWaiters = new Set<() => void>();
	readonly #pending = new Set<PendingRequest>();
	readonly #storageItems = new Map<string, StorageItem>();
	readonly #storageReads = new Map<string, Promise<StorageItem>>();
	readonly #storageVersions = new Map<string, number>();
	#tokenRefresh: Promise<string> | undefined;
	readonly occupancies: Occupancies;
	readonly storage: CubeStorage;

	constructor(options: CubeImplOptions) {
		this.#secondary = options.secondary;
		const cube = this;
		this.occupancies = {
			get state() {
				return cube.#occupancyState;
			},
			get snapshot() {
				return cube.#occupancyState.data;
			},
			occupy: request =>
				"boxNumber" in request
					? this.occupancies.occupyBox(request)
					: this.occupancies.occupyType(request),
			occupyType: request => this.#request({"@type": "occupyType", ...request}, true, "occupancies"),
			occupyBox: request => this.#request({"@type": "occupyBox", ...request}, true, "occupancies"),
			confirm: (uuid, content, merge) =>
				this.#request({"@type": "confirmOccupancy", uuid, content, merge}, true, "occupancies"),
			cancel: uuid => this.#request({"@type": "cancelOccupancy", uuid}, true, "occupancies"),
			update: (uuid, options) =>
				this.#request({"@type": "updateOccupancy", uuid, ...options}, true, "occupancies"),
			changeAccess: (uuid, options) =>
				this.#request({"@type": "changeOccupancyAccess", uuid, ...options}, true, "occupancies"),
			end: (uuid, options) => this.#request({"@type": "endOccupancy", uuid, ...options}, true, "occupancies"),
			list: access => this.#listOccupancies(access),
			get: uuid => this.#request({"@type": "getOccupancy", uuid}, false, "occupancies"),
		};
		this.storage = {
			get state() {
				return cube.#storageState;
			},
			get: <T>(key: string): Promise<T> =>
				this.#withStorage(key, item => {
					if (item.encoding !== "json") {
						throw new CubeError("INVALID_CONTENT_TYPE", `Storage item ${key} is not JSON; use getBlob().`);
					}
					return item.content as T;
				}),
			getBlob: key =>
				this.#withStorage(key, item => {
					const data = item.encoding === "json"
						? JSON.stringify(item.content)
						: Uint8Array.from(atob(item.content as string), character => character.charCodeAt(0));
					return new Blob([data], {type: item.contentType});
				}),
			keys: () => this.#request({"@type": "getStorageKeys"}, false, "storage"),
		};
		this.#client = new VcmpClient(`ws://${options.host}:${options.port}`, {autoStart: false});
		this.#client.onOpen = () => {
			this.#controllerConnected = undefined;
			this.#reset();
			this.#startCapabilityWait();
			this.#dispatchEvent("open", {});
		};
		this.#client.onClose = () => {
			this.#controllerConnected = false;
			this.#reset();
			this.#dispatchEvent("close", {});
		};
		this.#on<CompartmentsMessage>("compartments", event => {
			this.#compartments = event.compartments;
			this.#dispatchEvent("compartments", event);
		});
		this.#on<DevicesMessage>("devices", event => {
			this.#devices = event.devices;
			this.#dispatchEvent("devices", event);
		});
		this.#on<LockMessage>("lock", event => this.#dispatchEvent("lock", event));
		this.#on<CodeMessage>("code", event => this.#dispatchEvent("code", event));
		this.#on<AvailabilityMessage>("availability", event => {
			if (this.#controllerConnected === event.connected) return;
			const wasDisconnected = this.#controllerConnected === false;
			this.#controllerConnected = event.connected;
			if (!event.connected) this.#reset();
			else if (wasDisconnected) {
				this.#reset();
				this.#startCapabilityWait();
			}
			this.#refreshAvailability();
		});
		this.#on<CapabilitiesMessage>("capabilities", event => {
			if (!this.#acceptExtension()) return;
			clearTimeout(this.#capabilityTimer);
			this.#capabilities = {
				occupancies: event.occupancies === true,
				storage: event.storage === true,
				identity: event.identity === true,
			};
			this.#dispatchEvent("capabilities", {capabilities: this.#capabilities});
			this.#refreshAvailability();
			this.#flushCapabilityWaiters();
		});
		this.#on<CubeMessage>("cube", event => {
			if (!this.#acceptExtension()) return;
			if (this.#identity && (this.#identity.cubeId !== event.cubeId || this.#identity.appId !== event.appId)) {
				this.#reset(false);
			}
			this.#identity = {cubeId: event.cubeId, appId: event.appId, token: event.token, expiresAt: event.expiresAt};
			this.#dispatchEvent("identity", {identity: this.#identity});
			this.#refreshAvailability();
		});
		this.#on<OccupanciesMessage>("occupancies", event => {
			if (this.#acceptExtension() && this.#identity?.appId) this.#replaceSnapshot(event.occupancies);
		});
		this.#on<OccupancyCreatedMessage>("occupancyCreated", event => this.#upsert("occupancyCreated", event));
		this.#on<OccupancyUpdatedMessage>("occupancyUpdated", event => this.#upsert("occupancyUpdated", event));
		this.#on<OccupancyAccessChangedMessage>(
			"occupancyAccessChanged",
			event => this.#upsert("occupancyAccessChanged", event),
		);
		this.#on<OccupancyEndedMessage>("occupancyEnded", event => {
			if (!this.#acceptExtension() || !this.#identity?.appId) return;
			this.#occupancyRevision++;
			if (this.#occupancyState.data) {
				this.#setOccupancyState({
					...this.#occupancyState,
					data: this.#occupancyState.data.filter(o => o.uuid !== event.uuid),
				});
			}
			this.#dispatchEvent("occupancyEnded", event);
		});
		this.#on<StorageItemChangedMessage>("storageItemChanged", event => {
			if (!this.#acceptExtension() || !this.#identity?.appId) return;
			this.#storageVersions.set(event.key, (this.#storageVersions.get(event.key) ?? 0) + 1);
			this.#storageItems.delete(event.key);
			this.#storageReads.delete(event.key);
			this.#dispatchEvent("storage", {key: event.key});
		});
		this.#client.start();
	}

	#on<T>(name: string, handler: (message: T) => void) {
		this.#client.on<T>(name, (message: T, session: VcmpSession) => {
			// VCMP schedules message handlers asynchronously; a closed socket may have queued a final event.
			if (session.isOpen) handler(message);
		});
	}

	#acceptExtension() {
		return this.connected && this.#controllerConnected !== false;
	}

	#reset(clearCapabilities = true) {
		this.#generation++;
		this.#occupancyRevision++;
		for (const pending of [...this.#pending]) {
			pending.reject(pending.sent && pending.mutation ? unknownOutcome() : disconnected());
		}
		this.#storageItems.clear();
		this.#storageReads.clear();
		this.#storageVersions.clear();
		this.#tokenRefresh = undefined;
		this.#identity = undefined;
		if (clearCapabilities) {
			clearTimeout(this.#capabilityTimer);
			this.#capabilities = undefined;
			this.#dispatchEvent("capabilities", {capabilities: undefined});
		}
		this.#occupancyState = {status: "loading"};
		this.#storageState = {status: "loading"};
		this.#dispatchEvent("identity", {identity: undefined});
		this.#refreshAvailability(true);
	}

	#startCapabilityWait() {
		clearTimeout(this.#capabilityTimer);
		this.#capabilityTimer = setTimeout(() => {
			this.#capabilities = {occupancies: false, storage: false, identity: false};
			this.#dispatchEvent("capabilities", {capabilities: this.#capabilities});
			this.#refreshAvailability();
			this.#flushCapabilityWaiters();
		}, 5000);
	}

	#flushCapabilityWaiters() {
		for (const waiter of [...this.#capabilityWaiters]) waiter();
	}

	#featureState(feature: Feature): AvailabilityState {
		if (!this.#acceptExtension()) return {status: "unavailable", error: disconnected()};
		if (this.#capabilities && !this.#capabilities[feature]) {
			return {
				status: "unavailable",
				error: new CubeError("UNSUPPORTED", `The controller does not support ${feature}.`),
			};
		}
		if (this.#identity?.appId === null) {
			return {
				status: "unavailable",
				error: new CubeError("APP_NOT_CONFIGURED", "The controller has no uniquely resolved installed app."),
			};
		}
		if (!this.#capabilities || !this.#identity) return {status: "loading"};
		return {status: "ready"};
	}

	#refreshAvailability(force = false) {
		const storage = this.#featureState("storage");
		const occupancy = this.#featureState("occupancies");
		const nextOccupancy: OccupancyState = occupancy.status === "ready"
			? this.#occupancyState.data ? {status: "ready", data: this.#occupancyState.data} : {status: "loading"}
			: occupancy;
		const occupancyChanged = force || !sameAvailability(this.#occupancyState, nextOccupancy);
		const storageChanged = force || !sameAvailability(this.#storageState, storage);
		if (occupancyChanged) {
			this.#occupancyState = nextOccupancy;
			this.#dispatchEvent("occupancies", this.#occupancyState);
		}
		if (storageChanged) this.#storageState = storage;
		if (occupancyChanged || storageChanged) this.#dispatchAvailability();
	}

	#dispatchAvailability() {
		this.#dispatchEvent("availability", {occupancies: this.#occupancyState, storage: this.#storageState});
	}

	#setOccupancyState(state: OccupancyState) {
		this.#occupancyState = state;
		this.#dispatchEvent("occupancies", state);
		this.#dispatchAvailability();
	}

	#replaceSnapshot(data: Occupancy[]) {
		this.#occupancyRevision++;
		this.#setOccupancyState({status: "ready", data: data.filter(o => o.appId === this.#identity?.appId)});
	}

	#upsert(name: "occupancyCreated" | "occupancyUpdated" | "occupancyAccessChanged", event: OccupancyChangedEvent) {
		if (!this.#acceptExtension() || !this.#identity?.appId || event.occupancy.appId !== this.#identity.appId) {
			return;
		}
		this.#occupancyRevision++;
		if (this.#occupancyState.data) {
			const data = [...this.#occupancyState.data];
			const index = data.findIndex(o => o.uuid === event.occupancy.uuid);
			if (index === -1) data.push(event.occupancy);
			else data[index] = event.occupancy;
			this.#setOccupancyState({...this.#occupancyState, data});
		}
		this.#dispatchEvent(name, event);
	}

	async #listOccupancies(access?: string): Promise<Occupancy[]> {
		const generation = this.#generation;
		const revision = this.#occupancyRevision;
		try {
			const data = await this.#request<Occupancy[]>({"@type": "getOccupancies", access}, false, "occupancies");
			if (generation !== this.#generation) throw disconnected();
			if (access === undefined && revision === this.#occupancyRevision && this.#identity?.appId) {
				this.#replaceSnapshot(data);
			}
			return data;
		}
		catch (error) {
			if (access === undefined && generation === this.#generation && revision === this.#occupancyRevision) {
				const failure = toCubeError(error);
				this.#setOccupancyState({
					status: ["DISCONNECTED", "UNSUPPORTED", "APP_NOT_CONFIGURED"].includes(failure.code)
						? "unavailable"
						: "error",
					error: failure,
				});
			}
			throw error;
		}
	}

	async #withStorage<T>(key: string, convert: (item: StorageItem) => T): Promise<T> {
		const generation = this.#generation;
		const version = this.#storageVersions.get(key) ?? 0;
		const item = await this.#readStorage(key);
		// Even cached reads cross an async boundary; never expose a value invalidated in the meantime.
		if (generation !== this.#generation) throw disconnected();
		if (version !== (this.#storageVersions.get(key) ?? 0)) {
			throw new CubeError("STALE_RESPONSE", `Storage item ${key} changed while it was being read.`);
		}
		return convert(item);
	}

	async #readStorage(key: string): Promise<StorageItem> {
		if (!this.#acceptExtension()) throw disconnected();
		const cached = this.#storageItems.get(key);
		if (cached) return cached;
		const pending = this.#storageReads.get(key);
		if (pending) return pending;
		const generation = this.#generation;
		const version = this.#storageVersions.get(key) ?? 0;
		const request = this.#request<StorageItem>({"@type": "getStorageItem", key}, false, "storage").then(item => {
			if (generation !== this.#generation) throw disconnected();
			if (version !== (this.#storageVersions.get(key) ?? 0)) {
				throw new CubeError("STALE_RESPONSE", `Storage item ${key} changed while it was being read.`);
			}
			if (
				!item || item.key !== key || typeof item.contentType !== "string"
				|| (item.encoding !== "json" && item.encoding !== "base64")
				|| (item.encoding === "base64" && typeof item.content !== "string") || !("content" in item)
			) {
				throw new CubeError("INVALID_RESPONSE", "Invalid storage reply from the controller.");
			}
			this.#storageItems.set(key, item);
			return item;
		}).finally(() => {
			if (this.#storageReads.get(key) === request) this.#storageReads.delete(key);
		});
		this.#storageReads.set(key, request);
		return request;
	}

	#request<T = void>(
		message: VcmpMessage & Record<string, unknown>,
		mutation = false,
		feature?: Feature,
	): Promise<T> {
		if (!this.connected || (feature && this.#controllerConnected === false)) return Promise.reject(disconnected());
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const finish = (error?: CubeError, value?: T) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.#pending.delete(pending);
				this.#capabilityWaiters.delete(send);
				if (error) reject(error);
				else resolve(value as T);
			};
			const pending: PendingRequest = {sent: false, mutation, reject: error => finish(error)};
			const send = () => {
				if (settled || pending.sent) return;
				if (feature && !this.#capabilities) {
					this.#capabilityWaiters.add(send);
					return;
				}
				if (feature && !this.#capabilities?.[feature]) {
					finish(new CubeError("UNSUPPORTED", `The controller does not support ${feature}.`));
					return;
				}
				this.#capabilityWaiters.delete(send);
				pending.sent = true;
				timeout = setTimeout(
					() =>
						finish(
							mutation
								? unknownOutcome()
								: new CubeError("TIMEOUT", "The controller did not reply within 10 seconds."),
						),
					10000,
				);
				try {
					this.#client.send(message).then(value => finish(undefined, value as T), error => {
						const failure = toCubeError(error);
						finish(
							failure.code === "COMMAND_FAILED" && isTransportFailure(error)
								? mutation ? unknownOutcome() : disconnected()
								: failure,
						);
					});
				}
				catch (error) {
					finish(toCubeError(error));
				}
			};
			this.#pending.add(pending);
			send();
		});
	}

	getToken(): Promise<string> {
		if (!this.#acceptExtension()) return Promise.reject(disconnected());
		if (this.#identity?.token && this.#identity.expiresAt && this.#identity.expiresAt > Date.now() / 1000 + 300) {
			const generation = this.#generation;
			return Promise.resolve().then(() => {
				if (generation !== this.#generation || !this.#acceptExtension()) throw disconnected();
				if (
					this.#identity?.token && this.#identity.expiresAt
					&& this.#identity.expiresAt > Date.now() / 1000 + 300
				) {
					return this.#identity.token;
				}
				return this.getToken();
			});
		}
		if (this.#tokenRefresh) return this.#tokenRefresh;
		const generation = this.#generation;
		const refresh = this.#request<string>({"@type": "getToken"}, false, "identity").then(token => {
			if (generation !== this.#generation || !this.#identity?.appId) throw disconnected();
			const expiresAt = tokenExpiry(token, this.#identity);
			this.#identity = {...this.#identity, token, expiresAt};
			this.#dispatchEvent("identity", {identity: this.#identity});
			return token;
		}).finally(() => {
			if (this.#tokenRefresh === refresh) this.#tokenRefresh = undefined;
		}).then(token => {
			// Identity listeners and promise cleanup can run before this public promise settles.
			if (generation !== this.#generation || !this.#acceptExtension() || !this.#identity?.appId) {
				throw disconnected();
			}
			tokenExpiry(token, this.#identity);
			return token;
		});
		this.#tokenRefresh = refresh;
		return refresh;
	}

	get identity() {
		return this.#identity;
	}
	get capabilities() {
		return this.#capabilities;
	}

	setBoxMaintenance(boxNumber: string, required: boolean): Promise<void> {
		return this.#request(
			{"@type": "updateBoxMaintenance", boxNumber, maintenanceRequired: required},
			true,
			"occupancies",
		);
	}

	requireBoxMaintenance(boxNumber: string): Promise<void> {
		return this.setBoxMaintenance(boxNumber, true);
	}

	close() {
		this.#controllerConnected = false;
		this.#reset();
		this.#client.stop();
	}

	#dispatchEvent<E extends keyof EventMap>(eventName: E, event: EventMap[E]) {
		for (const listener of [...this.#listeners[eventName]]) {
			try {
				listener(event);
			}
			catch (error) {
				console.error("Error in event listener", error);
			}
		}
	}

	addEventListener<E extends keyof EventMap>(eventName: E, listener: EventListener<EventMap[E]>) {
		this.#listeners[eventName].push(listener);
	}

	removeEventListener<E extends keyof EventMap>(eventName: E, listener: EventListener<EventMap[E]>) {
		this.#listeners[eventName] = this.#listeners[eventName].filter(l => l !== listener) as ListenerRegistry[E];
	}

	restartUserInterface(): Promise<void> {
		return this.#request({"@type": "restartUi"}, true);
	}
	restartOperatingSystem(): Promise<void> {
		return this.#request({"@type": "restartOs"}, true);
	}
	restartController(): Promise<void> {
		return this.#request({"@type": "restartController"}, true);
	}
	restartDevice(deviceId: string): Promise<void> {
		return this.#request({"@type": "restartDevice", deviceId}, true);
	}

	async configureCodeReader(config: CodeReaderConfig) {
		const {valid, errors} = validateCodeReaderConfig(config);
		if (!valid) throw new Error(`Invalid code reader configuration: ${errors.join("; ")}`);
		await this.#request({"@type": "configureCodeReader", config}, true);
	}

	openLock(lock: string, context?: OpenContext): Promise<void> {
		return this.#request({"@type": "openLock", lock, ...context}, true);
	}

	async openCompartment(compartmentNumber: string, context?: OpenContext) {
		const lock = this.getCompartmentLock(compartmentNumber);
		if (!lock) throw new Error(`Compartment ${compartmentNumber} has no lock`);
		await this.openLock(lock, context);
	}

	getCompartmentLock(compartmentNumber: string) {
		const compartment = this.getCompartment(compartmentNumber);
		if (!compartment) throw new Error(`Compartment ${compartmentNumber} not found`);
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

function disconnected() {
	return new CubeError("DISCONNECTED", "The controller connection or installed app changed.");
}
function unknownOutcome() {
	return new CubeError(
		"COMMAND_OUTCOME_UNKNOWN",
		"The command was sent but its outcome is unknown. Reconcile the authoritative occupancy snapshot before continuing; do not blindly retry.",
	);
}
function sameAvailability(a: AvailabilityState, b: AvailabilityState) {
	return a.status === b.status && a.error?.code === b.error?.code && a.error?.message === b.error?.message;
}
function isTransportFailure(error: unknown) {
	return !!error && typeof error === "object" && "title" in error
		&& ["Session closed", "Session not open", "Send failed", "Invalid acknowledgement"].includes(
			String(error.title),
		);
}

/** Reads claims only to manage freshness; authentication/signature verification belongs to the backend. */
function tokenExpiry(token: string, identity: CubeIdentity): number {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) throw new Error();
		const payload = JSON.parse(
			new TextDecoder().decode(
				Uint8Array.from(
					atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
					character => character.charCodeAt(0),
				),
			),
		) as Record<string, unknown>;
		const {iss, sub, aud, exp, iat, nbf} = payload;
		if (
			iss !== identity.cubeId || sub !== iss || aud !== identity.appId
			|| typeof exp !== "number" || !Number.isInteger(exp) || exp <= Date.now() / 1000
			|| typeof iat !== "number" || !Number.isInteger(iat) || iat > Date.now() / 1000 + 300 || exp <= iat
			|| exp - iat > 3600
			|| (nbf !== undefined
				&& (typeof nbf !== "number" || !Number.isInteger(nbf) || nbf > Date.now() / 1000 + 300))
		) throw new Error();
		return exp;
	}
	catch {
		throw new CubeError("INVALID_RESPONSE", "The controller returned an invalid or expired app token.");
	}
}
