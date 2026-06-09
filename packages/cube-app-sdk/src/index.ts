export * from "./connect.js";
export * from "./messages";
export * from "./types";

// Re-export the standardized code reader configuration so app developers can consume the
// config types and validation without depending on @variocube/driver-common directly.
// driver-common names these "barcode reader"; the SDK surfaces them as "code reader" because
// the device decodes more than linear barcodes. `CodeReaderConfig` is re-exported from ./types.
export { Symbology, validateBarcodeConfig as validateCodeReaderConfig } from "@variocube/driver-common";
export type {
	IndicatorConfig,
	OutputFormattingConfig,
	OutputTerminator,
	ToneConfig,
	TriggerTimingConfig,
	ValidationResult,
} from "@variocube/driver-common";
