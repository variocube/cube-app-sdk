/** Test devices use the existing VCMP client and acknowledge lifecycle commands without executing them. */
import {VcmpClient, type VcmpMessage} from "@variocube/vcmp";
import {WebSocket} from "ws";

export interface Launch {
	url: string;
	launchId: string;
	expiresAt: number;
}

interface DriverDevice {
	id: string;
	type: string;
}

export class MockDriver {
	readonly client: VcmpClient;
	readonly accepted: VcmpMessage[] = [];
	readonly id: string;

	constructor(endpoint: string, driver: string, private readonly device: DriverDevice) {
		this.id = device.id;
		const url = new URL(`/drivers/${driver}`, endpoint);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		this.client = new VcmpClient(url.href, {customWebSocket: WebSocket});
		this.client.on<VcmpMessage>("device:Restart", message => {
			this.accepted.push(message);
		});
		this.client.on<VcmpMessage>("unit:RestartService", message => {
			this.accepted.push(message);
		});
	}

	async start(): Promise<void> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await new Promise<void>((resolve, reject) => {
				timer = setTimeout(() => reject(new Error("Local test driver registration timed out")), 3000);
				this.client.onOpen = () => {
					void this.client.send({
						"@type": "device:DeviceAdded",
						id: this.id,
						types: [this.device.type],
						info: null,
					})
						.then(() => resolve(), reject);
				};
				this.client.start();
			});
		}
		catch (error) {
			this.stop();
			throw error;
		}
		finally {
			clearTimeout(timer);
		}
	}

	stop(): void {
		this.client.stop();
	}
}

/** Keep this driver connected while using any grant or session issued through it. */
export class MockKiosk extends MockDriver {
	constructor(endpoint: string, private readonly appUrl: string) {
		super(endpoint, "kiosk", {id: "sdk-test-kiosk", type: "Kiosk"});
	}

	launch(): Promise<Launch> {
		return this.client.send({"@type": "kiosk:Launch", id: this.id, url: this.appUrl});
	}
}
