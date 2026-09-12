import type {
	AvailabilityMessage,
	CapabilitiesMessage,
	CubeMessage,
	OccupanciesMessage,
	Occupancy,
} from "@variocube/cube-app-sdk";
import {VcmpError, type VcmpMessage} from "@variocube/vcmp";

type Feature = "occupancies" | "storage" | "identity";

export const extensionCommands: Record<string, { feature: Feature; mutation: boolean }> = {
	occupyType: {feature: "occupancies", mutation: true},
	occupyBox: {feature: "occupancies", mutation: true},
	confirmOccupancy: {feature: "occupancies", mutation: true},
	cancelOccupancy: {feature: "occupancies", mutation: true},
	updateOccupancy: {feature: "occupancies", mutation: true},
	changeOccupancyAccess: {feature: "occupancies", mutation: true},
	endOccupancy: {feature: "occupancies", mutation: true},
	updateBoxMaintenance: {feature: "occupancies", mutation: true},
	getOccupancies: {feature: "occupancies", mutation: false},
	getOccupancy: {feature: "occupancies", mutation: false},
	getStorageItem: {feature: "storage", mutation: false},
	getStorageKeys: {feature: "storage", mutation: false},
	getToken: {feature: "identity", mutation: false},
};

interface RelayOptions {
	send: (message: VcmpMessage) => Promise<unknown>;
	broadcast: (message: VcmpMessage) => void;
	capabilityTimeout?: number;
	commandTimeout?: number;
}

interface PendingRequest {
	message: VcmpMessage;
	feature?: Feature;
	mutation: boolean;
	sent: boolean;
	resolve: (value: unknown) => void;
	reject: (error: unknown) => void;
	timer?: ReturnType<typeof setTimeout>;
}

/** In-memory state and request ownership for one controller connection/app generation. */
export class ControllerRelay {
	readonly #options: RelayOptions;
	readonly #pending = new Set<PendingRequest>();
	#capabilityTimer?: ReturnType<typeof setTimeout>;
	#connected = false;
	#capabilities?: CapabilitiesMessage;
	#identity?: CubeMessage;
	#snapshot?: OccupanciesMessage;

	constructor(options: RelayOptions) {
		this.#options = options;
	}

	get connected() {
		return this.#connected;
	}

	/** Called synchronously at attachment, before any subsequent controller event can run. */
	get initialMessages(): VcmpMessage[] {
		const availability: AvailabilityMessage = {"@type": "availability", connected: this.#connected};
		const messages: (VcmpMessage | undefined)[] = [
			availability,
			this.#capabilities,
			this.#identity,
			this.#snapshot,
		];
		return messages
			.filter((message): message is VcmpMessage => message !== undefined);
	}

	open() {
		this.#invalidate();
		this.#connected = true;
		this.#options.broadcast({"@type": "availability", connected: true} as AvailabilityMessage);
		this.#capabilityTimer = setTimeout(() => {
			this.capabilities({"@type": "capabilities", occupancies: false, storage: false, identity: false});
		}, this.#options.capabilityTimeout ?? 5000);
	}

	close() {
		this.#connected = false;
		this.#invalidate();
		this.#options.broadcast({"@type": "availability", connected: false} as AvailabilityMessage);
	}

