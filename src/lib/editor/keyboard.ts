export interface KeyboardActions {
  save: () => void;
  mosh: () => void;
  undo: () => void;
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
      e.key === "ArrowLeft" ||
      (e.key === "z" && (e.ctrlKey || e.metaKey))
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
