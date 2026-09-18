import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {bootstrapSession, ControllerSessionImpl as ControllerSession} from "../src/session.js";

const secret = "opaque-bootstrap-grant-123456789";
const credential = "memory-only-credential-123456789";
const sessions: Array<{ close(): void }> = [];
const response = (changes: object = {}) =>
	new Response(
		JSON.stringify({credential, generation: 1, expiresAt: Math.floor(Date.now() / 1000) + 600, ...changes}),
	);

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-09-14T10:00:00Z"));
});
afterEach(() => {
	for (const session of sessions.splice(0)) session.close();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function envelope(original: string): string {
	const url = new URL(original);
	url.hash = "vc-bootstrap=" + encodeURIComponent(JSON.stringify({grant: secret, fragment: url.hash}));
	return url.href;
}

describe("early bootstrap cleanup", () => {
	it.each([
		"https://app.example/",
		"https://app.example/route?x=1&x=%26#/deep?a=%23",
		"https://app.example/#%E2%98%83",
		"https://app.example/#vc-bootstrap=ordinary-router-value",
	])(
		"restores the exact configured query/fragment before any fetch: %s",
		async original => {
			let cleaned = "";
			const transport = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
				expect(cleaned).toBe(original);
				expect(String(url)).toBe("http://localhost:9000/app/bootstrap");
				expect(String(url)).not.toContain(secret);
				expect(init).toMatchObject({
					method: "POST",
					referrerPolicy: "no-referrer",
					cache: "no-store",
					credentials: "omit",
					redirect: "error",
				});
				expect(JSON.parse(String(init?.body))).toEqual({grant: secret});
				return response();
			});
			const state = {router: "retained"};
			const promise = bootstrapSession({
				location: {href: envelope(original)},
				history: {
					state,
					replaceState: (next, _title, url) => {
						expect(next).toBe(state);
						cleaned = String(url);
					},
				},
				fetch: transport,
			});
			expect(cleaned).toBe(original);
			sessions.push(await promise);
		},
	);

	it("cleans malformed envelopes and never reflects or persists the grant", async () => {
		const replaceState = vi.fn();
		const transport = vi.fn<typeof fetch>();
		await expect(
			bootstrapSession({
				location: {href: "https://app.example/#vc-bootstrap=%invalid-secret"},
				history: {state: null, replaceState},
				fetch: transport,
			}),
		)
			.rejects.toMatchObject({code: "AUTHENTICATION_REQUIRED"});
		expect(replaceState).toHaveBeenCalledWith(null, "", "https://app.example/");
		expect(transport).not.toHaveBeenCalled();
	});

	it("consumed links never fall back to a persistent or anonymous credential", async () => {
		const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response("private diagnostics", {status: 401}));
		await expect(
			bootstrapSession({
				location: {href: envelope("https://app.example/")},
				history: {state: null, replaceState: vi.fn()},
				fetch: transport,
			}),
		)
			.rejects.toMatchObject({code: "AUTHENTICATION_REQUIRED"});
		expect(transport).toHaveBeenCalledTimes(1);
	});
});

describe("memory-only renewal", () => {
	it("shares concurrent refreshes and sends local authority only in HTTP headers", async () => {
		const transport = vi.fn<typeof fetch>().mockResolvedValue(response({credential: "renewed-credential-123456"}));
		const session = new ControllerSession("http://localhost:9000", transport, {
			credential,
			expiresAt: Math.floor(Date.now() / 1000) + 600,
			generation: 1,
		});
		sessions.push(session);
		const first = session.renew();
		expect(session.renew()).toBe(first);
		await expect(first).resolves.toBe("renewed-credential-123456");
		expect(transport).toHaveBeenCalledTimes(1);
		expect(transport.mock.calls[0][1]?.headers).toMatchObject({Authorization: `Bearer ${credential}`});
		await session.request("/app/relaunch", {method: "POST", headers: {Authorization: "caller-forged"}});
		expect(new Headers(transport.mock.calls[1][1]?.headers).get("Authorization")).toBe(
			"Bearer renewed-credential-123456",
		);
	});

	it("renews connected clients before expiry without needing another client", async () => {
		const transport = vi.fn<typeof fetch>().mockImplementation(async () => response());
		const session = new ControllerSession("http://localhost:9000", transport, {
			credential,
			expiresAt: Math.floor(Date.now() / 1000) + 600,
			generation: 1,
		});
		sessions.push(session);
		await vi.advanceTimersByTimeAsync(569000);
		expect(transport).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1000);
		expect(transport).toHaveBeenCalledTimes(1);
	});

	it("invalidates active SDK subscriptions after renewal failure or generation replacement", async () => {
		for (const result of [new Response("secret", {status: 403}), response({generation: 2})]) {
			const session = new ControllerSession(
				"http://localhost:9000",
				vi.fn<typeof fetch>().mockResolvedValue(result),
				{credential, expiresAt: Math.floor(Date.now() / 1000) + 600, generation: 1},
			);
			sessions.push(session);
			const invalidated = vi.fn();
			session.onInvalidation(invalidated);
			await expect(session.renew()).rejects.toMatchObject({code: "AUTHENTICATION_REQUIRED"});
			await expect(session.getCredential()).rejects.toMatchObject({code: "AUTHENTICATION_REQUIRED"});
			expect(invalidated).toHaveBeenCalledTimes(1);
		}
	});

	it("does not release an in-memory credential across a concurrent close", async () => {
		const session = new ControllerSession("http://localhost:9000", fetch, {
			credential,
			expiresAt: Math.floor(Date.now() / 1000) + 600,
			generation: 1,
		});
		const pending = session.getCredential();
		session.close();
		await expect(pending).rejects.toMatchObject({code: "AUTHENTICATION_REQUIRED"});
	});
});

