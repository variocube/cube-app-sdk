/** Test devices use the existing VCMP client and acknowledge lifecycle commands without executing them. */
import {VcmpClient, type VcmpMessage} from "@variocube/vcmp";
import {WebSocket} from "ws";

/** A `kiosk:Launch` reply: the destination without any grant and the ticket the kiosk's browser opens. */
interface LaunchReply {
	url: string;
	launchId: string;
	expiresAt: number;
	ticketUrl: string;
}

/** A launch whose ticket was opened: `url` is where the ticket led, the app URL with its `#vc-bootstrap=` grant. */
export type Launch = LaunchReply;

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
						vendor: "Variocube",
						model: `Test ${this.device.type}`,
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

	/**
	 * Launches the app URL, or a variant of it such as the one a kiosk on the secondary side launches, and opens the
	 * reply's launch ticket as the kiosk's browser does (controller-rs#227). No reply carries a grant: the controller
	 * answers the ticket with `303` to the app URL with a fresh one-use grant, and that URL is the launch's `url` here.
	 * A reply without `ticketUrl` is refused, as the kiosk refuses it: the SDK requires a controller that sends one.
	 */
	async launch(url = this.appUrl): Promise<Launch> {
		const reply: LaunchReply = await this.client.send({"@type": "kiosk:Launch", id: this.id, url});
		if (typeof reply.ticketUrl !== "string") throw new Error("kiosk:Launch reply without ticketUrl");
		if (reply.url.includes("vc-bootstrap")) throw new Error("kiosk:Launch reply carries a grant");
		const ticket = await fetch(reply.ticketUrl, {redirect: "manual", signal: AbortSignal.timeout(5000)});
		const location = ticket.headers.get("location");
		if (ticket.status !== 303 || !location) throw new Error(`launch ticket answered ${ticket.status}`);
		return {...reply, url: location};
	}
}
