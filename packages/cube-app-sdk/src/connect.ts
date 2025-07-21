import {CubeImpl} from "./cube";
import {Cube} from "./types";

export interface ConnectOptions {
	/** The host where the cube app service runs on. */
	host?: string;

	/** The port where the cube app service listens on. */
	port?: number;

	/** Whether the locks on the secondary side of the locker should be operated. */
	secondary?: boolean;
}

/**
 * Connects to the Variocube locker.
 * @return The cube which can be used to interface with the Variocube locker.
 */
export function connect(options?: ConnectOptions): Cube {
	const search = new URLSearchParams(window.location.search);

	const {
		host = search.get("host") || "localhost",
		port = parseNumber(search.get("port")) ?? 4000,
		secondary = parseBoolean(search.get("secondary")) ?? false,
	} = options ?? {};

	return new CubeImpl({
		host,
		port,
		secondary,
	});
}

function parseNumber(value: string | null) {
	if (!value) {
		return undefined;
	}
	const intValue = parseInt(value, 10);
	if (isNaN(intValue)) {
		return undefined;
	}
	return intValue;
}

function parseBoolean(value: string | null) {
	if (!value) {
		return false;
	}
	const lcValue = value.toLowerCase();
	return lcValue == "true" || lcValue == "1" || lcValue == "yes";
}
