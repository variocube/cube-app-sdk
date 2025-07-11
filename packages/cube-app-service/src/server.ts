import {CodeMessage, CompartmentsMessage, LockMessage, OpenLockMessage, RestartMessage} from "@variocube/cube-app-sdk";
import {Logger} from "@variocube/driver-common";
import {VcmpServer} from "@variocube/vcmp-server";
import {createServer} from "http";
import {WebSocketServer} from "ws";
import {serveMockUi} from "./serveMockUi";

const log = new Logger("cube-app-service");

export class Server {
	private readonly appServer: VcmpServer;
	private readonly mockServer: VcmpServer;
	private readonly webServer: ReturnType<typeof createServer>;

	constructor() {
		this.webServer = createServer();
		const mockWebSocketServer = new WebSocketServer({noServer: true});
		const appWebSocketServer = new WebSocketServer({noServer: true});

		this.webServer.on("request", serveMockUi);

		this.webServer.on("upgrade", (request, socket, head) => {
			const {pathname} = new URL(request.url ?? "", "http://localhost:5000");
			const wss = (pathname.startsWith("/mock")) ? mockWebSocketServer : appWebSocketServer;
			wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws, request));
		});

		this.appServer = new VcmpServer({
			port: 5000,
			heartbeatInterval: 10000,
			webSocketServer: appWebSocketServer,
			debug: new Logger("app-vcmp"),
		});
		this.appServer.onSessionConnected = () => {
			log.info(`App connected.`);
		};
		this.appServer.onSessionDisconnected = () => {
			log.info("App disconnected.");
		};

		this.mockServer = new VcmpServer({
			heartbeatInterval: 10000,
			webSocketServer: mockWebSocketServer,
			debug: new Logger("mock-vcmp"),
		});
		this.mockServer.onSessionConnected = session => {
			log.info(`Mock connected.`);
		};
		this.mockServer.onSessionDisconnected = session => {
			log.info("Mock disconnected.");
		};

		this.appServer.on<OpenLockMessage>("openLock", message => {
			// todo: send message to controller or mock
			log.info(`Open lock`, message);
			this.mockServer.broadcast(message);
		});
		this.appServer.on<RestartMessage>("restart", message => {
			log.info(`Restart`, message);
			this.mockServer.broadcast(message);
		});

		this.mockServer.on<CompartmentsMessage>("compartments", message => {
			log.info(`Compartments`, message);
			this.appServer.broadcast(message);
		});

		this.mockServer.on<LockMessage>("lock", message => {
			log.info(`Lock`, message);
			this.appServer.broadcast(message);
		});

		this.mockServer.on<CodeMessage>("code", message => {
			log.info("Code", message);
			this.appServer.broadcast(message);
		});

		this.webServer.listen(5000, () => {
			log.info("Listening on port 5000.");
			log.info("Open http://localhost:5000/ to start the virtual cube.");
		});
	}

	async stop() {
		log.info("Stopping service...");
		log.debug("Stopping app server...");
		await this.appServer.stop();

		log.debug("Stopping mock server...");
		await this.mockServer.stop();

		log.debug("Stopping web server...");
		await this.closeWebserver();
	}

	private closeWebserver() {
		return new Promise<void>((resolve, reject) => {
			this.webServer.close(err => {
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
