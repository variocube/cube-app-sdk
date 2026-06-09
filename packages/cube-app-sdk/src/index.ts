export * from "./connect.js";
export * from "./messages";
export * from "./types";

// Re-export the standardized barcode reader configuration so app developers can
// consume the config types and validation without depending on @variocube/driver-common directly.
export { Symbology, validateBarcodeConfig } from "@variocube/driver-common";
export type {
	BarcodeReaderConfig,
	IndicatorConfig,
	OutputFormattingConfig,
	OutputTerminator,
	ToneConfig,
	TriggerTimingConfig,
	ValidationResult,
} from "@variocube/driver-common";
