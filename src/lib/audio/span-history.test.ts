import { describe, expect, it } from "bun:test";
import { undoLatest } from "../editor/undo-router";
import { createSpanHistory } from "./span-history.svelte";

describe("pushMoved", () => {
	it("lets undo put back a span something else moved", () => {
		const owner = { spanStart: 0, spanEnd: 6, trackDuration: 10 };
		const history = createSpanHistory(owner);
		history.reset();
		owner.spanEnd = 4;
		history.pushMoved({ start: 0, end: 6 });
		expect(undoLatest([history.undoSource])).toBe(true);
		expect([owner.spanStart, owner.spanEnd]).toEqual([0, 6]);
	});

	it("leaves no step when nothing moved", () => {
		const owner = { spanStart: 0, spanEnd: 6, trackDuration: 10 };
		const history = createSpanHistory(owner);
		history.pushMoved({ start: 0, end: 6 });
		expect(undoLatest([history.undoSource])).toBe(false);
	});
});