describe("ordinary maintenance navigation", () => {
	function make(href = "https://app.example/start?language=en#route") {
		const transport = vi.fn<typeof fetch>();
		const session = new ControllerSession("https://controller.example", transport, {
			credential,
			generation: 1,
			expiresAt: Math.floor(Date.now() / 1000) + 600,
		});
		sessions.push(session);
		const assign = vi.fn();
		vi.stubGlobal("window", {location: {assign, href}});
		return {session, transport, assign};
	}
	it("passes the clean return URL with no maintenance credential or request", async () => {
		const {session, transport, assign} = make();
		await session.openMaintenance();
		const target = new URL(assign.mock.calls[0][0]);
		expect(target.origin + target.pathname).toBe("https://controller.example/maintenance");
		expect(target.searchParams.get("returnUrl")).toBe("https://app.example/start?language=en#route");
		expect(target.hash).toBe("");
		expect(transport).not.toHaveBeenCalled();
		await expect(session.getCredential()).rejects.toMatchObject({code: "AUTHENTICATION_REQUIRED"});
	});
	it.each([
		"file:///app",
		"https://user:password@app.example/",
		"https://app.example/#vc-bootstrap=secret",
		"https://app.example/#vc-maintenance=secret",
	])("rejects unsafe return URL %s", async href => {
		const {session, assign} = make(href);
		await expect(session.openMaintenance()).rejects.toMatchObject({code: "INVALID_REQUEST"});
		expect(assign).not.toHaveBeenCalled();
	});
	it("rejects navigation after session disposal", async () => {
		const {session, assign} = make();
		session.close();
		await expect(session.openMaintenance()).rejects.toMatchObject({code: "AUTHENTICATION_REQUIRED"});
		expect(assign).not.toHaveBeenCalled();
	});
});

describe("missing bootstrap recovery", () => {
	it.each([202, 403, "timeout"] as const)(
		"asks for a kiosk reload once with no returned credential: %s",
		async outcome => {
			vi.resetModules();
			const {bootstrapSession: bootstrap} = await import("../src/session.js");
			const transport = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
				if (outcome === "timeout") {
					return new Promise((_resolve, reject) =>
						init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))
					);
				}
				return new Response(
					JSON.stringify({url: "https://untrusted.example/#secret", credential: "must-not-use"}),
					{status: outcome},
				);
			});
			const replaceState = vi.fn();
			const options = {
				endpoint: "https://controller.example",
				location: {href: "https://app.example/#route"},
				history: {state: null, replaceState},
				fetch: transport,
			};
			const result = expect(bootstrap(options)).rejects.toMatchObject({code: "AUTHENTICATION_REQUIRED"});
			if (outcome === "timeout") await vi.advanceTimersByTimeAsync(10000);
			await result;
			await expect(bootstrap(options)).rejects.toMatchObject({code: "AUTHENTICATION_REQUIRED"});
			expect(transport).toHaveBeenCalledTimes(1);
			expect(String(transport.mock.calls[0][0])).toBe("https://controller.example/app/relaunch");
			expect(transport.mock.calls[0][1]).toMatchObject({
				method: "POST",
				body: "{}",
				credentials: "omit",
				cache: "no-store",
				referrerPolicy: "no-referrer",
				redirect: "error",
			});
			expect(new Headers(transport.mock.calls[0][1]?.headers).has("Authorization")).toBe(false);
			expect(replaceState).not.toHaveBeenCalled();
		},
	);
});
