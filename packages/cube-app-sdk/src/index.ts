export * from "./connect.js";
// `./messages` and `./types` are type-only modules. Use `export type *` so nothing is emitted
// to JS: a plain `export *` is emitted verbatim (with an extensionless specifier that Node's
// ESM loader cannot resolve). `dprint-ignore` because dprint 0.77.0 strips the `type` keyword.
// dprint-ignore
export type * from "./messages.js";
// dprint-ignore
export type * from "./types.js";

// Re-export the standardized code reader configuration so app developers can consume the
// config types and validation without depending on @variocube/driver-common directly.
// driver-common names these "barcode reader"; the SDK surfaces them as "code reader" because
// the device decodes more than linear barcodes. `CodeReaderConfig` is re-exported from ./types.
// Imported from the `barcode-reader/config` subpath, which is dependency-free, so consumers
// never pull driver-common's Node-only `ws`/`chalk` graph into their bundle.
export {
	Symbology,
	validateBarcodeConfig as validateCodeReaderConfig,
} from "@variocube/driver-common/barcode-reader/config";
export type {
	IndicatorConfig,
	OutputFormattingConfig,
	OutputTerminator,
	ToneConfig,
	TriggerTimingConfig,
	ValidationResult,
} from "@variocube/driver-common/barcode-reader/config";
