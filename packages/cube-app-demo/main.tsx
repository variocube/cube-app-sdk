/// <reference types="vite/client" />
import {bootstrapController} from "@variocube/cube-app-sdk";

// Clean the bootstrap fragment before loading React, router or application dependencies.
void bootstrapController({
	endpoint: import.meta.env.VITE_CONTROLLER_SAME_ORIGIN === "true" ? location.origin : undefined,
}).then(async session => {
	const {renderApp} = await import("./app");
	renderApp(session);
}).catch(() => {
	const root = document.getElementById("root");
	if (root) root.textContent = "Waiting for a fresh authenticated kiosk launch.";
});
