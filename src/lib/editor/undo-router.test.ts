import { describe, expect, test } from "bun:test";
import {
	asOneEdit,
	joinEdit,
	NO_EDIT,
	nextEditSeq,
	sharedEditSeq,
} from "./edit-clock";
import { redoLatest, undoLatest, type UndoSource } from "./undo-router";

/** A stack that stamps like the real ones: an edit takes a fresh tick, and
 * crossing the cursor re-stamps the moved entry. Stands in for the rune-based histories. */
function fakeStack(log: string[], name: string): UndoSource & { edit(): void } {
	const undos: number[] = [];
	const redos: number[] = [];
	return {
		edit() {
			undos.push(nextEditSeq());
			redos.length = 0;
		},
		get undoSeq() {
			return undos.at(-1) ?? NO_EDIT;
		},
		get redoSeq() {
			return redos.at(-1) ?? NO_EDIT;
		},
		undo() {
			undos.pop();
			redos.push(nextEditSeq());
			log.push(`undo ${name}`);
		},
		redo() {
			redos.pop();
			undos.push(nextEditSeq());
			log.push(`redo ${name}`);
		},
	};
}

describe("undo router", () => {
	test("undoes the stack that was edited last, whatever is selected", () => {
		const log: string[] = [];
		const span = fakeStack(log, "span");
		const text = fakeStack(log, "text");

		text.edit();
		span.edit();
		undoLatest([span, text]);
		undoLatest([span, text]);

		expect(log).toEqual(["undo span", "undo text"]);
	});

	test("redo replays in the order the undos happened", () => {
		const log: string[] = [];
		const span = fakeStack(log, "span");
		const text = fakeStack(log, "text");

		text.edit();
		span.edit();
		undoLatest([span, text]); // span
		undoLatest([span, text]); // text
		log.length = 0;

		redoLatest([span, text]);
		redoLatest([span, text]);

		expect(log).toEqual(["redo text", "redo span"]);
	});

	test("a redone edit is the newest one again", () => {
		const log: string[] = [];
		const span = fakeStack(log, "span");
		const text = fakeStack(log, "text");

		span.edit();
		text.edit();
		undoLatest([span, text]); // text
		redoLatest([span, text]); // text, now the newest edit again
		log.length = 0;

		undoLatest([span, text]);

		expect(log).toEqual(["undo text"]);
	});

	test("empty stacks are skipped, and no stack at all is a no-op", () => {
		const log: string[] = [];
		const span = fakeStack(log, "span");
		const text = fakeStack(log, "text");

		expect(undoLatest([span, text, undefined])).toBe(false);

		text.edit();
		expect(undoLatest([span, text, undefined])).toBe(true);
		expect(log).toEqual(["undo text"]);
	});
});

describe("one edit across several stacks", () => {
	test("undoes and redoes as a single step", () => {
		const log: string[] = [];
		const media = fakeStack(log, "media");
		const text = fakeStack(log, "text");
		const fx = fakeStack(log, "fx");
		fx.edit();
		asOneEdit(() => {
			media.edit();
			text.edit();
		});

		undoLatest([media, text, fx]);
		expect(log).toEqual(["undo media", "undo text"]);
		redoLatest([media, text, fx]);
		expect(log.slice(2)).toEqual(["redo media", "redo text"]);
		undoLatest([media, text, fx]);
		undoLatest([media, text, fx]);
		expect(log.slice(-1)).toEqual(["undo fx"]);
	});
});

describe("an edit that reaches more stacks partway", () => {
	test("undoes with the gesture it joined, in one step", () => {
		const log: string[] = [];
		const media = fakeStack(log, "media");
		const text = fakeStack(log, "text");
		let seq: number | null = null;
		asOneEdit(() => {
			media.edit();
			seq = sharedEditSeq();
		});
		// Something else happens in between: the gesture still undoes as one.
		joinEdit(seq!, () => text.edit());

		undoLatest([media, text]);
		expect(log.sort()).toEqual(["undo media", "undo text"]);
	});
});
