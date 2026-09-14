import {z} from "zod";

const text = z.string().max(65536);
const object = z.record(z.string(), z.unknown());
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const identitySchema = z.object({
	cubeId: text,
	appId: text.min(1),
	token: text.nullable(),
	expiresAt: integer.nullable(),
});
export const occupancySchema = z.object({
	uuid: text,
	appId: text,
	boxNumber: text,
	accessCode: text.nullable(),
	accessKeys: z.array(text).max(4096),
	created: text,
	content: object.nullable(),
	actor: text.nullable(),
	action: text.nullable(),
	state: z.enum(["pending", "confirmed", "ended"]),
});
const compartmentSchema = z.object({
	number: text,
	enabled: z.boolean(),
	types: z.array(text),
	features: z.array(z.enum(["COOLED", "ACCESSIBLE", "CHARGER", "DANGEROUS_GOODS"])),
	lock: text.optional(),
	secondaryLock: text.optional(),
});
const deviceSchema = z.object({
	id: text,
	types: z.array(
		z.enum([
			"NfcReader",
			"PaymentTerminal",
			"Locking",
			"BarcodeReader",
			"Admission",
			"ComputeUnit",
			"Kiosk",
			"Keypad",
			"DoorBell",
		]),
	),
	vendor: text.optional(),
	model: text.optional(),
	serialNumber: text.optional(),
	info: z.unknown().optional(),
});
const boundary = {generation: integer, revision: integer};
export const initialStateSchema = z.object({
	...boundary,
	identity: identitySchema,
	compartments: z.array(compartmentSchema).max(4096),
	devices: z.array(deviceSchema).max(4096),
	occupancies: z.array(occupancySchema).max(65536),
	storageReady: z.boolean(),
});
export const eventSchemas: Record<string, z.ZodType> = {
	initialState: initialStateSchema,
	compartments: z.object({...boundary, compartments: z.array(compartmentSchema).max(4096)}),
	devices: z.object({...boundary, devices: z.array(deviceSchema).max(4096)}),
	cube: z.object({
		...boundary,
		cubeId: text,
		appId: text.nullable(),
		token: text.nullable(),
		expiresAt: integer.nullable(),
	}),
	occupancies: z.object({...boundary, occupancies: z.array(occupancySchema).max(65536)}),
	occupancyCreated: z.object({...boundary, occupancy: occupancySchema}),
	occupancyUpdated: z.object({...boundary, occupancy: occupancySchema}),
	occupancyAccessChanged: z.object({...boundary, occupancy: occupancySchema}),
	occupancyEnded: z.object({...boundary, uuid: text}),
	storageItemChanged: z.object({...boundary, key: text}),
	code: z.object({...boundary, code: text, source: z.enum(["KEYPAD", "SCANNER", "NFC"])}),
	lock: z.object({
		...boundary,
		lock: text,
		status: z.enum(["OPEN", "CLOSED", "BREAKIN", "BLOCKED"]),
		compartmentNumber: text.optional(),
		actor: text.optional(),
		action: text.optional(),
	}),
	availability: z.object({
		...boundary,
		connected: z.boolean(),
		error: z.object({code: text, message: text}).optional(),
	}),
};

export const replySchema = z.object({...boundary, result: z.unknown().optional()});
export const credentialSchema = z.object({
	credential: z.string().min(16).max(4096),
	expiresAt: integer,
	generation: integer,
});
export const storageSchema = z.object({
	key: text,
	contentType: text,
	encoding: z.enum(["json", "base64"]),
	content: z.unknown(),
});
