import { describe, expect, test } from "bun:test";
import { PREVIEW_FRAMES, previewOf } from "./project-preview";

const ids = Array.from({ length: 9 }, (_, i) => `src:${i}`);

describe("previewOf", () => {
	test("a slideshow shows its first slides, in order", () => {
		const preview = previewOf({ mode: "slideshow", sourceIds: ids, state: {} });
		expect(preview.sourceIds).toEqual(ids.slice(0, PREVIEW_FRAMES));
		expect(preview.effects).toEqual([]);
	});

	test("a single edit shows its file and its shown effects", () => {
		const preview = previewOf({
			mode: "single",
			sourceIds: ["src:a"],
			state: {
				effects: [
					{ defId: "pixel-sort", enabled: true },
					{ defId: "pixel-sort", enabled: false },
					{ defId: "no-such-effect", enabled: true },
					null,
				],
			},
		});
		expect(preview.sourceIds).toEqual(["src:a"]);
		expect(preview.effects).toEqual(["Pixel Sort"]);
	});

	test("a single edit with no readable state has no effects", () => {
		for (const state of [null, {}, { effects: "x" }]) {
			expect(
				previewOf({ mode: "single", sourceIds: [], state }).effects,
			).toEqual([]);
		}
	});
});
