import {CubeError} from "./errors.js";
import {credentialSchema} from "./schema.js";

export const PROTOCOL_MAJOR = 6;
const ENVELOPE = "#vc-bootstrap=";
const REQUEST_TIMEOUT = 10000;

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
export function bootstrapController(options: BootstrapOptions = {}): Promise<ControllerSession> {
	const location = options.location ?? window.location;
	const history = options.history ?? window.history;
	const url = new URL(location.href);
	if (!url.hash.startsWith(ENVELOPE)) {
		return Promise.reject(new CubeError("AUTHENTICATION_REQUIRED", "A fresh kiosk launch is required."));
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
		return Promise.reject(new CubeError("AUTHENTICATION_REQUIRED", "Invalid kiosk launch envelope."));
	}
	history.replaceState(history.state, "", url.href);
	const endpoint = trustedEndpoint(options.endpoint ?? "http://localhost:9000");
	const transport = options.fetch ?? globalThis.fetch.bind(globalThis);
	return requestCredential({endpoint, transport, path: "/app/bootstrap", grant})
		.then(credential => new ControllerSession(endpoint, transport, credential));
}

/** Memory-only local API authority. This is separate from the backend app JWT returned by cube.getToken(). */
export class ControllerSession {
	#credential: Credential | undefined;
	#refresh: Promise<string> | undefined;
	#maintenance: Promise<void> | undefined;
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
				// No persistent credential or anonymous issuance fallback. Kiosk observes the expired launch.
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

	/** Enter the controller-owned technician UI using the current authenticated kiosk launch. */
	openMaintenance(): Promise<void> {
		if (this.#maintenance) return this.#maintenance;
		const operation = (async () => {
			const abort = new AbortController();
			const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT);
			try {
				const response = await this.request("/app/maintenance", {method: "POST", signal: abort.signal});
				if (!response.ok) throw new CubeError("FORBIDDEN", "The controller refused maintenance navigation.");
				const reader = response.body?.getReader();
				if (!reader) throw new Error();
				const parts: Uint8Array[] = [];
				let length = 0;
				try {
					while (true) {
						const {done, value} = await reader.read();
						if (done) break;
						length += value.length;
						if (length > 4096) throw new Error();
						parts.push(value);
					}
				}
				finally {
					await reader.cancel();
					reader.releaseLock();
				}
				const bytes = new Uint8Array(length);
				let offset = 0;
				for (const part of parts) {
					bytes.set(part, offset);
					offset += part.length;
				}
				const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
				if (!body || typeof body !== "object" || !("url" in body) || typeof body.url !== "string") {
					throw new Error();
				}
				const url = new URL(body.url);
				if (
					url.origin !== new URL(this.endpoint).origin || url.username || url.password || url.search
					|| !["/maintenance", "/maintenance/"].includes(url.pathname)
					|| !/^#vc-maintenance=[A-Za-z0-9_-]{43}$/.test(url.hash)
				) throw new Error();
				if (this.#closed) throw authenticationRequired();
				window.location.assign(url.href);
				this.close();
			}
			catch (error) {
				if (error instanceof CubeError) throw error;
				throw new CubeError("INVALID_RESPONSE", "Maintenance navigation could not be completed.");
			}
			finally {
				clearTimeout(timer);
			}
		})();
		const tracked = operation.finally(() => {
			if (this.#maintenance === tracked) this.#maintenance = undefined;
		});
		this.#maintenance = tracked;
		return tracked;
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
