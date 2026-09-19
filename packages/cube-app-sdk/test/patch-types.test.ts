import {expect, it} from "vitest";
import type {OccupancyPatch} from "../src/types.js";

interface Content {
	optional?: { keep: number; remove: number };
	nullable: { keep: number; remove: number } | null;
	union: { left: { a: number; b: number } } | { right: { c: number; d: number } };
	entries: Array<{ id: string; quantity: number }>;
}

it("types recursive optional, nullable and union objects while replacing complete arrays", () => {
	const patch = {
		optional: {remove: null},
		nullable: {remove: null},
		union: {left: {b: null}},
		entries: [{id: "new", quantity: 2}],
	} satisfies OccupancyPatch<Content>;
	const invalid: OccupancyPatch<Content> = {
		// @ts-expect-error Arrays replace whole elements; they are not recursively partial.
		entries: [{quantity: 2}],
	};
	expect(patch.optional.remove).toBeNull();
	expect(invalid.entries).toHaveLength(1);
});
