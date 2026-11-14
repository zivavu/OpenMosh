import { afterEach, describe, expect, it } from "bun:test";
import {
	dismissToast,
	getToasts,
	runToastAction,
} from "../components/ui/toast.svelte";
import { NO_EDIT } from "./edit-clock";
import { createUndoToast } from "./undo-toast.svelte";
import type { UndoSource } from "./undo-router";

function stack(seq: number) {
	const source = {
		undoSeq: seq,
		redoSeq: NO_EDIT,
		undos: 0,
		undo() {
			source.undos++;
			source.undoSeq = NO_EDIT;
		},
		redo() {},
	};
	return source;
}

const lastToast = () => getToasts()[getToasts().length - 1];

afterEach(() => {
	for (const t of getToasts()) dismissToast(t.id);
});

describe("createUndoToast", () => {
	it("undoes the edit while it is the newest", () => {
		const pool = stack(5);
		const toast = createUndoToast(() => [pool, stack(3)] as UndoSource[]);
		toast.show("Removed", 5);
		runToastAction(lastToast().id);
		expect(pool.undos).toBe(1);
	});

	it("leaves a newer edit alone", () => {
		const pool = stack(5);
		const later = stack(5);
		const toast = createUndoToast(() => [pool, later] as UndoSource[]);
		toast.show("Removed", 5);
		later.undoSeq = 6;
		runToastAction(lastToast().id);
		expect(pool.undos).toBe(0);
		expect(later.undos).toBe(0);
	});

	it("drops the toast once a newer edit lands", () => {
		const pool = stack(5);
		const toast = createUndoToast(() => [pool] as UndoSource[]);
		toast.show("Removed", 5);
		pool.undoSeq = 6;
		toast.sync();
		expect(getToasts()).toHaveLength(0);
	});

	it("shows one toast at a time", () => {
		const pool = stack(5);
		const toast = createUndoToast(() => [pool] as UndoSource[]);
		toast.show("Removed a", 5);
		pool.undoSeq = 6;
		toast.show("Removed b", 6);
		expect(getToasts().map((t) => t.message)).toEqual(["Removed b"]);
	});
});
