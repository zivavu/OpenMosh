import { expect, test } from "bun:test";
import { stackFrames } from "./stack";

function withStack(stack: string): Error {
	const err = new TypeError("x is undefined");
	err.stack = stack;
	return err;
}

test("drops V8's heading line, which repeats the message", () => {
	expect(
		stackFrames(withStack("TypeError: x is undefined\n    at f (a.js:1:2)")),
	).toBe("    at f (a.js:1:2)");
});

test("keeps a Firefox stack, which has no heading", () => {
	expect(stackFrames(withStack("f@a.js:1:2\n"))).toBe("f@a.js:1:2\n");
});

test("has nothing to add when the stack is only the heading", () => {
	expect(stackFrames(withStack("TypeError: x is undefined"))).toBeUndefined();
});
