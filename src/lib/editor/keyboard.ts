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
  /** F: fill the screen with the preview. */
  toggleFullscreen: () => void;
  playSpan: () => void;
  pauseTrack: () => void;
  hasTrack: () => boolean;
  isPlaying: () => boolean;
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

    // Undo/redo reach the app even while a dropdown or slider holds focus —
    // they have nothing of their own to undo — but never from a text field.
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

    // Bare keys belong to whichever control has focus, if any.
    if (isInteractiveTarget(e.target)) return;

    if (e.key === " ") {
      if (actions.hasTrack()) {
        e.preventDefault();
        if (actions.isPlaying()) actions.pauseTrack();
        else actions.playSpan();
      }
    } else if (e.key === "ArrowRight") {
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
    }
  };
}
