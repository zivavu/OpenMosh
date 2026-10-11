import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { undoLatest } from "../editor/undo-router";
import {
	createSnapshotHistory,
	snapshotUndoSource,
} from "./snapshot-history.svelte";

afterEach(() => setSystemTime());

describe("createSnapshotHistory", () => {
	it("hands back the state from before each change", () => {
		const history = createSnapshotHistory<number>();
		let doc = 1;
		history.push(doc);
		doc = 2;
		history.push(doc);
		doc = 3;
		expect((doc = history.undo(doc)!)).toBe(2);
		expect((doc = history.undo(doc)!)).toBe(1);
		expect(history.undo(doc)).toBeNull();
		expect((doc = history.redo(doc)!)).toBe(2);
		expect((doc = history.redo(doc)!)).toBe(3);
		expect(history.redo(doc)).toBeNull();
	});

	it("drops what was undone once a new edit lands", () => {
		const history = createSnapshotHistory<string>();
		history.push("a");
		const back = history.undo("b")!;
		expect(history.canRedo).toBe(true);
		history.push(back);
		expect(history.canRedo).toBe(false);
	});

	it("merges one gesture's ticks into a single step", () => {
		setSystemTime(new Date(1_000));
		const history = createSnapshotHistory<number>();
		history.push(0, "drag");
		setSystemTime(new Date(1_300));
		history.push(1, "drag");
		setSystemTime(new Date(1_600));
		history.push(2, "drag");
		expect(history.undo(3)).toBe(0);
		expect(history.canUndo).toBe(false);
	});

	it("starts a new step once the gesture pauses", () => {
		setSystemTime(new Date(1_000));
		const history = createSnapshotHistory<number>();
		history.push(0, "drag");
		setSystemTime(new Date(2_000));
		history.push(1, "drag");
		expect(history.undo(2)).toBe(1);
		expect(history.undo(1)).toBe(0);
	});

	it("keeps a copy, so later edits to the live state don't reach it", () => {
		const history = createSnapshotHistory<{ n: number }>();
		const live = { n: 1 };
		history.push(live);
		live.n = 2;
		expect(history.undo(live)).toEqual({ n: 1 });
	});

	it("keeps only the newest steps", () => {
		const history = createSnapshotHistory<number>();
		for (let i = 0; i < 100; i++) history.push(i);
		let doc = 100;
		let steps = 0;
		for (
			let prev = history.undo(doc);
			prev !== null;
			prev = history.undo(doc)
		) {
			doc = prev;
			steps++;
		}
		expect(steps).toBe(60);
		expect(doc).toBe(40);
	});
});

describe("undoing across stacks", () => {
	it("takes back the newest edit, whichever stack holds it", () => {
		const a = createSnapshotHistory<string>();
		const b = createSnapshotHistory<string>();
		let docA = "a0";
		let docB = "b0";
		const sources = [
			snapshotUndoSource(
				a,
				() => docA,
				(v) => (docA = v),
			),
			snapshotUndoSource(
				b,
				() => docB,
				(v) => (docB = v),
			),
		];
		a.push(docA);
		docA = "a1";
		b.push(docB);
		docB = "b1";
		undoLatest(sources);
		expect([docA, docB]).toEqual(["a1", "b0"]);
		undoLatest(sources);
		expect([docA, docB]).toEqual(["a0", "b0"]);
	});
});
