import {VcmpMessage} from "@variocube/vcmp";
import {CompartmentsEvent, DevicesEvent, LockEvent} from "./types";

export interface OpenLockMessage extends VcmpMessage {
	"@type": "openLock";
	lock: string;
	actor?: string;
	action?: string;
}

export interface LockMessage extends VcmpMessage, LockEvent {
	"@type": "lock";
}

export interface CompartmentsMessage extends VcmpMessage, CompartmentsEvent {
	"@type": "compartments";
}

export interface DevicesMessage extends VcmpMessage, DevicesEvent {
	"@type": "devices";
}

export interface RestartOsMessage extends VcmpMessage {
	"@type": "restartOs";
}

export interface RestartUiMessage extends VcmpMessage {
	"@type": "restartUi";
}

export interface CodeMessage extends VcmpMessage {
	"@type": "code";
	code: string;
	source: "KEYPAD" | "SCANNER" | "NFC";
}
