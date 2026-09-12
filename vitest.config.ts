import {fileURLToPath} from "node:url";
import {defineConfig} from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@variocube/cube-app-sdk": fileURLToPath(new URL("./packages/cube-app-sdk/src/index.ts", import.meta.url)),
			"@variocube/cube-app-react-sdk": fileURLToPath(
				new URL("./packages/cube-app-react-sdk/src/index.tsx", import.meta.url),
			),
		},
	},
	test: {
		include: ["packages/**/*.test.{ts,tsx}", "test/*.test.ts"],
		exclude: ["test/real-controller.test.ts"],
		clearMocks: true,
		restoreMocks: true,
	},
});
