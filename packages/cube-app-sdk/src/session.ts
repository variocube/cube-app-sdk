import {CubeError} from "./errors.js";
import {credentialSchema} from "./schema.js";

export const PROTOCOL_MAJOR = 6;
const ENVELOPE = "#vc-bootstrap=";
const DEFAULT_ENDPOINT = "http://localhost:9000";
const REQUEST_TIMEOUT = 10000;
let relaunchRequested = false;

export interface BootstrapOptions {
	/** Trusted controller endpoint configured by the app, never read from URL parameters. */
	endpoint?: string;
	/** Browser objects may be injected by native development tooling and tests. */
	location?: Pick<Location, "href">;
	history?: Pick<History, "replaceState" | "state">;
	fetch?: typeof fetch;
}

interface Credential {
	credential: string;
	expiresAt: number;
	generation: number;
}

/**
 * Call before importing the router, analytics or application entry point. Cleans history synchronously,
 * before starting any network request. The single-use grant is never written to browser storage.
 */
export function bootstrapSession(options: BootstrapOptions = {}): Promise<ControllerSession> {
	const location = options.location ?? window.location;
	const history = options.history ?? window.history;
	const url = new URL(location.href);
	if (!url.hash.startsWith(ENVELOPE)) {
		return failBootstrap(options, authenticationRequired());
	}
	const encoded = url.hash.slice(ENVELOPE.length);
	// Remove the credential even when parsing fails. Never include input in errors.
	url.hash = "";
	let grant: string;
	try {
		const envelope: unknown = JSON.parse(decodeURIComponent(encoded));
		if (
			!envelope || typeof envelope !== "object" || !("grant" in envelope) || !("fragment" in envelope)
			|| typeof envelope.grant !== "string" || envelope.grant.length < 16 || envelope.grant.length > 4096
			|| typeof envelope.fragment !== "string"
			|| (envelope.fragment !== "" && !envelope.fragment.startsWith("#"))
		) throw new Error();
		grant = envelope.grant;
		url.hash = envelope.fragment;
	}
	catch {
		history.replaceState(history.state, "", url.href);
		return failBootstrap(options, new CubeError("AUTHENTICATION_REQUIRED", "Invalid kiosk launch envelope."));
	}
	history.replaceState(history.state, "", url.href);
	const endpoint = trustedEndpoint(options.endpoint ?? DEFAULT_ENDPOINT);
	const transport = options.fetch ?? globalThis.fetch.bind(globalThis);
	return requestCredential({endpoint, transport, path: "/app/bootstrap", grant}).then(
		credential => new ControllerSessionImpl(endpoint, transport, credential),
		// The envelope is gone, so neither a rejected grant nor an exchange that may have consumed it can be retried. An
		// invalid response is not asked about: a fresh launch would meet the same mismatch again.
		(error: CubeError) =>
			["AUTHENTICATION_REQUIRED", "DISCONNECTED"].includes(error.code)
				? failBootstrap(options, error)
				: Promise.reject(error),
	);
}

/**
 * Memory-only local API authority, obtained from `bootstrapSession()` and passed to `connect()` or `CubeProvider`.
 * This is separate from the backend app JWT returned by `cube.getToken()`.
 */
export interface ControllerSession {
	/** The trusted controller origin. */
	readonly endpoint: string;
	/** Navigates to the controller's maintenance UI, which returns to the current URL. Ends this session. */
	openMaintenance(): Promise<void>;
	/** Discards the credential and terminates every connection made from this session. */
	close(): void;
}

/** Internal: credential handling stays out of the public session type. */
export class ControllerSessionImpl implements ControllerSession {
	#credential: Credential | undefined;
	#refresh: Promise<string> | undefined;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#closed = false;
	readonly #invalidations = new Set<() => void>();
	readonly generation: number;

	constructor(readonly endpoint: string, private readonly transport: typeof fetch, credential: Credential) {
		this.#credential = validateCredential(credential);
		this.generation = credential.generation;
		this.#scheduleRenewal();
	}

	get webSocketUrl(): string {
		const url = new URL("/app", this.endpoint);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		return url.href;
	}

