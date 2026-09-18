import {CubeImpl} from "./cube.js";
import {CubeError} from "./errors.js";
import {type ControllerSession, ControllerSessionImpl} from "./session.js";
import type {Cube} from "./types.js";

export interface ConnectOptions {
	/** Returned by bootstrapSession() before application/router startup. */
	session: ControllerSession;
	/** Selects secondary locks; never selects the authenticated terminal or installed app. */
	secondary?: boolean;
}

/** Connect directly to controller major 6 using an in-memory authenticated session. */
export function connect(options: ConnectOptions): Cube {
	const {session, secondary} = options;
	if (!(session instanceof ControllerSessionImpl)) {
		throw new CubeError("INVALID_REQUEST", "Expected the session returned by bootstrapSession().");
	}
	return new CubeImpl({session, secondary});
}
