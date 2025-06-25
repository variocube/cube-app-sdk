#!/usr/bin/env node

import {config} from "dotenv";
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import {getLogLevel, Logger} from "@variocube/driver-common";
import {Server} from "./server";

console.log('Variocube Cube App Service');

config({
    path: "/etc/default/variocube-cube-app-service"
});

//
// Command line interface
//
const argv = await yargs()
    .count('verbose')
    .alias('v', 'verbose')
    .middleware(args => Logger.setLogLevel(getLogLevel(args.verbose)))
    .options({
        "controller-host": {
            describe: "The hostname where the controller is running",
            type: "string",
            default: process.env.CONTROLLER_HOST || "localhost",
        },
        "controller-port": {
            describe: "The port where the controller is listening",
            type: "number",
            default: process.env.CONTROLLER_PORT || 9000,
        },
        "unit-host": {
            describe: "The hostname where the unit is running.",
            type: "string",
            default: process.env.UNIT_HOST || "localhost",
        },
        "unit-port": {
            describe: "The port where the unit is listening",
            type: "number",
            default: process.env.UNIT_PORT || 2000,
        },
        "mock": {
            describe: "Use the mock mode",
            type: "boolean",
            alias: "m",
            default: process.env.MOCK || false,
        }
    })
    .help("h")
    .alias("h", "help")
    .parse(hideBin(process.argv));

const server = new Server();

process.on("SIGINT", () => server.stop());
process.on("SIGTERM", () => server.stop());
