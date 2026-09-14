import {defineConfig} from "@playwright/test";

export default defineConfig({
	testDir: "test/browser",
	use: {
		baseURL: "http://127.0.0.1:15173",
		launchOptions: {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE},
	},
	webServer: {command: "node test/browser/server.mjs", url: "http://127.0.0.1:15173", reuseExistingServer: false},
});
