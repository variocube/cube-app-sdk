import {VcmpMessage} from "@variocube/vcmp";
import type {
	ChangeOccupancyAccessOptions,
	CodeReaderConfig,
	Compartment,
	CompartmentsEvent,
	Device,
	DevicesEvent,
	EndOccupancyOptions,
	LockEvent,
	Occupancy,
	OccupancyChangedEvent,
	OccupancyContent,
	OccupancyEndedEvent,
	OccupancyPatch,
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

/** Every controller publication and reply carries the app generation and the session's contiguous revision. */
export interface WireBoundary {
	generation: number;
	revision: number;
}

/** The first request on `/app`; its reply is `{protocolMajor, generation}`. */
export interface AuthenticateMessage extends VcmpMessage {
	"@type": "authenticate";
	protocolMajor: number;
	credential: string;
}

/** The authoritative snapshot after authentication; storage items and the `ready` barrier follow. */
export interface InitialStateMessage extends VcmpMessage, WireBoundary {
	"@type": "initialState";
	identity: CubeMessageIdentity;
	compartments: Compartment[];
	devices: Device[];
	occupancies: Occupancy[];
}

/** Commits the initial snapshot including the complete storage. */
export interface ReadyMessage extends VcmpMessage, WireBoundary {
	"@type": "ready";
}

/** Identity as published on the wire, including the backend token. `expiresAt` is Unix epoch seconds. */
export interface CubeMessageIdentity {
	cubeId: string;
	appId: string | null;
	token: string | null;
	expiresAt: number | null;
}

/** Pushes the current identity and rotated backend tokens. */
export interface CubeMessage extends VcmpMessage, CubeMessageIdentity {
	"@type": "cube";
}

/** Legacy (SDK 1 service): service-to-browser state of the real controller connection. */
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

/** The wire envelope of a stored value. */
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

/** Distinct from updateOccupancy, so an older peer cannot interpret a patch as replacement. */
export interface PatchOccupancyMessage extends VcmpMessage {
	"@type": "patchOccupancy";
	uuid: string;
	content: OccupancyPatch;
	actor?: string;
	action?: string;
}
