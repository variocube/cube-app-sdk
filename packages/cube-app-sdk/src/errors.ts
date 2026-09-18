export type CubeErrorCode =
	| "APP_NOT_CONFIGURED"
	| "NOT_FOUND"
	| "NO_BOX_AVAILABLE"
	| "DISCONNECTED"
	| "UNSUPPORTED"
	| "COMMAND_OUTCOME_UNKNOWN"
	| "TIMEOUT"
	| "INVALID_REQUEST"
	| "INVALID_RESPONSE"
	| "INVALID_CONTENT_TYPE"
	| "STALE_RESPONSE"
	| "COMMAND_FAILED"
	| "INTERNAL_ERROR";

/** A controller rejection or a local transport/availability failure. */
export class CubeError extends Error {
	constructor(readonly code: CubeErrorCode | (string & {}), message: string) {
		super(message);
		this.name = "CubeError";
	}
}

export function toCubeError(error: unknown): CubeError {
	if (error instanceof CubeError) return error;
	if (error && typeof error === "object") {
		const detail = error as Record<string, unknown>;
		const properties = detail.properties as Record<string, unknown> | undefined;
		const code = detail.code ?? properties?.code;
		const message = detail.message ?? properties?.message ?? detail.detail ?? detail.title;
		return new CubeError(
			typeof code === "string" ? code : "COMMAND_FAILED",
			typeof message === "string" ? message : "The controller request failed.",
		);
	}
	return new CubeError("COMMAND_FAILED", typeof error === "string" ? error : "The controller request failed.");
}
