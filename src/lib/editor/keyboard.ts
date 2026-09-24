import { isModalKeyboardOpen } from "../modal-keyboard";
import { isInteractiveTarget, isTextEntryTarget } from "./shortcut-target";

export interface KeyboardActions {
	save: () => void;
	/** → : step forward through the mosh history, or roll a new mosh at its top. */
	mosh: () => void;
	/** ← : step back through the mosh history. */
	undoMosh: () => void;
	/** Ctrl/Cmd+Z: undo an edit (effects panel / timeline), never a mosh. */
	undo: () => void;
	redo: () => void;
	reInput: () => void;
	toggleFullscreen: () => void;
	toggleFollowPlayhead: () => void;
	/** Space: the master transport (a track, a video, or a still's own clock). */
	togglePlay: () => void;
	/** R: repeat the selected clips in the preview, or stop. */
	toggleRepeat: () => void;
	/** S: cut the clip under the playhead on the lane last touched. */
	splitAtPlayhead: () => void;
	zoomTimeline: (inward: boolean) => void;
}

export function createKeyboardHandler(
	actions: KeyboardActions,
): (e: KeyboardEvent) => void {
	return (e: KeyboardEvent) => {
		// An overlay (the media lightbox) has the keyboard.
		if (isModalKeyboardOpen()) return;

		if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			actions.save();
			return;
		}

		const key = e.key.toLowerCase();
		const mod = e.ctrlKey || e.metaKey;

		// Undo/redo reach the app even while a dropdown or slider holds focus, but not a text field.
		if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
			actions.redo();
			return;
		}
		if (mod && key === "z") {
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
			actions.undo();
			return;
		}

		// Space is the transport whatever holds focus: a focused dropdown would otherwise
		// swallow it and reopen its menu. A text field is the exception (space types a space).
		if (e.key === " ") {
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
			actions.togglePlay();
			return;
		}

		// Bare keys belong to whichever control has focus, if any.
		if (isInteractiveTarget(e.target)) return;

		if (e.key === "ArrowRight") {
			e.preventDefault();
			actions.mosh();
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			actions.undoMosh();
		} else if (key === "v" && !mod && !e.altKey) {
			e.preventDefault();
			actions.reInput();
		} else if (key === "f" && !mod && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			actions.toggleFullscreen();
		} else if (key === "c" && !mod && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			actions.toggleFollowPlayhead();
		} else if (key === "r" && !mod && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			actions.toggleRepeat();
		} else if (key === "s" && !mod && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			actions.splitAtPlayhead();
		} else if (!mod && (e.key === "+" || e.key === "=")) {
			// "=" as well as "+": "+" needs Shift on most layouts, and other apps zoom on the unshifted key.
			e.preventDefault();
			actions.zoomTimeline(true);
		} else if (!mod && (e.key === "-" || e.key === "_")) {
			e.preventDefault();
			actions.zoomTimeline(false);
		}
	};
}
