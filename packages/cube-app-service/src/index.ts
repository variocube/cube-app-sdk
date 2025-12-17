#!/usr/bin/env node

// Configure `ws` before other imports,
// so vite puts these statements before the loading `ws`.
import "./configureWs";

import {getLogLevel, Logger} from "@variocube/driver-common";
import {config} from "dotenv";
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import {DEFAULT_CONTROLLER_HOST, DEFAULT_CONTROLLER_PORT, DEFAULT_HOST, DEFAULT_PORT} from "./defaults";
import {Server} from "./server";

console.log("Variocube Cube App Service");

config({
	path: "/etc/default/variocube-cube-app-service",
});

//
// Command line interface
//
const argv = await yargs()
	.count("verbose")
	.alias("v", "verbose")
	.middleware(args => Logger.setLogLevel(getLogLevel(args.verbose)))
	.options({
		"host": {
			describe: "The hostname to listen on",
			type: "string",
			alias: "H",
			default: process.env.HOST || DEFAULT_HOST,
		},
		"port": {
			describe: "The port to listen on",
			type: "number",
			alias: "p",
			coerce: (value: string) => parseInt(value, 10),
			default: process.env.PORT || DEFAULT_PORT,
		},
		"controller-host": {
			describe: "The hostname where the controller is running",
			type: "string",
			default: process.env.CONTROLLER_HOST || DEFAULT_CONTROLLER_HOST,
		},
		"controller-port": {
			describe: "The port where the controller is listening",
			type: "number",
			coerce: (value: string) => parseInt(value, 10),
			default: process.env.CONTROLLER_PORT || DEFAULT_CONTROLLER_PORT,
		},
	})
	.help("h")
	.alias("h", "help")
	.parse(hideBin(process.argv));

const server = new Server(argv);

async function stop() {
	try {
		await server.stop();
	}
	catch (error) {
		console.error("Error while stopping", error);
	}
	process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
