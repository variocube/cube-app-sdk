import type {
	CodeMessage,
	CompartmentsMessage,
	CubeMessage,
	DevicesMessage,
	LockMessage,
	LockStatus,
	OccupanciesMessage,
	Occupancy,
} from "@variocube/cube-app-sdk";
import {Logger} from "@variocube/driver-common";
import {VcmpClient, type VcmpMessage, type VcmpSession} from "@variocube/vcmp";
import {VcmpServer} from "@variocube/vcmp-server";
import {createServer} from "http";
import {WebSocket, WebSocketServer} from "ws";
import {ControllerRelay, extensionCommands, relayError} from "./controllerRelay";
import type {CapabilitiesMessage} from "./legacy";
import {serveMockUi} from "./serveMockUi";

const log = new Logger("cube-app-service");

export interface ServerOptions {
	host?: string;
	port?: number;
	controllerHost?: string;
	controllerPort?: number;
	controllerReconnectTimeout?: number;
	capabilityTimeout?: number;
	commandTimeout?: number;
}

export class Server {
	readonly #appServer: VcmpServer;
	readonly #mockServer: VcmpServer;
	readonly #webServer: ReturnType<typeof createServer>;
	readonly #controller: VcmpClient;
	readonly #relay: ControllerRelay;
	readonly #appSockets: WebSocketServer;
	readonly #mockSockets: WebSocketServer;
	readonly ready: Promise<void>;

	#controllerWasConnected = false;
	#stopping?: Promise<void>;
	#controllerSession?: VcmpSession;
	#compartments: CompartmentsMessage = EMPTY_COMPARTMENTS_MESSAGE;
	#devices: DevicesMessage = EMPTY_DEVICES_MESSAGE;
	#lockStatus: Record<string, LockStatus> = {};

