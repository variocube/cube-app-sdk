import {CubeImpl} from "./cube.js";
import type {ControllerSession} from "./session.js";
import type {Cube} from "./types.js";

export interface ConnectOptions {
	/** Returned by bootstrapController() before application/router startup. */
	session: ControllerSession;
	/** Selects secondary locks; never selects the authenticated terminal or installed app. */
	secondary?: boolean;
}

/** Connect directly to controller major 6 using an in-memory authenticated session. */
export function connect(options: ConnectOptions): Cube {
	return new CubeImpl(options);
}
