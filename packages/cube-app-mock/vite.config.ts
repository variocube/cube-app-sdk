import {defineConfig} from "vite";

// https://vitejs.dev/config/
export default defineConfig({
	server: {
		proxy: {
			"/mock": {
				target: "ws://localhost:4000",
				ws: true,
			},
		},
	},
});
