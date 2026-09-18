/** Legacy Java-controller wire retained only by the retired Node service. */
export interface CapabilitiesMessage {
	"@type": "capabilities";
	occupancies: boolean;
	storage: boolean;
	identity: boolean;
}
