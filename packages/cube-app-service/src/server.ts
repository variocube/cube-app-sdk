import {VcmpServer} from "@variocube/vcmp-server";
import {CodeMessage, CompartmentsMessage, LockMessage, OpenLockMessage, RestartMessage} from "@variocube/cube-app-sdk";
import {createServer} from 'http';
import {WebSocketServer} from "ws";
import {serveMockUi} from "./serveMockUi";
import {Logger} from "@variocube/driver-common";

export class Server {

    private readonly appServer: VcmpServer;
    private readonly mockServer: VcmpServer;
    private readonly webServer: ReturnType<typeof createServer>;

    constructor() {

        this.webServer = createServer();
        const mockWebSocketServer = new WebSocketServer({ noServer: true });
        const appWebSocketServer = new WebSocketServer({ noServer: true });

        this.webServer.on("request", serveMockUi);

        this.webServer.on("upgrade", (request, socket, head) => {
            const { pathname } = new URL(request.url ?? "", "http://localhost:5000");
            const wss = (pathname.startsWith("/mock")) ? mockWebSocketServer : appWebSocketServer;
            wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
        });

        this.appServer = new VcmpServer({
            port: 5000,
            heartbeatInterval: 10000,
            webSocketServer: appWebSocketServer,
			debug: new Logger("vcmp")
        });
        this.appServer.onSessionConnected = () => {
            console.log(`App connected.`);
        };
        this.appServer.onSessionDisconnected = () => {
            console.log("App disconnected.");
        }

        this.mockServer = new VcmpServer({
            heartbeatInterval: 10000,
            webSocketServer: mockWebSocketServer
        });
        this.mockServer.onSessionConnected = session => {
            console.log(`Mock connected.`);
        };
        this.mockServer.onSessionDisconnected = session => {
            console.log("Mock disconnected.");
        }

        this.appServer.on<OpenLockMessage>("openLock", message => {
            // todo: send message to controller or mock
            console.log(`Open lock`, message);
            this.mockServer.broadcast(message);
        });
        this.appServer.on<RestartMessage>("restart", message => {
			console.log(`Restart`, message);
            this.mockServer.broadcast(message);
        });

        this.mockServer.on<CompartmentsMessage>("compartments", message => {
            console.log(`Compartments`, message);
            this.appServer.broadcast(message);
        });

        this.mockServer.on<LockMessage>("lock", message => {
            console.log(`Lock`, message);
            this.appServer.broadcast(message);
        });

        this.mockServer.on<CodeMessage>("code", message => {
            console.log("Code", message);
            this.appServer.broadcast(message);
        });

        this.webServer.listen(5000, () => {
            console.log("Listening on port 5000.");
            console.log("Open http://localhost:5000/ to start the virtual cube.");
        });
    }

    async stop() {
        await this.appServer.stop();
        await this.mockServer.stop();
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


