import {fileURLToPath} from "node:url";
import {createServer} from "vite";

const server = await createServer({
	root: fileURLToPath(new URL("./", import.meta.url)),
	resolve: {
		alias: {"@sdk/session": fileURLToPath(new URL("../../packages/cube-app-sdk/src/session.ts", import.meta.url))},
	},
	server: {host: "127.0.0.1", port: 15173, strictPort: true},
});
await server.listen();
