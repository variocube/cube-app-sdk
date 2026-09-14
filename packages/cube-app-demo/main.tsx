import {bootstrapController} from "@variocube/cube-app-sdk";

// Clean the bootstrap fragment before loading React, router or application dependencies.
void bootstrapController().then(async session => {
	const {renderApp} = await import("./app");
	renderApp(session);
}).catch(() => {
	const root = document.getElementById("root");
	if (root) root.textContent = "Waiting for a fresh authenticated kiosk launch.";
});
