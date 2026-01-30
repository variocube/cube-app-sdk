import {
	CodeMessage,
	CompartmentsMessage,
	DevicesMessage,
	LockMessage,
	LockStatus,
	OpenLockMessage,
	RestartOsMessage,
	RestartUiMessage,
} from "@variocube/cube-app-sdk";
import {Logger} from "@variocube/driver-common";
import {VcmpClient, VcmpMessage} from "@variocube/vcmp";
import {VcmpServer} from "@variocube/vcmp-server";
import {createServer} from "http";
import {WebSocket, WebSocketServer} from "ws";
import {serveMockUi} from "./serveMockUi";

const log = new Logger("cube-app-service");

interface ServerOptions {
	host?: string;
	port?: number;
	controllerHost?: string;
	controllerPort?: number;
}

export class Server {
	readonly #appServer: VcmpServer;
	readonly #mockServer: VcmpServer;
	readonly #webServer: ReturnType<typeof createServer>;
	readonly #controller: VcmpClient;

	#controllerWasConnected = false;

	#compartments: CompartmentsMessage = EMPTY_COMPARTMENTS_MESSAGE;
	#devices: DevicesMessage = EMTPY_DEVICES_MESSAGE;
	#lockStatus: Record<string, LockStatus> = {};

	constructor(options?: ServerOptions) {
		const {host = "localhost", port = 4000, controllerHost = "localhost", controllerPort = 9000} = options ?? {};

		this.#webServer = createServer();
		const mockWebSocketServer = new WebSocketServer({noServer: true});
		const appWebSocketServer = new WebSocketServer({noServer: true});

		this.#webServer.on("request", serveMockUi);

		this.#webServer.on("upgrade", (request, socket, head) => {
			const {pathname} = new URL(request.url ?? "", "http://localhost:5000");
			const wss = (pathname.startsWith("/mock")) ? mockWebSocketServer : appWebSocketServer;
			wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
		});

		this.#appServer = new VcmpServer({
			heartbeatInterval: 10000,
			webSocketServer: appWebSocketServer,
			debug: new Logger("app-vcmp"),
		});
		this.#appServer.onSessionConnected = (session) => {
			log.info(`App connected.`);
			session.send<CompartmentsMessage>(this.#compartments);
			session.send<DevicesMessage>(this.#devices);

			for (const compartment of this.#compartments.compartments) {
				if (compartment.lock) {
					const lockStatus = this.#lockStatus[compartment.lock];
					if (lockStatus) {
						session.send<LockMessage>({
							"@type": "lock",
							lock: compartment.lock,
							compartmentNumber: compartment.number,
							status: lockStatus,
						});
					}
				}
			}
		};
		this.#appServer.onSessionDisconnected = () => {
			log.info("App disconnected.");
		};

		const resetCompartmentsAndDevices = () => {
			log.info("Sending empty compartments and devices to app.");
			this.#compartments = EMPTY_COMPARTMENTS_MESSAGE;
			this.#appServer.broadcast<CompartmentsMessage>(this.#compartments);

			this.#devices = EMTPY_DEVICES_MESSAGE;
			this.#appServer.broadcast<DevicesMessage>(this.#devices);
		};

		this.#mockServer = new VcmpServer({
			heartbeatInterval: 10000,
			webSocketServer: mockWebSocketServer,
			debug: log.isVerboseEnabled() ? new Logger("mock-vcmp") : undefined,
		});
		this.#mockServer.onSessionConnected = () => {
			log.info(`Mock connected.`);
		};
		this.#mockServer.onSessionDisconnected = () => {
			log.info("Mock disconnected.");
			resetCompartmentsAndDevices();
		};

		this.#controller = new VcmpClient(`ws://${controllerHost}:${controllerPort}/app`, {
			autoStart: true,
			debug: log.isVerboseEnabled() ? new Logger("controller-vcmp") : undefined,
			customWebSocket: WebSocket,
			reconnectTimeout: 3000,
		});
		this.#controller.onOpen = () => {
			log.info("Controller connected.");
			this.#controllerWasConnected = true;
		};
		this.#controller.onClose = () => {
			if (this.#controllerWasConnected) {
				log.warn("Controller disconnected.");
				resetCompartmentsAndDevices();
			}
			else {
				log.verbose("Controller disconnected.");
			}
		};

		this.#appServer.on<OpenLockMessage>("openLock", async (message) => {
			log.info(`Open lock`, message);

			// If the lock is already open, the open command won't result
			// in a lock OPENED event. We simulate the event here, in case
			// the app did not check the status before opening the lock.
			// We send the command to the locker anyway, to still perform
			// the hardware action.
			if (this.#lockStatus[message.lock] == "OPEN") {
				this.#appServer.broadcast<LockMessage>({
					"@type": "lock",
					lock: message.lock,
					status: "OPEN",
					compartmentNumber: this.#compartments.compartments.find(compartment =>
						compartment.lock == message.lock
					)?.number,
				});
			}
			await this.sendToLocker(message);
		});
		this.#appServer.on<RestartOsMessage>("restartOs", async (message) => {
			log.info(`Restart OS`, message);
			await this.sendToLocker(message);
		});
		this.#appServer.on<RestartUiMessage>("restartUi", async (message) => {
			log.info(`Restart UI`, message);
			await this.sendToLocker(message);
		});

		const handleCompartments = (message: CompartmentsMessage) => {
			log.info(`Compartments`, message);
			this.#compartments = message;
			this.#appServer.broadcast(message);
		};
		this.#mockServer.on<CompartmentsMessage>("compartments", handleCompartments);
		this.#controller.on<CompartmentsMessage>("compartments", handleCompartments);

		const handleDevices = (message: DevicesMessage) => {
			log.info("Devices", message);
			this.#devices = message;
			this.#appServer.broadcast(message);
		};
		this.#mockServer.on<DevicesMessage>("devices", handleDevices);
		this.#controller.on<DevicesMessage>("devices", handleDevices);

		const handleLock = (message: LockMessage) => {
			log.info(`Lock`, message);
			this.#lockStatus[message.lock] = message.status;
			this.#appServer.broadcast(message);
		};
		this.#mockServer.on<LockMessage>("lock", handleLock);
		this.#controller.on<LockMessage>("lock", handleLock);

		const handleCode = (message: CodeMessage) => {
			log.info(`Code`, message);
			this.#appServer.broadcast(message);
		};
		this.#mockServer.on<CodeMessage>("code", handleCode);
		this.#controller.on<CodeMessage>("code", handleCode);

		this.#webServer.listen(port, host, () => {
			log.info(`Listening on ${host} port ${port}.`);
			log.info(`Open http://${host}:${port}/ to start the virtual cube.`);
		});
		this.#webServer.on("error", (err) => {
			log.error(`Error starting web server: ${err}`);
			this.stop();
		});
	}

	async sendToLocker<T extends VcmpMessage>(message: T) {
		if (this.#controller.connected) {
			log.debug(`Sending to controller`, message);
			await this.#controller.send<T>(message);
		}
		else if (this.#mockServer.sessions.length > 0) {
			log.debug(`Sending to mock locker`, message);
			this.#mockServer.broadcast<T>(message);
		}
		else {
			log.error("Cannot send message to locker: No locker connected.");
			throw new Error("No locker connected");
		}
	}

	async stop() {
		log.info("Stopping service...");
		log.debug("Stopping app server...");
		await this.#appServer.stop();

		log.debug("Stopping mock server...");
		await this.#mockServer.stop();

		log.debug("Stopping web server...");
		await this.#closeWebserver();
	}

	#closeWebserver() {
		return new Promise<void>((resolve, reject) => {
			this.#webServer.close(err => {
				if (err) {
					reject(err);
				}
				else {
					resolve();
				}
			});
		});
	}
}

const EMPTY_COMPARTMENTS_MESSAGE: CompartmentsMessage = {
	"@type": "compartments",
	compartments: [],
};

const EMTPY_DEVICES_MESSAGE: DevicesMessage = {
	"@type": "devices",
	devices: [],
};
