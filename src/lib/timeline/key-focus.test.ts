import { beforeEach, describe, expect, test } from "bun:test";

import {
	boxKeys,
	clearKeyBox,
	deleteBoxedKeys,
	holdBoxed,
	keyBox,
} from "./key-focus.svelte";

describe("boxed keys", () => {
	beforeEach(() => clearKeyBox());

	test("the first Delete takes the keys, the next one is the clips'", () => {
		let removed = 0;
		boxKeys("lane", 1, 2);
		holdBoxed(Symbol(), () => removed++);
		holdBoxed(Symbol(), () => removed++);
		const first = new Event("keydown");
		expect(deleteBoxedKeys(first)).toBe(true);
		expect(removed).toBe(2);
		// Another lane kind's handler of the same press leaves its clips alone too.
		expect(deleteBoxedKeys(first)).toBe(true);
		expect(deleteBoxedKeys(new Event("keydown"))).toBe(false);
		expect(removed).toBe(2);
	});

	test("a box with no keys in it leaves Delete to the clips", () => {
		boxKeys("lane", 1, 2);
		expect(deleteBoxedKeys(new Event("keydown"))).toBe(false);
	});

	test("a click after the box hands Delete back", () => {
		let removed = 0;
		boxKeys("lane", 1, 2);
		holdBoxed(Symbol(), () => removed++);
		dispatchEvent(new Event("pointerdown"));
		expect(keyBox.current).toBeNull();
		expect(deleteBoxedKeys(new Event("keydown"))).toBe(false);
		expect(removed).toBe(0);
	});

	test("nothing is held once the box is gone", () => {
		let removed = 0;
		holdBoxed(Symbol(), () => removed++);
		expect(deleteBoxedKeys(new Event("keydown"))).toBe(false);
		expect(removed).toBe(0);
	});
});
