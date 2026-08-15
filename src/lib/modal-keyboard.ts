/**
 * Whether an overlay currently owns the keyboard.
 *
 * The editors bind their shortcuts at the window, where listener order rather
 * than the DOM decides who runs first — so an overlay calling stopPropagation
 * can't reliably hold them off, and one bound in the capture phase never sees
 * it at all. They ask here instead.
 */
let openCount = 0;

/** Claim the keyboard for an overlay. Returns the release, safe to call twice. */
export function pushModalKeyboard(): () => void {
  openCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openCount--;
  };
}

export function isModalKeyboardOpen(): boolean {
  return openCount > 0;
}
