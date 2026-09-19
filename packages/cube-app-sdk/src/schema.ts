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
export const idempotencyKeySchema = z.string().refine(value => [...value].length <= 128);
export const contentPatchSchema = object;
export const occupancySchema = z.object({
	idempotencyKey: idempotencyKeySchema.optional(),
	uuid: text,
	appId: text,
	boxNumber: text,
	accessCode: text.nullable(),
	accessKeys: z.array(text).max(4096),
	created: text,
	content: object.nullable().optional(),
	actor: text.nullable(),
	action: text.nullable(),
	state: z.enum(["pending", "confirmed", "ended"]),
});
const COMPARTMENT_FEATURES = ["COOLED", "ACCESSIBLE", "CHARGER", "DANGEROUS_GOODS"] as const;
const DEVICE_TYPES = [
	"NfcReader",
	"PaymentTerminal",
	"Locking",
	"BarcodeReader",
	"Admission",
	"ComputeUnit",
	"Kiosk",
	"Keypad",
	"DoorBell",
	"PowerManagement",
] as const;
export const LOCK_STATUSES = ["OPEN", "CLOSED", "BREAKIN", "BLOCKED"] as const;
export const CODE_SOURCES = ["KEYPAD", "SCANNER", "NFC"] as const;

/**
 * A newer controller may send values this app does not know yet, so unknown entries are dropped
 * instead of failing the event. A closed list would let a controller-only rollout strand every
 * installed app; the compartment or device still arrives, without the capability it cannot name.
 * Scalar enums are validated in the handlers, which drop the single event rather than the message.
 */
function knownValues<T extends readonly string[]>(values: T) {
	return z.array(text).transform(entries =>
		entries.filter(entry => (values as readonly string[]).includes(entry)) as Array<T[number]>
	);
}

const compartmentSchema = z.object({
	number: text,
	enabled: z.boolean(),
	types: z.array(text),
	features: knownValues(COMPARTMENT_FEATURES),
	lock: text.optional(),
	secondaryLock: text.optional(),
});
const deviceSchema = z.object({
	id: text,
	types: knownValues(DEVICE_TYPES),
	vendor: text.optional(),
	model: text.optional(),
	serialNumber: text.optional(),
	info: z.unknown().optional(),
});
export const storageSchema = z.object({
	key: text,
	contentType: text,
	encoding: z.enum(["json", "base64"]),
	content: z.unknown(),
});

const boundary = {generation: integer, revision: integer};
export const initialStateSchema = z.object({
	...boundary,
	identity: identitySchema,
	compartments: z.array(compartmentSchema).max(4096),
	devices: z.array(deviceSchema).max(4096),
	occupancies: z.array(occupancySchema).max(65536),
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
	occupancyEnded: z.object({...boundary, uuid: text, occupancy: occupancySchema.optional()}).refine(event =>
		!event.occupancy || (event.occupancy.uuid === event.uuid && event.occupancy.state === "ended"
			&& event.occupancy.idempotencyKey !== undefined)
	),
	storageItem: storageSchema.extend(boundary),
	storageItemRemoved: z.object({...boundary, key: text}),
	storageChunk: z.object({
		...boundary,
		key: text,
		index: integer.max(21),
		total: integer.min(1).max(22),
		content: z.string().max(65536),
	}),
	ready: z.object(boundary),
	// `source` and `status` stay open here; the handlers drop events carrying a value this app
	// does not know, so an added value costs one event instead of the whole connection.
	code: z.object({...boundary, code: text, source: text}),
	lock: z.object({
		...boundary,
		lock: text,
		status: text,
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
