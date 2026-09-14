import {describe, expect, it} from "vitest";
import {eventSchemas, occupancySchema} from "./schema";

describe("native controller payloads", () => {
	it("preserves missing occupancy content independently of explicit null", () => {
		const occupancy = {
			uuid: "o", appId: "app", boxNumber: "1", accessCode: null, accessKeys: [],
			created: "2026-09-14T00:00:00Z", actor: null, action: null, state: "pending",
		};
		expect(occupancySchema.parse(occupancy)).not.toHaveProperty("content");
		expect(occupancySchema.parse({...occupancy, content: null})).toHaveProperty("content", null);
	});

	it("accepts the installed power management driver type", () => {
		expect(eventSchemas.devices.parse({generation: 1, revision: 1, devices: [{id: "power", types: ["PowerManagement"]}]}))
			.toMatchObject({devices: [{types: ["PowerManagement"]}]});
	});
});
