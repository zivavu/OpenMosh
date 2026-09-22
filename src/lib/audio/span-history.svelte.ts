/**
 * Undo for the playback span. Its own stack because the span is neither effects nor
 * clips; the undo router picks between it and the rest by when each was last touched.
 * A drag only reports where it landed, so the stack holds the span before the drag.
 */

import { untrack } from "svelte";
import type { UndoSource } from "../editor/undo-router";
import { createSnapshotHistory } from "../timeline/snapshot-history.svelte";

export interface Span {
	start: number;
	end: number;
}

/** Whatever owns a span: the song player, or the editor's transport. */
export interface SpanOwner {
	spanStart: number;
	spanEnd: number;
	readonly trackDuration: number;
	readonly trackFile?: File | null;
}

export function createSpanHistory(audio: SpanOwner) {
	const history = createSnapshotHistory<Span>();
	/** The span as it stood before the drag in progress. */
	let atRest: Span = { start: 0, end: 0 };
	/** Which track the stack was last reset for; see `trackChanged`. */
	let spannedTrack = "";

	function live(): Span {
		return { start: audio.spanStart, end: audio.spanEnd };
	}

	/** Record the span a drag landed on; a no-op drag leaves no step behind. */
	function push() {
		if (atRest.start === audio.spanStart && atRest.end === audio.spanEnd) {
			return;
		}
		history.push(atRest);
		atRest = live();
	}

	function reset() {
		history.reset();
		atRest = live();
	}

	function apply(span: Span | null) {
		if (!span) return;
		// Undo and redo move the span too, so what a later drag replaces is this.
		atRest = { ...span };
		audio.spanStart = span.start;
		audio.spanEnd = span.end;
	}

	/**
	 * A track brings its own span, restored from storage: that is the baseline to undo
	 * back to, not the empty one the editor started on. Call from an effect with the
	 * current track's id; the stack resets once per track.
	 */
	function trackChanged(trackId: string | null) {
		const d = audio.trackDuration;
		if (d <= 0) return;
		const id = `${trackId ?? audio.trackFile?.name ?? ""}:${d}`;
		if (id === spannedTrack) return;
		spannedTrack = id;
		untrack(reset);
	}

	const undoSource: UndoSource = {
		get undoSeq() {
			return history.undoSeq;
		},
		get redoSeq() {
			return history.redoSeq;
		},
		undo: () => apply(history.undo(live())),
		redo: () => apply(history.redo(live())),
	};

	return { push, reset, trackChanged, undoSource };
}
