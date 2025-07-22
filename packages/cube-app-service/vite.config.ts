import {node} from "@liuli-util/vite-plugin-node";
import {defineConfig} from "vite";

export default defineConfig({
	plugins: [node()],
	build: {
		rollupOptions: {
			output: {
				entryFileNames: `main.mjs`,
				chunkFileNames: `main.[hash].mjs`,
			},
		},
	},
});