	async getCredential(): Promise<string> {
		if (this.#closed || !this.#credential) throw authenticationRequired();
		if (this.#credential.expiresAt > Date.now() / 1000 + 30) {
			await Promise.resolve();
			if (this.#closed || !this.#credential) throw authenticationRequired();
			return this.#credential.credential;
		}
		return this.renew();
	}

	renew(): Promise<string> {
		if (this.#refresh) return this.#refresh;
		if (this.#closed || !this.#credential) return Promise.reject(authenticationRequired());
		const current = this.#credential;
		const refresh = requestCredential({
			endpoint: this.endpoint,
			transport: this.transport,
			path: "/app/renew",
			credential: current.credential,
		})
			.then(next => {
				if (this.#closed || next.generation !== this.generation) throw authenticationRequired();
				this.#credential = next;
				this.#scheduleRenewal();
				return next.credential;
			}).catch(() => {
				// No persistent credential or anonymous issuance fallback. The kiosk does not relaunch on expiry.
				this.requestFreshLaunch();
				this.close();
				throw authenticationRequired();
			}).finally(() => {
				if (this.#refresh === refresh) this.#refresh = undefined;
			});
		this.#refresh = refresh;
		return refresh;
	}

	/** Authenticated HTTP requests use a header and suppress referrers; callers cannot override authority. */
	async request(path: string, init: RequestInit = {}): Promise<Response> {
		if (!path.startsWith("/app/") || path.includes("?") || path.includes("#") || path.includes("..")) {
			throw new CubeError("INVALID_REQUEST", "Expected an app API path without query parameters.");
		}
		const credential = await this.getCredential();
		const headers = new Headers(init.headers);
		headers.set("Authorization", `Bearer ${credential}`);
		return this.transport(new URL(path, this.endpoint), {
			...init,
			headers,
			credentials: "omit",
			cache: "no-store",
			referrerPolicy: "no-referrer",
			redirect: "error",
		});
	}

	/** Navigate normally; technician authentication happens in the maintenance UI. */
	async openMaintenance(): Promise<void> {
		if (this.#closed) throw authenticationRequired();
		const target = new URL("/maintenance", this.endpoint);
		const current = new URL(window.location.href);
		if (
			!["http:", "https:"].includes(current.protocol) || current.username || current.password
			|| current.hash.startsWith(ENVELOPE) || current.hash.startsWith("#vc-maintenance=")
		) {
			throw new CubeError("INVALID_REQUEST", "Expected a clean application return URL.");
		}
		target.searchParams.set("returnUrl", current.href);
		window.location.assign(target.href);
		this.close();
	}

	/**
	 * Asks the kiosk for a fresh launch without waiting for it. A closed session never asks: either the app ended it
	 * deliberately, or the renewal failure that closed it has already asked.
	 */
	requestFreshLaunch(): void {
		if (!this.#closed) void requestFreshLaunch(this.endpoint, this.transport);
	}

	onInvalidation(listener: () => void): () => void {
		this.#invalidations.add(listener);
		return () => this.#invalidations.delete(listener);
	}

	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		clearTimeout(this.#timer);
		this.#credential = undefined;
		for (const listener of [...this.#invalidations]) listener();
		this.#invalidations.clear();
	}

	#scheduleRenewal(): void {
		clearTimeout(this.#timer);
		if (!this.#credential) return;
		this.#timer = setTimeout(() => {
			void this.renew().catch(() => {});
		}, Math.max(1000, (this.#credential.expiresAt - Date.now() / 1000 - 30) * 1000));
	}
}

interface CredentialRequest {
	endpoint: string;
	transport: typeof fetch;
	path: string;
	grant?: string;
	credential?: string;
}

async function requestCredential(options: CredentialRequest): Promise<Credential> {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT);
	try {
		const headers: Record<string, string> = {"Content-Type": "application/json"};
		if (options.credential) headers.Authorization = `Bearer ${options.credential}`;
		const response = await options.transport(new URL(options.path, options.endpoint), {
			method: "POST",
			headers,
			body: JSON.stringify(options.grant ? {grant: options.grant} : {}),
			credentials: "omit",
			cache: "no-store",
			referrerPolicy: "no-referrer",
			redirect: "error",
			signal: abort.signal,
		});
		if (!response.ok) throw authenticationRequired();
		return validateCredential(await response.json());
	}
	catch (error) {
		if (error instanceof CubeError) throw error;
		// The controller answered, but not with JSON. An aborted or failed body read is still a transport failure.
		if (error instanceof SyntaxError) {
			throw new CubeError("INVALID_RESPONSE", "Invalid controller API credential response.");
		}
		throw new CubeError("DISCONNECTED", "The controller credential exchange could not complete.");
	}
	finally {
		clearTimeout(timer);
	}
}

function validateCredential(value: unknown): Credential {
	const parsed = credentialSchema.safeParse(value);
	if (
		!parsed.success || parsed.data.expiresAt <= Date.now() / 1000
		|| parsed.data.expiresAt > Date.now() / 1000 + 3600
	) {
		throw new CubeError("INVALID_RESPONSE", "Invalid controller API credential response.");
	}
	return parsed.data;
}

function trustedEndpoint(endpoint: string): string {
	const url = new URL(endpoint);
	if (
		!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
		|| url.pathname !== "/"
		|| (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
	) {
		throw new CubeError("INVALID_REQUEST", "Configure HTTPS or a loopback HTTP controller origin.");
	}
	return url.origin;
}

function authenticationRequired(): CubeError {
	return new CubeError(
		"AUTHENTICATION_REQUIRED",
		"Controller authentication expired; a fresh kiosk launch is required.",
	);
}

/** Rejects with `error` once the page's fresh-launch request has completed or timed out. */
async function failBootstrap(options: BootstrapOptions, error: CubeError): Promise<never> {
	const endpoint = trustedEndpoint(options.endpoint ?? DEFAULT_ENDPOINT);
	await requestFreshLaunch(endpoint, options.fetch ?? globalThis.fetch.bind(globalThis));
	throw error;
}

/**
 * One attempt per page, whichever path concluded that a fresh launch is required: only the configured controller can
 * ask its local kiosk to create the replacement URL. Never rejects.
 */
async function requestFreshLaunch(endpoint: string, transport: typeof fetch): Promise<void> {
	if (relaunchRequested) return;
	relaunchRequested = true;
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT);
	try {
		const response = await transport(new URL("/app/relaunch", endpoint), {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: "{}",
			credentials: "omit",
			cache: "no-store",
			referrerPolicy: "no-referrer",
			redirect: "error",
			signal: abort.signal,
		});
		await response.body?.cancel();
	}
	catch {
		// Deliberately no retry, response contents, token recovery or navigation from untrusted response data.
	}
	finally {
		clearTimeout(timer);
	}
}
