import {describe, expect, it} from "vitest";
import {eventSchemas, occupancySchema} from "./schema";

describe("native controller payloads", () => {
	it("preserves missing occupancy content independently of explicit null", () => {
		const occupancy = {
			uuid: "o",
			appId: "app",
			boxNumber: "1",
			accessCode: null,
			accessKeys: [],
			created: "2026-09-14T00:00:00Z",
			actor: null,
			action: null,
			state: "pending",
		};
		expect(occupancySchema.parse(occupancy)).not.toHaveProperty("content");
		expect(occupancySchema.parse({...occupancy, content: null})).toHaveProperty("content", null);
	});

	it("accepts the installed power management driver type", () => {
		expect(
			eventSchemas.devices.parse({
				generation: 1,
				revision: 1,
				devices: [{id: "power", types: ["PowerManagement"]}],
			}),
		)
			.toMatchObject({devices: [{types: ["PowerManagement"]}]});
	});

	it("reads the close-after-open time and treats null, an absent key and unusable values as off", () => {
		const snapshot = {
			generation: 1,
			revision: 0,
			identity: {cubeId: "cube-1", appId: "app", token: null, expiresAt: null},
			compartments: [],
			devices: [],
			occupancies: [],
		};
		const read = (extra: object) =>
			eventSchemas.initialState.parse({...snapshot, ...extra}) as { preventCloseAfterOpenSeconds?: number };
		expect(read({preventCloseAfterOpenSeconds: 30}).preventCloseAfterOpenSeconds).toBe(30);
		expect(read({preventCloseAfterOpenSeconds: 300}).preventCloseAfterOpenSeconds).toBe(300);
		expect(read({}).preventCloseAfterOpenSeconds).toBeUndefined();
		for (const value of [null, 0, -1, 12.5, "60", [60], Number.NaN]) {
			expect(read({preventCloseAfterOpenSeconds: value}).preventCloseAfterOpenSeconds).toBeUndefined();
		}
	});
});
