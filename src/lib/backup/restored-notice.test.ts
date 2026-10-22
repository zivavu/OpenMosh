import { describe, expect, it } from "bun:test";
import { restoredMessage } from "./restored-notice";

describe("restoredMessage", () => {
	it("lists only what came in", () => {
		expect(restoredMessage({ edits: 2, media: 1, songs: 0, fonts: 3 })).toBe(
			"Backup loaded: 2 projects, 1 media file, 3 fonts",
		);
	});

	it("still says so when the backup held nothing new", () => {
		expect(restoredMessage({ edits: 0, media: 0, songs: 0, fonts: 0 })).toBe(
			"Backup loaded",
		);
	});
});