	constructor(options?: ServerOptions) {
		const {
			host = "localhost",
			port = 4000,
			controllerHost = "localhost",
			controllerPort = 9000,
			controllerReconnectTimeout = 3000,
			capabilityTimeout,
			commandTimeout,
		} = options ?? {};

		this.#webServer = createServer();
		this.#mockSockets = new WebSocketServer({noServer: true});
		this.#appSockets = new WebSocketServer({noServer: true});
		this.#webServer.on("request", serveMockUi);
		this.#webServer.on("upgrade", (request, socket, head) => {
			const {pathname} = new URL(request.url ?? "", "http://localhost:4000");
			const wss = pathname.startsWith("/mock") ? this.#mockSockets : this.#appSockets;
			wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
		});

		// Raw VCMP debug output includes cube identity and getToken ACK payloads. Keep it
		// disabled even at -vvv: bearer credentials must never reach the service logs.
		this.#appServer = new VcmpServer({heartbeatInterval: 10000, webSocketServer: this.#appSockets});
		this.#mockServer = new VcmpServer({heartbeatInterval: 10000, webSocketServer: this.#mockSockets});
		this.#controller = new VcmpClient(`ws://${controllerHost}:${controllerPort}/app`, {
			autoStart: false,
			customWebSocket: WebSocket,
			reconnectTimeout: controllerReconnectTimeout,
		});
		this.#relay = new ControllerRelay({
			send: message => this.#controller.send(message),
			broadcast: message => {
				void this.#appServer.broadcast(message);
			},
			capabilityTimeout,
			commandTimeout,
		});

		this.#appServer.onSessionConnected = session => {
			log.info("App connected.");
			// Send synchronously in this order, without waiting for browser ACKs: a new
			// subscription gets its snapshot before any subsequently received changes.
			for (const message of [...this.#relay.initialMessages, this.#compartments, this.#devices]) {
				this.#sendInitial(session, message);
			}
			for (const compartment of this.#compartments.compartments) {
				const status = compartment.lock ? this.#lockStatus[compartment.lock] : undefined;
				if (compartment.lock && status) {
					this.#sendInitial(session, {
						"@type": "lock",
						lock: compartment.lock,
						compartmentNumber: compartment.number,
						status,
					} as LockMessage);
				}
			}
		};
		this.#appServer.onSessionDisconnected = () => log.info("App disconnected.");
		this.#mockServer.onSessionConnected = () => log.info("Mock connected.");
		this.#mockServer.onSessionDisconnected = () => {
			log.info("Mock disconnected.");
			if (!this.#relay.connected) this.#resetHardware();
		};

		this.#controller.onOpen = () => {
			log.info("Controller connected.");
			this.#controllerWasConnected = true;
			this.#controllerSession = undefined;
			this.#relay.open();
		};
		this.#controller.onClose = () => {
			this.#controllerSession = undefined;
			if (this.#stopping) return;
			if (this.#controllerWasConnected) {
				log.warn("Controller disconnected.");
				this.#resetHardware();
			}
			this.#relay.close();
		};

		for (const type of hardwareCommands) {
			this.#appServer.on(type, message => this.sendToLocker(message));
		}
		for (const type of Object.keys(extensionCommands)) {
			// Extensions have exactly one authority. They never fall back to /mock.
			this.#appServer.on(type, message => this.#relay.request(message));
		}

		this.#onController<CapabilitiesMessage>("capabilities", message => this.#relay.capabilities(message));
		this.#onController<CubeMessage>("cube", message => this.#relay.identity(message));
		this.#onController<OccupanciesMessage>("occupancies", message => this.#relay.snapshot(message));
		for (const type of ["occupancyCreated", "occupancyUpdated", "occupancyAccessChanged", "occupancyEnded"]) {
			this.#onController<VcmpMessage & { occupancy?: Occupancy; uuid?: string }>(
				type,
				message => this.#relay.occupancyChanged(message),
			);
		}
		this.#onController("storageItemChanged", message => this.#relay.storageChanged(message));

		this.#onHardware<CompartmentsMessage>("compartments", message => {
			this.#compartments = message;
			void this.#appServer.broadcast(message);
		});
		this.#onHardware<DevicesMessage>("devices", message => {
			this.#devices = message;
			void this.#appServer.broadcast(message);
		});
		this.#onHardware<LockMessage>("lock", message => {
			this.#lockStatus[message.lock] = message.status;
			void this.#appServer.broadcast(message);
		});
		this.#onHardware<CodeMessage>("code", message => {
			void this.#appServer.broadcast(message);
		}, true);

		this.ready = new Promise((resolve, reject) => {
			this.#webServer.once("listening", () => resolve());
			this.#webServer.once("error", reject);
		});
		this.ready.catch(error => {
			log.error("Error starting web server", error);
			void this.stop().catch(() => undefined);
		});
		this.#webServer.listen(port, host, () => {
			const address = this.address;
			const actualPort = address && typeof address === "object" ? address.port : port;
			log.info(`Listening on ${host} port ${actualPort}.`);
			log.info(`Open http://${host}:${actualPort}/ to start the virtual cube.`);
		});
		this.#controller.start();
	}

	get address() {
		return this.#webServer.address();
	}

	async sendToLocker<T extends VcmpMessage>(message: T) {
		log.debug("Sending hardware command", message["@type"]);
		if (this.#relay.connected) {
			return this.#relay.request(message, true);
		}
		if (this.#mockServer.sessions.length > 0) {
			void this.#mockServer.broadcast(message);
			return;
		}
		throw relayError("DISCONNECTED", "No locker connected.");
	}

	stop(): Promise<void> {
		if (!this.#stopping) this.#stopping = this.#stop();
		return this.#stopping;
	}

	async #stop() {
		log.info("Stopping service...");
		this.#relay.close();
		this.#controller.stop();
		for (const socket of [...this.#appSockets.clients, ...this.#mockSockets.clients]) socket.terminate();
		await Promise.all([this.#appServer.stop(), this.#mockServer.stop()]);
		if (this.#webServer.listening) {
			await new Promise<void>((resolve, reject) => {
				this.#webServer.close(error => error ? reject(error) : resolve());
			});
		}
	}

	#onController<T extends VcmpMessage>(type: string, handle: (message: T) => void) {
		this.#controller.on<T>(type, (message, session) => {
			// VCMP schedules handlers in microtasks. A queued frame from a closed session
			// must not populate a replacement controller's state.
			if (!this.#relay.connected || !session.isOpen) return;
			if (this.#controllerSession && this.#controllerSession !== session) return;
			this.#controllerSession = session;
			handle(message);
		});
	}

	#onHardware<T extends VcmpMessage>(type: string, handle: (message: T) => void, allowMock = false) {
		this.#onController<T>(type, handle);
		this.#mockServer.on<T>(type, message => {
			if (allowMock || !this.#relay.connected) handle(message);
		});
	}

	#sendInitial(session: VcmpSession, message: VcmpMessage) {
		void session.send(message).catch(() => log.debug("Initial message could not be delivered", message["@type"]));
	}

	#resetHardware() {
		this.#compartments = EMPTY_COMPARTMENTS_MESSAGE;
		this.#devices = EMPTY_DEVICES_MESSAGE;
		this.#lockStatus = {};
		void this.#appServer.broadcast(this.#compartments);
		void this.#appServer.broadcast(this.#devices);
	}
}

const hardwareCommands = [
	"openLock",
	"restartOs",
	"restartUi",
	"restartController",
	"restartDevice",
	"configureCodeReader",
];

const EMPTY_COMPARTMENTS_MESSAGE: CompartmentsMessage = {"@type": "compartments", compartments: []};
const EMPTY_DEVICES_MESSAGE: DevicesMessage = {"@type": "devices", devices: []};
