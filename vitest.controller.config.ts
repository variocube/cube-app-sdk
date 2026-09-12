import {defineConfig} from "vitest/config";
import config from "./vitest.config";

export default defineConfig({
	...config,
	test: {
		...config.test,
		include: ["test/real-controller.test.ts"],
		exclude: [],
		testTimeout: 60000,
		hookTimeout: 60000,
	},
});
