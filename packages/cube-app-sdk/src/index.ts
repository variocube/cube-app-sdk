export * from "./connect.js";
// `./messages` and `./types` are type-only modules, so these plain `export *` re-export
// no runtime values. We don't write `export type *` here because dprint strips the `type`
// keyword from a star re-export (see the dprint-ignore note in the React SDK's index).
export * from "./messages";
export * from "./types";

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
