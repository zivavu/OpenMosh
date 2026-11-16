import { describe, expect, test } from "bun:test";
import { keyState } from "./key-state";

describe("keyState", () => {
	const base = { keyed: true, here: false, grouped: false };

	test("says nothing for a still value", () => {
		expect(keyState({ ...base, keyed: false, here: true })).toBeUndefined();
	});

	test("tells a key at the playhead from the stretch between keys", () => {
		expect(keyState({ ...base, here: true })).toBe("on-key");
		expect(keyState(base)).toBe("animated");
	});

	test("shows a group between its keys, and a key over the group", () => {
		expect(keyState({ ...base, grouped: true })).toBe("grouped");
		expect(keyState({ ...base, grouped: true, here: true })).toBe("on-key");
	});

	test("puts a recording pass over everything", () => {
		expect(keyState({ ...base, here: true, recording: true })).toBe(
			"recording",
		);
	});
});
