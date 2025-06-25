import {VcmpServer} from "@variocube/vcmp-server";

export class Server {

    private readonly server: VcmpServer;

    constructor() {
        this.server = new VcmpServer({
            port: 5000,
            heartbeatInterval: 10000,
        });
        this.server.onSessionConnected = session => {
            console.log(`Client connected.`);
        };
        this.server.onSessionDisconnected = session => {
            console.log("Client disconnected.");
        }
    }

    stop() {
        return this.server.stop();
    }
}


