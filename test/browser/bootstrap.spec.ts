import {expect, test} from "@playwright/test";

const origin = "http://127.0.0.1:15173";
for (const route of ["/?x=1&x=%26#/deep?a=%23", "/?q=%E2%98%83#fragment", "/#vc-bootstrap=router-data"]) {
	test(`Chromium cleans query/hash route before exchanging the one-use launch: ${route}`, async ({page}) => {
		const original = new URL(route, origin);
		const grant = "one-use-browser-grant-123456789";
		const launch = new URL(original);
		launch.hash = "vc-bootstrap=" + encodeURIComponent(JSON.stringify({grant, fragment: original.hash}));
		let exchanges = 0;
		await page.route("**/app/bootstrap", async request => {
			exchanges++;
			expect(page.url()).toBe(original.href);
			expect(request.request().url()).not.toContain(grant);
			expect(request.request().headers().referer).toBeUndefined();
			expect(request.request().postDataJSON()).toEqual({grant});
			await request.fulfill({
				json: {
					credential: "opaque-memory-credential-123456789",
					expiresAt: Math.floor(Date.now() / 1000) + 600,
					generation: 1,
				},
			});
		});
		await page.goto(launch.href);
		await expect(page.locator("#status")).toHaveText("authenticated");
		expect(page.url()).toBe(original.href);
		expect(await page.evaluate(() => ({local: localStorage.length, session: sessionStorage.length}))).toEqual({
			local: 0,
			session: 0,
		});
		await page.reload();
		await expect(page.locator("#status")).toHaveText("fresh launch required");
		expect(exchanges).toBe(1);
	});
}