	capabilities(message: CapabilitiesMessage) {
		if (!this.#connected) return;
		clearTimeout(this.#capabilityTimer);
		this.#capabilities = message;
		this.#options.broadcast(message);
		for (const pending of this.#pending) {
			if (!pending.sent) this.#dispatch(pending);
		}
	}

	identity(message: CubeMessage) {
		if (!this.#connected) return;
		if (this.#identity && (this.#identity.cubeId !== message.cubeId || this.#identity.appId !== message.appId)) {
			this.#snapshot = undefined;
			this.#rejectPending("Controller or installed app changed.");
		}
		this.#identity = message;
		this.#options.broadcast(message);
	}

	snapshot(message: OccupanciesMessage) {
		if (!this.#connected || !this.#identity) return;
		if (message.occupancies.some(occupancy => occupancy.appId !== this.#identity?.appId)) return;
		this.#snapshot = message;
		this.#options.broadcast(message);
	}

	occupancyChanged(message: VcmpMessage & { occupancy?: Occupancy; uuid?: string }) {
		if (!this.#connected || !this.#identity?.appId) return;
		// Ignore events for an old app if an upstream queued event crosses an app change.
		if (message.occupancy && message.occupancy.appId !== this.#identity.appId) return;
		if (this.#snapshot) {
			const uuid = message.occupancy?.uuid ?? message.uuid;
			const occupancies = this.#snapshot.occupancies.filter(occupancy => occupancy.uuid !== uuid);
			if (message.occupancy) occupancies.push(message.occupancy);
			this.#snapshot = {"@type": "occupancies", occupancies};
		}
		this.#options.broadcast(message);
	}

	storageChanged(message: VcmpMessage) {
		if (this.#connected && this.#identity?.appId) this.#options.broadcast(message);
	}

	request(message: VcmpMessage, hardware = false): Promise<unknown> {
		if (!this.#connected) return Promise.reject(relayError("DISCONNECTED", "No controller connected."));
		const command = hardware ? {mutation: true} : extensionCommands[message["@type"]];
		if (!command) return Promise.reject(relayError("UNSUPPORTED", "Unsupported controller command."));
		return new Promise((resolve, reject) => {
			const pending: PendingRequest = {message, ...command, sent: false, resolve, reject};
			this.#pending.add(pending);
			this.#dispatch(pending);
		});
	}

	#dispatch(pending: PendingRequest) {
		if (pending.feature) {
			if (!this.#capabilities) return;
			if (!this.#capabilities[pending.feature]) {
				this.#settle(pending, relayError("UNSUPPORTED", `Controller does not support ${pending.feature}.`));
				return;
			}
		}
		pending.sent = true;
		pending.timer = setTimeout(() => {
			this.#settle(
				pending,
				relayError(
					pending.mutation ? "COMMAND_OUTCOME_UNKNOWN" : "TIMEOUT",
					pending.mutation
						? "Controller reply timed out; the command may have committed. Reconcile before continuing."
						: "Controller reply timed out.",
				),
			);
		}, this.#options.commandTimeout ?? 10000);
		// Never replay this send: a missing mutation reply cannot establish whether it committed.
		try {
			this.#options.send(pending.message).then(
				result => this.#settle(pending, undefined, result),
				error => this.#settle(pending, requestError(error, pending.mutation)),
			);
		}
		catch (error) {
			this.#settle(pending, requestError(error, pending.mutation));
		}
	}

	#settle(pending: PendingRequest, error?: unknown, value?: unknown) {
		// Removing the request also discards late replies from a previous generation or timeout.
		if (!this.#pending.delete(pending)) return;
		clearTimeout(pending.timer);
		if (error !== undefined) pending.reject(error);
		else pending.resolve(value);
	}

	#rejectPending(message: string) {
		for (const pending of this.#pending) {
			this.#settle(
				pending,
				relayError(
					pending.sent && pending.mutation ? "COMMAND_OUTCOME_UNKNOWN" : "DISCONNECTED",
					pending.sent && pending.mutation ? `${message} The command may have committed.` : message,
				),
			);
		}
	}

	#invalidate() {
		clearTimeout(this.#capabilityTimer);
		this.#capabilities = undefined;
		this.#identity = undefined;
		this.#snapshot = undefined;
		this.#rejectPending("Controller disconnected.");
	}
}

export function relayError(code: string, message: string) {
	return preserveProblem(
		new VcmpError({
			title: code,
			status: code === "UNSUPPORTED" ? 501 : code === "TIMEOUT" ? 504 : 503,
			detail: message,
			code,
			message,
		}),
	);
}

function preserveProblem(error: unknown) {
	// VCMP serializes thrown problems as JSON. Error.message is otherwise non-enumerable,
	// losing the controller's explicit stable message field on the second transport hop.
	if (error instanceof VcmpError) {
		Object.defineProperty(error, "message", {value: error.message, enumerable: true, configurable: true});
	}
	return error;
}

function requestError(error: unknown, mutation: boolean) {
	if (
		error instanceof VcmpError && [
			"Session closed",
			"Session not open",
			"Send failed",
			"Invalid acknowledgement",
		].includes(error.title)
	) {
		return relayError(
			mutation
				? "COMMAND_OUTCOME_UNKNOWN"
				: error.title === "Invalid acknowledgement"
				? "INVALID_RESPONSE"
				: "DISCONNECTED",
			mutation ? "Controller reply was lost or unreadable; the command may have committed." : error.message,
		);
	}
	return preserveProblem(error);
}
