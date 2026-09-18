import {VcmpMessage} from "@variocube/vcmp";
import type {
	ChangeOccupancyAccessOptions,
	CodeReaderConfig,
	CompartmentsEvent,
	CubeIdentity,
	DevicesEvent,
	EndOccupancyOptions,
	LockEvent,
	Occupancy,
	OccupancyChangedEvent,
	OccupancyContent,
	OccupancyEndedEvent,
	OccupyCompartmentRequest,
	OccupyOptions,
	StorageChangedEvent,
	UpdateOccupancyOptions,
} from "./types.js";

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

export interface RestartControllerMessage extends VcmpMessage {
	"@type": "restartController";
}

export interface RestartDeviceMessage extends VcmpMessage {
	"@type": "restartDevice";
	deviceId: string;
}

export interface CodeMessage extends VcmpMessage {
	"@type": "code";
	code: string;
	source: "KEYPAD" | "SCANNER" | "NFC";
}

export interface ConfigureCodeReaderMessage extends VcmpMessage {
	"@type": "configureCodeReader";
	config: CodeReaderConfig;
}

export interface CubeMessage extends VcmpMessage, CubeIdentity {
	"@type": "cube";
}

/** Service-to-browser state of the real controller connection. */
export interface AvailabilityMessage extends VcmpMessage {
	"@type": "availability";
	connected: boolean;
	error?: { code: string; message: string };
}

export interface OccupanciesMessage extends VcmpMessage {
	"@type": "occupancies";
	occupancies: Occupancy[];
}

export interface OccupancyCreatedMessage extends VcmpMessage, OccupancyChangedEvent {
	"@type": "occupancyCreated";
}

export interface OccupancyUpdatedMessage extends VcmpMessage, OccupancyChangedEvent {
	"@type": "occupancyUpdated";
}

export interface OccupancyAccessChangedMessage extends VcmpMessage, OccupancyChangedEvent {
	"@type": "occupancyAccessChanged";
}

export interface OccupancyEndedMessage extends VcmpMessage, OccupancyEndedEvent {
	"@type": "occupancyEnded";
}

export interface StorageItemMessage extends VcmpMessage, StorageItem {
	"@type": "storageItem";
}

export interface StorageItemRemovedMessage extends VcmpMessage, StorageChangedEvent {
	"@type": "storageItemRemoved";
}

export interface StorageChunkMessage extends VcmpMessage {
	"@type": "storageChunk";
	key: string;
	index: number;
	total: number;
	content: string;
}

/** The wire envelope of a stored value, as replied to `getStorageItem`. */
export interface StorageItem {
	key: string;
	contentType: string;
	encoding: "json" | "base64";
	content: unknown;
}

/** The controller takes required features as individual flags. */
export interface OccupyTypeMessage extends VcmpMessage, OccupyOptions {
	"@type": "occupyType";
	type: string;
	group?: string;
	accessible?: boolean;
	cooled?: boolean;
	dangerousGoods?: boolean;
	charger?: boolean;
}

export interface OccupyBoxMessage extends VcmpMessage, OccupyCompartmentRequest {
	"@type": "occupyBox";
}

export interface ConfirmOccupancyMessage extends VcmpMessage {
	"@type": "confirmOccupancy";
	uuid: string;
	content?: OccupancyContent;
	merge?: boolean;
}

export interface CancelOccupancyMessage extends VcmpMessage {
	"@type": "cancelOccupancy";
	uuid: string;
}

export interface UpdateOccupancyMessage extends VcmpMessage, UpdateOccupancyOptions {
	"@type": "updateOccupancy";
	uuid: string;
}

export interface ChangeOccupancyAccessMessage extends VcmpMessage, ChangeOccupancyAccessOptions {
	"@type": "changeOccupancyAccess";
	uuid: string;
}

export interface EndOccupancyMessage extends VcmpMessage, EndOccupancyOptions {
	"@type": "endOccupancy";
	uuid: string;
}

export interface UpdateBoxMaintenanceMessage extends VcmpMessage {
	"@type": "updateBoxMaintenance";
	boxNumber: string;
	maintenanceRequired: boolean;
}
