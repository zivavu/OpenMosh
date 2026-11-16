import { describe, expect, test } from "bun:test";
import { panelEmpty } from "./panel-empty";

describe("panelEmpty", () => {
	test("asks for a clip when nothing is selected", () => {
		expect(panelEmpty({ clips: 0, driving: 0, lanes: 0 })).toEqual({
			title: "Nothing selected",
			hint: expect.stringContaining("media clip or an FX clip"),
		});
	});

	test("offers Drives FX for sound whose lane doesn't drive yet", () => {
		const empty = panelEmpty({ clips: 1, driving: 0, lanes: 1 });
		expect(empty.title).toBe("Audio clip");
		expect(empty.action).toBe("drive");
	});

	test("says the lane already drives, and offers nothing", () => {
		const empty = panelEmpty({ clips: 2, driving: 2, lanes: 2 });
		expect(empty.title).toBe("2 audio clips");
		expect(empty.hint).toContain("Effects react to these sounds");
		expect(empty.action).toBeUndefined();
	});

	test("offers it while any of the lanes doesn't drive", () => {
		expect(panelEmpty({ clips: 2, driving: 1, lanes: 2 }).action).toBe("drive");
	});
});
