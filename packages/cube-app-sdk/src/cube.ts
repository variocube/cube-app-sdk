import {validateBarcodeConfig as validateCodeReaderConfig} from "@variocube/driver-common/barcode-reader/config";
import {VcmpClient, type VcmpMessage, type VcmpSession} from "@variocube/vcmp";
import {CubeError, toCubeError} from "./errors.js";
import type {
	AvailabilityMessage,
	CodeMessage,
	CompartmentsMessage,
	CubeMessage,
	DevicesMessage,
	InitialStateMessage,
	LockMessage,
	OccupanciesMessage,
	OccupancyAccessChangedMessage,
	OccupancyCreatedMessage,
	OccupancyEndedMessage,
	OccupancyUpdatedMessage,
	ReadyMessage,
	StorageChunkMessage,
	StorageItem,
	StorageItemMessage,
	StorageItemRemovedMessage,
	WireBoundary,
} from "./messages.js";
import {eventSchemas, initialStateSchema, replySchema, storageSchema} from "./schema.js";
import {ControllerSessionImpl, PROTOCOL_MAJOR} from "./session.js";
import type {
	CodeReaderConfig,
	Compartment,
	CompartmentFeature,
	ConnectionState,
	Cube,
	CubeEventMap,
	CubeIdentity,
	CubeStorage,
	Device,
	EventListener,
	Occupancies,
	Occupancy,
	OccupancyChangedEvent,
	OpenContext,
} from "./types.js";

type ListenerRegistry = { [E in keyof CubeEventMap]: Array<EventListener<CubeEventMap[E]>> };

/** The SDK names required features like `Compartment.features`; the controller takes one flag per feature. */
const FEATURE_FLAGS: Record<CompartmentFeature, string> = {
	ACCESSIBLE: "accessible",
	COOLED: "cooled",
	DANGEROUS_GOODS: "dangerousGoods",
	CHARGER: "charger",
};

const STORAGE_ITEM_BYTES = 1048576 + 4096;
const STORAGE_TOTAL_BYTES = 68 * 1048576;
const STORAGE_CHUNK_BYTES = 48 * 1024;

interface StorageAssembly {
	key: string;
	total: number;
	parts: Uint8Array[];
	bytes: number;
}

interface PendingRequest {
	sent: boolean;
	reject(error: CubeError): void;
}

