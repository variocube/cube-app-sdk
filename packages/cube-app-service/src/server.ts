import {VcmpServer} from "@variocube/vcmp-server";
import {CompartmentsMessage, LockMessage, OpenLockMessage} from "@variocube/cube-app-sdk";
import { createServer } from 'http';
import {WebSocketServer} from "ws";

export class Server {

    private readonly appServer: VcmpServer;
    private readonly mockServer: VcmpServer;
    private readonly webServer: ReturnType<typeof createServer>;

    constructor() {

        this.webServer = createServer();
        const mockWebSocketServer = new WebSocketServer({ noServer: true });
        const appWebSocketServer = new WebSocketServer({ noServer: true });

        this.webServer.on("upgrade", (request, socket, head) => {
            const { pathname } = new URL(request.url ?? "", "ws://localhost:5000");
            const wss = (pathname.startsWith("/mock")) ? mockWebSocketServer : appWebSocketServer;
            wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request));
        });

        this.appServer = new VcmpServer({
            port: 5000,
            heartbeatInterval: 10000,
            webSocketServer: appWebSocketServer
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

        this.mockServer.on<CompartmentsMessage>("compartments", message => {
            console.log(`Compartments`, message);
            this.appServer.broadcast(message);
        });

        this.mockServer.on<LockMessage>("lock", message => {
            console.log(`Lock`, message);
            this.appServer.broadcast(message);
        })

        this.webServer.listen(5000);
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


