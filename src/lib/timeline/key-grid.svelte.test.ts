import { afterEach, describe, expect, test } from "bun:test";
import { uiPrefs } from "../ui-prefs.svelte";
import { gridKeyTarget, setKeyGridTempo } from "./key-grid.svelte";

describe("gridKeyTarget", () => {
	afterEach(() => {
		uiPrefs.keyGrid = false;
		setKeyGridTempo(0, 0);
	});

	function beatGrid() {
		uiPrefs.keyGrid = true;
		uiPrefs.keyGridBeats = 1;
		setKeyGridTempo(120, 0);
	}

	test("is the nearest line when the playhead sits between lines", () => {
		beatGrid();
		expect(gridKeyTarget(1.2)).toBeCloseTo(1);
		expect(gridKeyTarget(1.3, 0, 10)).toBeCloseTo(1.5);
	});

	test("is null on a line, with the grid off, or with no playhead", () => {
		beatGrid();
		expect(gridKeyTarget(1.5)).toBeNull();
		expect(gridKeyTarget(null)).toBeNull();
		uiPrefs.keyGrid = false;
		expect(gridKeyTarget(1.2)).toBeNull();
	});

	test("stays inside the span, and is null with the playhead outside it", () => {
		beatGrid();
		expect(gridKeyTarget(1.2, 1.1, 3)).toBeCloseTo(1.5);
		expect(gridKeyTarget(4, 1.1, 3)).toBeNull();
	});
});
