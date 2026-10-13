import { describe, expect, test } from "bun:test";
import { createMediaClip, createMediaLane } from "../media";
import { createTextClip, createTextLane } from "../text/types";
import {
	fanOutMediaClipFields,
	fanOutMediaLaneEdit,
	fanOutTextClipFields,
	fanOutTextLaneEdit,
	withChangedFields,
} from "./field-fanout";

describe("withChangedFields", () => {
	test("copies only what changed", () => {
		const before = { a: 1, b: 2 };
		const target = { a: 5, b: 6 };
		expect(
			withChangedFields(before, { a: 1, b: 3 }, target, ["a", "b"]),
		).toEqual({ a: 5, b: 3 });
	});

	test("returns the target untouched when nothing changed", () => {
		const target = { a: 5 };
		expect(withChangedFields({ a: 1 }, { a: 1 }, target, ["a"])).toBe(target);
	});

	test("drops a field the edit cleared", () => {
		const next = withChangedFields<{ a?: number }>({ a: 1 }, {}, { a: 5 }, [
			"a",
		]);
		expect("a" in next).toBe(false);
	});
});

describe("fanOutMediaLaneEdit", () => {
	test("carries the edited style key and keeps the rest", () => {
		const before = createMediaLane("A");
		const after = { ...before, style: { ...before.style, scale: 2 } };
		const target = createMediaLane("B");
		target.style.x = 0.2;
		const next = fanOutMediaLaneEdit(before, after, target);
		expect(next.style.scale).toBe(2);
		expect(next.style.x).toBe(0.2);
		expect(next.name).toBe("B");
	});

	test("carries a sound switch", () => {
		const before = createMediaLane("A");
		const after = { ...before, audio: { muted: true, drives: false } };
		const target = createMediaLane("B");
		target.audio = { muted: false, drives: true };
		expect(fanOutMediaLaneEdit(before, after, target).audio).toEqual({
			muted: true,
			drives: true,
		});
	});

	test("leaves the target alone when nothing it shares changed", () => {
		const before = createMediaLane("A");
		const target = createMediaLane("B");
		expect(fanOutMediaLaneEdit(before, { ...before, name: "C" }, target)).toBe(
			target,
		);
	});
});

describe("fanOutMediaClipFields", () => {
	test("carries fades and keeps the clip's own source", () => {
		const before = createMediaClip(0, 2, 0, "s1");
		const after = { ...before, fadeInSec: 0.5, sourceStart: 1 };
		const target = createMediaClip(4, 6, 3, "s2");
		const next = fanOutMediaClipFields(before, after, target);
		expect(next.fadeInSec).toBe(0.5);
		expect(next.sourceStart).toBe(3);
		expect(next.sourceId).toBe("s2");
	});

	test("toggling bounce starts the target on a forward pass", () => {
		const before = createMediaClip(0, 2);
		const target = { ...createMediaClip(2, 4), bounceBack: true };
		const next = fanOutMediaClipFields(
			before,
			{ ...before, bounce: true },
			target,
		);
		expect(next.bounce).toBe(true);
		expect(next.bounceBack).toBeUndefined();
	});
});

describe("fanOutTextClipFields", () => {
	test("carries position and keeps the clip's own words", () => {
		const before = createTextClip(0, 2, "one");
		const after = { ...before, text: "uno", x: 0.2 };
		const next = fanOutTextClipFields(
			before,
			after,
			createTextClip(2, 4, "two"),
		);
		expect(next.x).toBe(0.2);
		expect(next.text).toBe("two");
	});
});

describe("fanOutTextLaneEdit", () => {
	test("carries the edited style key and keeps the rest", () => {
		const before = createTextLane("A");
		const after = { ...before, style: { ...before.style, color: "#ff0000" } };
		const target = createTextLane("B");
		target.style.size = 0.3;
		const next = fanOutTextLaneEdit(before, after, target);
		expect(next.style.color).toBe("#ff0000");
		expect(next.style.size).toBe(0.3);
	});
});
