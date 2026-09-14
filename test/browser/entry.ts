import {bootstrapController} from "@sdk/session";

void bootstrapController({endpoint: "http://127.0.0.1:15173"}).then(session => {
	document.getElementById("status")!.textContent = "authenticated";
	window.addEventListener("pagehide", () => session.close(), {once: true});
}).catch(() => {
	document.getElementById("status")!.textContent = "fresh launch required";
});
