import {validateBarcodeConfig as validateCodeReaderConfig} from "@variocube/driver-common/barcode-reader/config";
import {VcmpClient, type VcmpMessage, type VcmpSession} from "@variocube/vcmp";
import {CubeError, toCubeError} from "./errors.js";
import type {
	AvailabilityMessage,
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
import {eventSchemas, initialStateSchema, replySchema, storageSchema} from "./schema.js";
import {ControllerSession, PROTOCOL_MAJOR} from "./session.js";
import type {
	AvailabilityEvent,
	AvailabilityState,
	CloseEvent,
	CodeEvent,
	CodeReaderConfig,
	Compartment,
	CompartmentsEvent,
	ConnectionState,
	Cube,
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
	state: ConnectionState;
	availability: AvailabilityEvent;
	occupancyCreated: OccupancyChangedEvent;
	occupancyUpdated: OccupancyChangedEvent;
	occupancyAccessChanged: OccupancyChangedEvent;
	occupancyEnded: OccupancyEndedEvent;
}

type ListenerRegistry = { [E in keyof EventMap]: Array<EventListener<EventMap[E]>> };

interface PendingRequest {
	sent: boolean;
	mutation: boolean;
	reject(error: CubeError): void;
}

export interface CubeImplOptions {
	session: ControllerSession;
	secondary?: boolean;
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
		state: [],
		availability: [],
		occupancyCreated: [],
		occupancyUpdated: [],
		occupancyAccessChanged: [],
		occupancyEnded: [],
	};
	readonly #client: VcmpClient;
	#secondary = false;
	readonly #session: ControllerSession;
	readonly #unsubscribeSession: () => void;
	#storageAvailable = false;
	#storageEpoch = 0;
	#state: ConnectionState = {status: "disconnected"};
	#wireGeneration: number | undefined;
	#wireRevision = 0;
	#authenticated = false;
	#authenticationPending = false;
	#bufferedInitialState = false;
	#authenticationBytes = 0;
	readonly #authenticationMessages: Array<() => void> = [];
	#initialTimer: ReturnType<typeof setTimeout> | undefined;
	#compartments: Compartment[] = [];
	#devices: Device[] = [];
	#identity: CubeIdentity | undefined;
	#controllerConnected: boolean | undefined;
	#generation = 0;
	#occupancyRevision = 0;
	#occupancyState: OccupancyState = {status: "unavailable", error: disconnected()};
	#storageState: AvailabilityState = {status: "unavailable", error: disconnected()};
	readonly #pending = new Set<PendingRequest>();
	readonly #storageItems = new Map<string, StorageItem>();
	readonly #storageReads = new Map<string, Promise<StorageItem>>();
	readonly #storageVersions = new Map<string, number>();
	#tokenRefresh: Promise<string> | undefined;
	readonly occupancies: Occupancies;
	readonly storage: CubeStorage;

	constructor(options: CubeImplOptions) {
		this.#session = options.session;
		this.#secondary = options.secondary ?? false;
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
			occupyType: request => this.#request({"@type": "occupyType", ...request}, true),
			occupyBox: request => this.#request({"@type": "occupyBox", ...request}, true),
			confirm: (uuid, content, merge) => this.#request({"@type": "confirmOccupancy", uuid, content, merge}, true),
			cancel: uuid => this.#request({"@type": "cancelOccupancy", uuid}, true),
			update: (uuid, options) => this.#request({"@type": "updateOccupancy", uuid, ...options}, true),
			changeAccess: (uuid, options) => this.#request({"@type": "changeOccupancyAccess", uuid, ...options}, true),
			end: (uuid, options) => this.#request({"@type": "endOccupancy", uuid, ...options}, true),
			list: access => this.#listOccupancies(access),
			get: uuid => this.#request({"@type": "getOccupancy", uuid}, false),
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
			keys: () => this.#request({"@type": "getStorageKeys"}, false),
		};
		this.#client = new VcmpClient(options.session.webSocketUrl, {autoStart: false});
		this.#client.onOpen = () => {
			this.#controllerConnected = undefined;
			this.#reset();
			this.#setState({status: "initializing"});
			const generation = this.#generation;
			this.#initialTimer = setTimeout(
				() => this.#fail(new CubeError("TIMEOUT", "Authentication or initial state timed out.")),
				10000,
			);
			void options.session.getCredential().then(credential => {
				if (generation !== this.#generation || !this.connected) throw disconnected();
				this.#authenticationPending = true;
				return this.#client.send({"@type": "authenticate", protocolMajor: PROTOCOL_MAJOR, credential});
			}).then(reply => {
				if (generation !== this.#generation || !this.connected) return;
				if (reply?.protocolMajor !== PROTOCOL_MAJOR) {
					throw new CubeError("PROTOCOL_MISMATCH", "Controller protocol major does not match.");
				}
				if (!Number.isSafeInteger(reply.generation) || reply.generation !== options.session.generation) {
					throw new CubeError(
						"AUTHENTICATION_REQUIRED",
						"The installed app generation changed; a fresh kiosk launch is required.",
					);
				}
				this.#wireGeneration = reply.generation;
				this.#authenticated = true;
				this.#authenticationPending = false;
				const buffered = this.#authenticationMessages.splice(0);
				this.#authenticationBytes = 0;
				for (const receive of buffered) {
					if (generation !== this.#generation) break;
					receive();
				}
			}, error => {
				if (generation === this.#generation) this.#fail(toCubeError(error));
			}).catch(error => this.#fail(toCubeError(error)));
		};
		this.#client.onClose = () => {
			this.#controllerConnected = false;
			this.#reset();
			this.#setState({status: "disconnected"});
			this.#dispatchEvent("close", {});
		};
		this.#on<InitialState>("initialState", event => {
			if (!this.#authenticated || event.generation !== this.#wireGeneration || !validInitialState(event)) {
				this.#fail(new CubeError("INVALID_RESPONSE", "Invalid authenticated initial state."));
				return;
			}
			clearTimeout(this.#initialTimer);
			this.#wireRevision = event.revision;
			this.#controllerConnected = true;
			this.#identity = event.identity;
			this.#compartments = event.compartments;
			this.#devices = event.devices;
			this.#occupancyState = {status: "ready", data: event.occupancies};
			this.#storageAvailable = event.storageReady;
			this.#storageState = event.storageReady ? {status: "ready"} : {status: "unavailable"};
			this.#setState({
				status: event.storageReady ? "ready" : "unavailable",
				generation: event.generation,
				revision: event.revision,
			});
			this.#dispatchEvent("identity", {identity: this.#identity});
			this.#dispatchEvent("compartments", {compartments: this.#compartments});
			this.#dispatchEvent("devices", {devices: this.#devices});
			this.#dispatchEvent("occupancies", this.#occupancyState);
			this.#dispatchAvailability();
			this.#dispatchEvent("open", {});
		});
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
			if (!event.connected) {
				this.#fail(new CubeError(event.error?.code ?? "UNAVAILABLE", "Controller domain unavailable."));
			}
		});
		this.#on<CubeMessage>("cube", event => {
			if (!this.#acceptExtension()) return;
			if (this.#identity && (this.#identity.cubeId !== event.cubeId || this.#identity.appId !== event.appId)) {
				this.#fail(new CubeError("AUTHENTICATION_REQUIRED", "The installed app changed."));
				return;
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
			if (this.#storageVersions.size >= 256 && !this.#storageVersions.has(event.key)) {
				this.#storageEpoch++;
				this.#storageVersions.clear();
				this.#storageItems.clear();
				this.#storageReads.clear();
			}
			this.#storageVersions.set(event.key, (this.#storageVersions.get(event.key) ?? 0) + 1);
			this.#storageItems.delete(event.key);
			this.#storageReads.delete(event.key);
			this.#dispatchEvent("storage", {key: event.key});
		});
		this.#unsubscribeSession = this.#session.onInvalidation(() =>
			this.#fail(new CubeError("AUTHENTICATION_REQUIRED", "A fresh kiosk launch is required."))
		);
		this.#client.start();
	}

	#on<T>(name: string, handler: (message: T) => void) {
		const receive = (message: T, session: VcmpSession) => {
			// VCMP schedules message handlers asynchronously; a closed socket may have queued a final event.
			if (!session.isOpen) return;
			if (!this.#authenticated && this.#authenticationPending) {
				const bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
				if (
					this.#authenticationMessages.length >= 65 || this.#authenticationBytes + bytes > 262144
					|| (name === "initialState" && this.#bufferedInitialState)
				) {
					this.#fail(
						new CubeError("LIMIT_EXCEEDED", "Authentication publication buffer exceeded its limit."),
					);
					return;
				}
				if (name === "initialState") this.#bufferedInitialState = true;
				this.#authenticationBytes += bytes;
				this.#authenticationMessages.push(() => receive(message, session));
				return;
			}
			const parsed = eventSchemas[name]?.safeParse(message);
			if (!parsed?.success) {
				this.#fail(new CubeError("INVALID_RESPONSE", "Invalid controller event."));
				return;
			}
			message = parsed.data as T;
			if (name !== "initialState") {
				if (!this.#authenticated || this.#state.status !== "ready") return;
				const event = message as WireBoundary;
				if (event.generation !== this.#wireGeneration) {
					this.#fail(new CubeError("STALE_RESPONSE", "The installed app generation changed."));
					return;
				}
				if (!Number.isSafeInteger(event.revision) || event.revision !== this.#wireRevision + 1) {
					this.#resynchronize();
					return;
				}
				this.#wireRevision = event.revision;
				this.#setState({...this.#state, revision: event.revision});
			}
			handler(message);
		};
		this.#client.on<T>(name, receive);
	}

	#acceptExtension() {
		return this.connected && this.#authenticated && this.#controllerConnected === true;
	}

	#reset() {
		this.#generation++;
		this.#occupancyRevision++;
		for (const pending of [...this.#pending]) {
			pending.reject(pending.sent && pending.mutation ? unknownOutcome() : disconnected());
		}
		this.#storageAvailable = false;
		this.#storageEpoch++;
		this.#storageItems.clear();
		this.#storageReads.clear();
		this.#storageVersions.clear();
		this.#tokenRefresh = undefined;
		this.#identity = undefined;
		clearTimeout(this.#initialTimer);
		this.#authenticated = false;
		this.#authenticationPending = false;
		this.#bufferedInitialState = false;
		this.#authenticationBytes = 0;
		this.#authenticationMessages.length = 0;
		this.#wireGeneration = undefined;
		this.#compartments = [];
		this.#devices = [];
		this.#dispatchEvent("compartments", {compartments: []});
		this.#dispatchEvent("devices", {devices: []});
		this.#occupancyState = {status: "loading"};
		this.#storageState = {status: "loading"};
		this.#dispatchEvent("identity", {identity: undefined});
		this.#refreshAvailability(true);
	}

	#setState(state: ConnectionState) {
		this.#state = state;
		this.#dispatchEvent("state", state);
	}

	#fail(error: CubeError) {
		this.#client.onClose = undefined;
		this.#client.stop();
		this.#controllerConnected = false;
		this.#reset();
		this.#setState({status: error.code === "AUTHENTICATION_REQUIRED" ? "unavailable" : "error", error});
	}

	#resynchronize() {
		this.#controllerConnected = false;
		this.#reset();
		this.#setState({status: "initializing"});
		this.#client.start();
	}

	#featureState(): AvailabilityState {
		if (!this.connected) return {status: "unavailable", error: disconnected()};
		if (!this.#acceptExtension() || !this.#identity) return {status: "loading"};
		return {status: "ready"};
	}

	#refreshAvailability(force = false) {
		const storage = this.#featureState();
		if (storage.status === "ready" && !this.#storageAvailable) storage.status = "unavailable";
		const occupancy = this.#featureState();
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
			const data = await this.#request<Occupancy[]>({"@type": "getOccupancies", access}, false);
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
					status: ["DISCONNECTED", "AUTHENTICATION_REQUIRED", "APP_NOT_CONFIGURED"].includes(failure.code)
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
		const epoch = this.#storageEpoch;
		const item = await this.#readStorage(key);
		// Even cached reads cross an async boundary; never expose a value invalidated in the meantime.
		if (generation !== this.#generation) throw disconnected();
		if (epoch !== this.#storageEpoch || version !== (this.#storageVersions.get(key) ?? 0)) {
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
		const epoch = this.#storageEpoch;
		const request = this.#request<StorageItem>({"@type": "getStorageItem", key}, false).then(item => {
			if (generation !== this.#generation) throw disconnected();
			if (epoch !== this.#storageEpoch || version !== (this.#storageVersions.get(key) ?? 0)) {
				throw new CubeError("STALE_RESPONSE", `Storage item ${key} changed while it was being read.`);
			}
			if (
				!storageSchema.safeParse(item).success || item.key !== key || typeof item.contentType !== "string"
				|| (item.encoding !== "json" && item.encoding !== "base64")
				|| (item.encoding === "base64" && typeof item.content !== "string") || !("content" in item)
			) {
				throw new CubeError("INVALID_RESPONSE", "Invalid storage reply from the controller.");
			}
			if (new TextEncoder().encode(JSON.stringify(item)).byteLength <= 65536) {
				if (this.#storageItems.size >= 128) {
					const oldest = this.#storageItems.keys().next().value;
					if (oldest !== undefined) this.#storageItems.delete(oldest);
				}
				this.#storageItems.set(key, item);
			}
			return item;
		}).finally(() => {
			if (this.#storageReads.get(key) === request) this.#storageReads.delete(key);
		});
		this.#storageReads.set(key, request);
		return request;
	}

	#request<T = void>(message: VcmpMessage & Record<string, unknown>, mutation = false): Promise<T> {
		if (!this.connected) return Promise.reject(disconnected());
		if (this.#state.status !== "ready") {
			return Promise.reject(new CubeError("NOT_READY", "Authenticated initial state is not available."));
		}
		if (this.#pending.size >= 64 || new TextEncoder().encode(JSON.stringify(message)).byteLength > 65536) {
			return Promise.reject(new CubeError("LIMIT_EXCEEDED", "The request exceeds the client request budget."));
		}
		const generation = this.#generation;
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			const finish = (error?: CubeError, value?: T) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				this.#pending.delete(pending);
				if (error) reject(error);
				else resolve(value as T);
			};
			const pending: PendingRequest = {sent: false, mutation, reject: error => finish(error)};
			const timeout = setTimeout(() => {
				finish(
					mutation
						? unknownOutcome()
						: new CubeError("TIMEOUT", "The controller request exceeded its original 10-second deadline."),
				);
				// Closing the underlying VCMP session reclaims correlation callbacks as well.
				this.#resynchronize();
			}, 10000);
			this.#pending.add(pending);
			try {
				pending.sent = true;
				void this.#client.send(message).then(reply => {
					if (generation !== this.#generation) return finish(mutation ? unknownOutcome() : disconnected());
					if (
						!replySchema.safeParse(reply).success || reply.generation !== this.#wireGeneration
						|| !Number.isSafeInteger(reply.revision)
					) {
						return finish(
							new CubeError("STALE_RESPONSE", "The reply does not belong to the current app generation."),
						);
					}
					finish(undefined, reply.result as T);
				}, error => {
					const failure = toCubeError(error);
					finish(isTransportFailure(error) ? mutation ? unknownOutcome() : disconnected() : failure);
				});
			}
			catch {
				finish(mutation ? unknownOutcome() : disconnected());
			}
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
		const refresh = this.#request<string>({"@type": "getToken"}, false).then(token => {
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
	get state() {
		return this.#state;
	}

	setBoxMaintenance(boxNumber: string, required: boolean): Promise<void> {
		return this.#request(
			{"@type": "updateBoxMaintenance", boxNumber, maintenanceRequired: required},
			true,
		);
	}

	requireBoxMaintenance(boxNumber: string): Promise<void> {
		return this.setBoxMaintenance(boxNumber, true);
	}

	close() {
		this.#unsubscribeSession();
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
				console.error("Cube event listener failed; details suppressed to protect credentials.");
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

interface WireBoundary {
	generation: number;
	revision: number;
}

interface InitialState extends WireBoundary {
	identity: CubeIdentity;
	compartments: Compartment[];
	devices: Device[];
	occupancies: Occupancy[];
	storageReady: boolean;
}

function validInitialState(value: InitialState): boolean {
	return initialStateSchema.safeParse(value).success && Number.isSafeInteger(value.revision) && value.revision >= 0
		&& !!value.identity && typeof value.identity.cubeId === "string" && typeof value.identity.appId === "string"
		&& typeof value.storageReady === "boolean"
		&& Array.isArray(value.compartments) && Array.isArray(value.devices) && Array.isArray(value.occupancies)
		&& value.occupancies.every(occupancy => occupancy.appId === value.identity.appId);
}
