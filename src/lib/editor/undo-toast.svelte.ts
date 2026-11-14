/** A toast whose Undo takes back one edit, offered only while that edit is the
 * newest: past it, an Undo would take later edits back with it. */

import {
	dismissToast,
	getToasts,
	showToast,
	UNDO_TOAST_MS,
} from "../components/ui/toast.svelte";
import { NO_EDIT } from "./edit-clock";
import { latestUndoSeq, undoLatest, type UndoSource } from "./undo-router";

export function createUndoToast(sources: () => UndoSource[]) {
	let shown = $state<{ id: number; seq: number } | null>(null);
	const isNewest = (seq: number) => latestUndoSeq(sources()) === seq;

	return {
		/** Offer to undo `seq`, the edit that just landed. */
		show(message: string, seq: number) {
			if (seq === NO_EDIT) return;
			if (shown) dismissToast(shown.id);
			const id = showToast(message, "info", UNDO_TOAST_MS, {
				label: "Undo",
				run: () => {
					shown = null;
					if (isNewest(seq)) undoLatest(sources());
				},
			});
			shown = { id, seq };
		},

		/** Run in an $effect: drops the toast once a newer edit or an undo lands. */
		sync() {
			if (!shown) return;
			const { id, seq } = shown;
			if (!getToasts().some((t) => t.id === id)) shown = null;
			else if (!isNewest(seq)) {
				dismissToast(id);
				shown = null;
			}
		},
	};
}