export interface CubeImplOptions {
	session: ControllerSessionImpl;
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
		connection: [],
		occupancyCreated: [],
		occupancyUpdated: [],
		occupancyAccessChanged: [],
		occupancyEnded: [],
	};
	readonly #client: VcmpClient;
	#secondary = false;
	readonly #unsubscribeSession: () => void;
	#initialReceived = false;
	#storageBytes = 0;
	#storageAssembly: StorageAssembly | undefined;
	#storageTimer: ReturnType<typeof setTimeout> | undefined;
	readonly #storageSizes = new Map<string, number>();
	#connection: ConnectionState = {status: "disconnected"};
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
	#token: { token: string; expiresAt: number } | undefined;
	#controllerConnected: boolean | undefined;
	#generation = 0;
	#occupancies: Occupancy[] | undefined;
	readonly #pending = new Set<PendingRequest>();
	readonly #storageItems = new Map<string, StorageItem>();
	readonly occupancies: Occupancies;
	readonly storage: CubeStorage;

	constructor(options: CubeImplOptions) {
		this.#secondary = options.secondary ?? false;
		this.occupancies = {
			occupyType: ({features, ...request}) => {
				const flags = Object.fromEntries((features ?? []).map(feature => [FEATURE_FLAGS[feature], true]));
				return this.#request({"@type": "occupyType", ...request, ...flags});
			},
			occupyCompartment: request => this.#request({"@type": "occupyBox", ...request}),
			confirm: (uuid, options) => this.#request({"@type": "confirmOccupancy", uuid, ...options}),
			cancel: uuid => this.#request({"@type": "cancelOccupancy", uuid}),
			update: (uuid, options) => this.#request({"@type": "updateOccupancy", uuid, ...options}),
			changeAccess: (uuid, options) => this.#request({"@type": "changeOccupancyAccess", uuid, ...options}),
			end: (uuid, options) => this.#request({"@type": "endOccupancy", uuid, ...options}),
			list: access =>
				structuredClone(
					this.#readOccupancies().filter(occupancy =>
						access === undefined || occupancy.accessCode === access || occupancy.accessKeys.includes(access)
					),
				),
			get: uuid => structuredClone(this.#readOccupancies().find(occupancy => occupancy.uuid === uuid)),
		};
		this.storage = {
			get: <T>(key: string, parse?: (value: unknown) => T) => {
				const item = this.#readStorage(key);
				if (!item) return undefined;
				if (item.encoding !== "json") {
					throw new CubeError("INVALID_CONTENT_TYPE", `Storage item ${key} is not JSON; use getBlob().`);
				}
				const content = structuredClone(item.content);
				return parse ? parse(content) : content as T;
			},
			getBlob: key => {
				const item = this.#readStorage(key);
				if (!item) return undefined;
				const data = item.encoding === "json"
					? JSON.stringify(item.content)
					: Uint8Array.from(atob(item.content as string), character => character.charCodeAt(0));
				return new Blob([data], {type: item.contentType});
			},
			keys: () => {
				this.#assertReady();
				return [...this.#storageItems.keys()].sort();
			},
		};
		this.#client = new VcmpClient(options.session.webSocketUrl, {autoStart: false});
		this.#client.onOpen = () => {
			this.#controllerConnected = undefined;
			this.#reset({status: "initializing"});
			const generation = this.#generation;
			this.#initialTimer = setTimeout(
				() => this.#fail(new CubeError("TIMEOUT", "Authentication or initial state timed out.")),
				10000,
			);
			void options.session.getCredential().then(credential => {
				if (generation !== this.#generation || !this.#socketOpen) throw disconnected();
				this.#authenticationPending = true;
				return this.#client.send({"@type": "authenticate", protocolMajor: PROTOCOL_MAJOR, credential});
			}).then(reply => {
				if (generation !== this.#generation || !this.#socketOpen) return;
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
			this.#reset({status: "disconnected"});
		};
		this.#on<InitialStateMessage>("initialState", event => {
			if (
				!this.#authenticated || (this.#initialReceived && !this.connected)
				|| event.generation !== this.#wireGeneration || !validInitialState(event)
			) {
				this.#fail(new CubeError("INVALID_RESPONSE", "Invalid authenticated initial state."));
				return;
			}
			if (
				this.#identity
				&& (event.identity.appId !== this.#identity.appId || event.identity.cubeId !== this.#identity.cubeId)
			) {
				this.#fail(new CubeError("AUTHENTICATION_REQUIRED", "The installed app changed."));
				return;
			}
			if (this.#initialReceived && event.revision !== this.#wireRevision + 1) {
				this.#resynchronize();
				return;
			}
			this.#storageAssembly = undefined;
			clearTimeout(this.#storageTimer);
			clearTimeout(this.#initialTimer);
			this.#initialTimer = setTimeout(
				() => this.#fail(new CubeError("TIMEOUT", "Initial storage timed out.")),
				10000,
			);
			this.#storageItems.clear();
			this.#storageSizes.clear();
			this.#storageBytes = 0;
			this.#initialReceived = true;
			this.#wireRevision = event.revision;
			this.#controllerConnected = true;
			const {cubeId, appId, token, expiresAt} = event.identity;
			const identityChanged = !this.#identity;
			this.#identity = {cubeId, appId: appId as string};
			this.#token = token && expiresAt ? {token, expiresAt} : undefined;
			this.#compartments = event.compartments;
			this.#devices = event.devices;
			this.#occupancies = event.occupancies;
			// A same-generation resnapshot replaces the storage, so reads wait for the next ready barrier.
			const wasReady = this.connected;
			this.#connection = {status: "initializing"};
			if (identityChanged) this.#dispatchEvent("identity", {identity: this.#identity});
			this.#dispatchEvent("compartments", {compartments: this.#compartments});
			this.#dispatchEvent("devices", {devices: this.#devices});
			this.#dispatchEvent("occupancies", {occupancies: this.#occupancies});
			if (wasReady) {
				this.#dispatchEvent("connection", {connection: this.#connection});
				this.#dispatchEvent("close", {});
			}
		});
		this.#on<ReadyMessage>("ready", () => {
			if (this.#storageAssembly) {
				this.#fail(new CubeError("INVALID_RESPONSE", "Invalid storage readiness barrier."));
				return;
			}
			clearTimeout(this.#initialTimer);
			if (this.connected) return;
			this.#connection = {status: "ready"};
			this.#dispatchEvent("connection", {connection: this.#connection});
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
			if (!this.#acceptExtension() || !this.#identity) return;
			if (this.#identity.cubeId !== event.cubeId || this.#identity.appId !== event.appId) {
				this.#fail(new CubeError("AUTHENTICATION_REQUIRED", "The installed app changed."));
				return;
			}
			// A rotated token is not an identity change; getToken() reads it on demand.
			this.#token = event.token && event.expiresAt ? {token: event.token, expiresAt: event.expiresAt} : undefined;
		});
		this.#on<OccupanciesMessage>("occupancies", event => {
			if (!this.#acceptExtension() || !this.#identity) return;
			this.#setOccupancies(event.occupancies.filter(o => o.appId === this.#identity?.appId));
		});
		this.#on<OccupancyCreatedMessage>("occupancyCreated", event => this.#upsert("occupancyCreated", event));
		this.#on<OccupancyUpdatedMessage>("occupancyUpdated", event => this.#upsert("occupancyUpdated", event));
		this.#on<OccupancyAccessChangedMessage>(
			"occupancyAccessChanged",
			event => this.#upsert("occupancyAccessChanged", event),
		);
		this.#on<OccupancyEndedMessage>("occupancyEnded", event => {
			if (!this.#acceptExtension() || !this.#identity) return;
			if (this.#occupancies) this.#setOccupancies(this.#occupancies.filter(o => o.uuid !== event.uuid));
			this.#dispatchEvent("occupancyEnded", event);
		});
		this.#on<StorageItemMessage>("storageItem", event => {
			if (this.#storageAssembly) throw new CubeError("INVALID_RESPONSE", "Storage chunks were interrupted.");
			this.#storeItem(event);
		});
		this.#on<StorageChunkMessage>("storageChunk", event => this.#receiveStorageChunk(event));
		this.#on<StorageItemRemovedMessage>("storageItemRemoved", event => {
			if (this.#storageAssembly) throw new CubeError("INVALID_RESPONSE", "Storage chunks were interrupted.");
			this.#storageBytes -= this.#storageSizes.get(event.key) ?? 0;
			this.#storageSizes.delete(event.key);
			this.#storageItems.delete(event.key);
			this.#dispatchEvent("storage", {key: event.key});
		});
		this.#unsubscribeSession = options.session.onInvalidation(() =>
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
				if (!this.#authenticated || !this.#initialReceived) return;
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
			}
			try {
				handler(message);
			}
			catch (error) {
				this.#fail(
					error instanceof CubeError
						? error
						: new CubeError("INVALID_RESPONSE", "Invalid controller event content."),
				);
			}
		};
		this.#client.on<T>(name, receive);
	}

	#acceptExtension() {
		return this.#socketOpen && this.#authenticated && this.#controllerConnected === true;
	}

	/** Enters a status other than ready and drops everything that belonged to the previous connection. */
	#reset(connection: ConnectionState) {
		const wasReady = this.connected;
		const changed = this.#connection.status !== connection.status || this.#connection.error !== connection.error;
		this.#connection = connection;
		this.#generation++;
		for (const pending of [...this.#pending]) pending.reject(pending.sent ? unknownOutcome() : disconnected());
		this.#storageItems.clear();
		this.#storageSizes.clear();
		this.#storageBytes = 0;
		this.#storageAssembly = undefined;
		this.#initialReceived = false;
		clearTimeout(this.#storageTimer);
		clearTimeout(this.#initialTimer);
		this.#authenticated = false;
		this.#authenticationPending = false;
		this.#bufferedInitialState = false;
		this.#authenticationBytes = 0;
		this.#authenticationMessages.length = 0;
		this.#wireGeneration = undefined;
		this.#token = undefined;
		this.#compartments = [];
		this.#devices = [];
		this.#dispatchEvent("compartments", {compartments: []});
		this.#dispatchEvent("devices", {devices: []});
		if (this.#occupancies) this.#setOccupancies(undefined);
		if (this.#identity) {
			this.#identity = undefined;
			this.#dispatchEvent("identity", {identity: undefined});
		}
		if (changed) this.#dispatchEvent("connection", {connection});
		if (wasReady) this.#dispatchEvent("close", {});
	}

	#fail(error: CubeError) {
		this.#client.onClose = undefined;
		this.#client.stop();
		this.#controllerConnected = false;
		this.#reset({status: error.code === "AUTHENTICATION_REQUIRED" ? "unavailable" : "error", error});
	}

	#resynchronize() {
		this.#controllerConnected = false;
		this.#reset({status: "initializing"});
		this.#client.start();
	}

	#setOccupancies(occupancies: Occupancy[] | undefined) {
		this.#occupancies = occupancies;
		this.#dispatchEvent("occupancies", {occupancies});
	}

	#upsert(name: "occupancyCreated" | "occupancyUpdated" | "occupancyAccessChanged", event: OccupancyChangedEvent) {
		if (!this.#acceptExtension() || event.occupancy.appId !== this.#identity?.appId) return;
		if (this.#occupancies) {
			const data = [...this.#occupancies];
			const index = data.findIndex(o => o.uuid === event.occupancy.uuid);
			if (index === -1) data.push(event.occupancy);
			else data[index] = event.occupancy;
			this.#setOccupancies(data);
		}
		this.#dispatchEvent(name, event);
	}

	#storeItem(value: unknown) {
		const item = storageSchema.parse(value);
		if (!("content" in item) || (item.encoding === "base64" && typeof item.content !== "string")) {
			throw new CubeError("INVALID_RESPONSE", "Invalid storage content.");
		}
		if (item.encoding === "base64") decodeBase64(item.content as string);
		const bytes = new TextEncoder().encode(JSON.stringify(item)).byteLength;
		const total = this.#storageBytes - (this.#storageSizes.get(item.key) ?? 0) + bytes;
		if (
			bytes > STORAGE_ITEM_BYTES || total > STORAGE_TOTAL_BYTES
			|| (!this.#storageItems.has(item.key) && this.#storageItems.size >= 16384)
		) {
			throw new CubeError("LIMIT_EXCEEDED", "The complete app storage exceeds the client budget.");
		}
		this.#storageItems.set(item.key, item as StorageItem);
		this.#storageSizes.set(item.key, bytes);
		this.#storageBytes = total;
		this.#dispatchEvent("storage", {key: item.key});
	}

	#receiveStorageChunk(event: StorageChunkMessage) {
		if (!this.#storageAssembly) {
			if (event.index !== 0) throw new CubeError("INVALID_RESPONSE", "Missing first storage chunk.");
			this.#storageAssembly = {key: event.key, total: event.total, parts: [], bytes: 0};
			this.#storageTimer = setTimeout(
				() => this.#fail(new CubeError("TIMEOUT", "Storage transfer timed out.")),
				10000,
			);
		}
		const assembly = this.#storageAssembly;
		const bytes = decodeBase64(event.content);
		if (
			assembly.key !== event.key || assembly.total !== event.total || event.index !== assembly.parts.length
			|| bytes.byteLength === 0 || bytes.byteLength > STORAGE_CHUNK_BYTES
			|| assembly.bytes + bytes.byteLength > STORAGE_ITEM_BYTES
		) {
			throw new CubeError("INVALID_RESPONSE", "Invalid storage chunk sequence or size.");
		}
		assembly.parts.push(bytes);
		assembly.bytes += bytes.byteLength;
		if (assembly.parts.length !== assembly.total) return;
		const joined = new Uint8Array(assembly.bytes);
		let offset = 0;
		for (const part of assembly.parts) {
			joined.set(part, offset);
			offset += part.byteLength;
		}
		const item = storageSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(joined)));
		if (item.key !== assembly.key) throw new CubeError("INVALID_RESPONSE", "Storage chunk key changed.");
		clearTimeout(this.#storageTimer);
		this.#storageAssembly = undefined;
		this.#storeItem(item);
	}

	/** Why reads and commands are refused, or undefined when the connection is ready. */
	#unready(): CubeError | undefined {
		const {status, error} = this.#connection;
		if (status === "ready") return undefined;
		if (error) return error;
		return status === "initializing"
			? new CubeError("NOT_READY", "The complete controller snapshot is not available yet.")
			: disconnected();
	}

	/** Local reads never answer from an incomplete snapshot: unknown data must not look empty or absent. */
	#assertReady() {
		const unready = this.#unready();
		if (unready) throw unready;
	}

	#readOccupancies(): Occupancy[] {
		this.#assertReady();
		return this.#occupancies ?? [];
	}

	#readStorage(key: string): StorageItem | undefined {
		this.#assertReady();
		return this.#storageItems.get(key);
	}

	/** Every request is a mutation: once sent, a lost reply leaves its outcome unknown and it is never replayed. */
	#request<T = void>(message: VcmpMessage & Record<string, unknown>): Promise<T> {
		const unready = this.#unready();
		if (unready) return Promise.reject(unready);
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
			const pending: PendingRequest = {sent: false, reject: error => finish(error)};
			const timeout = setTimeout(() => {
				finish(unknownOutcome());
				// Closing the underlying VCMP session reclaims correlation callbacks as well.
				this.#resynchronize();
			}, 10000);
			this.#pending.add(pending);
			try {
				pending.sent = true;
				void this.#client.send(message).then(reply => {
					if (generation !== this.#generation) return finish(unknownOutcome());
					if (
						!replySchema.safeParse(reply).success || reply.generation !== this.#wireGeneration
						|| !Number.isSafeInteger(reply.revision)
					) {
						return finish(
							new CubeError("STALE_RESPONSE", "The reply does not belong to the current app generation."),
						);
					}
					finish(undefined, reply.result as T);
				}, error => finish(isTransportFailure(error) ? unknownOutcome() : toCubeError(error)));
			}
			catch {
				finish(unknownOutcome());
			}
		});
	}

	getToken(): Promise<string> {
		const generation = this.#generation;
		// Asynchronous on purpose: it fits authorization callbacks and leaves room for on-demand refresh.
		return Promise.resolve().then(() => {
			if (generation !== this.#generation) throw disconnected();
			this.#assertReady();
			if (!this.#identity || !this.#token) {
				throw new CubeError("NOT_READY", "A current app token has not been published.");
			}
			if (tokenExpiry(this.#token.token, this.#identity) !== this.#token.expiresAt) {
				throw new CubeError("INVALID_RESPONSE", "The published token expiry is inconsistent.");
			}
			return this.#token.token;
		});
	}

	get identity() {
		return this.#identity;
	}
	get connection() {
		return this.#connection;
	}

	setCompartmentMaintenance(compartmentNumber: string, required: boolean): Promise<void> {
		return this.#request(
			{"@type": "updateBoxMaintenance", boxNumber: compartmentNumber, maintenanceRequired: required},
		);
	}

	close() {
		this.#unsubscribeSession();
		this.#controllerConnected = false;
		this.#reset({status: "disconnected"});
		this.#client.stop();
	}

	#dispatchEvent<E extends keyof CubeEventMap>(eventName: E, event: CubeEventMap[E]) {
		for (const listener of [...this.#listeners[eventName]]) {
			try {
				listener(event);
			}
			catch (error) {
				console.error("Cube event listener failed; details suppressed to protect credentials.");
			}
		}
	}

	addEventListener<E extends keyof CubeEventMap>(eventName: E, listener: EventListener<CubeEventMap[E]>) {
		this.#listeners[eventName].push(listener);
		return () => this.removeEventListener(eventName, listener);
	}

	removeEventListener<E extends keyof CubeEventMap>(eventName: E, listener: EventListener<CubeEventMap[E]>) {
		this.#listeners[eventName] = this.#listeners[eventName].filter(l => l !== listener) as ListenerRegistry[E];
	}

	restartUserInterface(): Promise<void> {
		return this.#request({"@type": "restartUi"});
	}
	restartOperatingSystem(): Promise<void> {
		return this.#request({"@type": "restartOs"});
	}
	restartController(): Promise<void> {
		return this.#request({"@type": "restartController"});
	}
	restartDevice(deviceId: string): Promise<void> {
		return this.#request({"@type": "restartDevice", deviceId});
	}

	async configureCodeReader(config: CodeReaderConfig) {
		const {valid, errors} = validateCodeReaderConfig(config);
		if (!valid) throw new CubeError("INVALID_REQUEST", `Invalid code reader configuration: ${errors.join("; ")}`);
		await this.#request({"@type": "configureCodeReader", config});
	}

	openLock(lock: string, context?: OpenContext): Promise<void> {
		return this.#request({"@type": "openLock", lock, ...context});
	}

	async openCompartment(compartmentNumber: string, context?: OpenContext) {
		if (!this.getCompartment(compartmentNumber)) {
			throw new CubeError("NOT_FOUND", `Compartment ${compartmentNumber} not found`);
		}
		const lock = this.getCompartmentLock(compartmentNumber);
		if (!lock) throw new CubeError("NOT_FOUND", `Compartment ${compartmentNumber} has no lock`);
		await this.openLock(lock, context);
	}

	getCompartmentLock(compartmentNumber: string) {
		const compartment = this.getCompartment(compartmentNumber);
		return this.#secondary ? compartment?.secondaryLock : compartment?.lock;
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
		return this.#connection.status === "ready";
	}
	get #socketOpen() {
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
function isTransportFailure(error: unknown) {
	if (!error || typeof error !== "object") return false;
	const detail = error as { status?: unknown; title?: unknown; code?: unknown; properties?: { code?: unknown } };
	// A relay can lose its downstream session before it emits a domain NAK. Transport 503s have no controller code;
	// their wording depends on which VCMP peer detected the loss. Preserve explicit domain rejection codes.
	if (detail.status === 503 && typeof detail.code !== "string" && typeof detail.properties?.code !== "string") {
		return true;
	}
	return ["Session closed", "Session not open", "Send failed", "Invalid acknowledgement"].includes(
		String(detail.title),
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

function validInitialState(value: InitialStateMessage): boolean {
	return initialStateSchema.safeParse(value).success && Number.isSafeInteger(value.revision) && value.revision >= 0
		&& !!value.identity && typeof value.identity.cubeId === "string" && typeof value.identity.appId === "string"
		&& Array.isArray(value.compartments) && Array.isArray(value.devices) && Array.isArray(value.occupancies)
		&& value.occupancies.every(occupancy => occupancy.appId === value.identity.appId);
}

function decodeBase64(value: string): Uint8Array {
	try {
		const decoded = atob(value);
		if (btoa(decoded) !== value) throw new Error();
		return Uint8Array.from(decoded, char => char.charCodeAt(0));
	}
	catch {
		throw new CubeError("INVALID_RESPONSE", "Invalid base64 storage data.");
	}
}
