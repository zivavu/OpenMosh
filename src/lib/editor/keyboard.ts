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
  playSpan: () => void;
  pauseTrack: () => void;
  hasTrack: () => boolean;
  isPlaying: () => boolean;
}

export function createKeyboardHandler(
  actions: KeyboardActions,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent) => {
    if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      actions.save();
      return;
    }

    const el = e.target as HTMLElement;
    if (
      el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable
    )
      return;

    if (e.key === " ") {
      if (actions.hasTrack()) {
        e.preventDefault();
        if (actions.isPlaying()) actions.pauseTrack();
        else actions.playSpan();
      }
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      actions.mosh();
    } else if (
      (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
      (e.key.toLowerCase() === "y" && (e.ctrlKey || e.metaKey))
    ) {
      e.preventDefault();
      actions.redo();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      actions.undoMosh();
    } else if (
      e.key.toLowerCase() === "z" &&
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey
    ) {
      e.preventDefault();
      actions.undo();
    } else if (
      e.key.toLowerCase() === "v" &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault();
      actions.reInput();
    }
  };
}
