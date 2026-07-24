/**
 * Which shortcuts the element under a keydown is allowed to swallow.
 *
 * A text field owns every key: bare keys are literal input, and Ctrl+Z/C/V
 * mean undo/copy/paste *of the text*. Other form controls — a dropdown, a
 * slider, a checkbox — only own bare keys: arrows change their value and space
 * opens a dropdown, but Ctrl+Z means nothing to them, so it has to reach the
 * app. Suppressing modifier shortcuts for those too is what made Ctrl+Z do
 * nothing right after picking a value from a dropdown (the control keeps
 * focus), until the user clicked elsewhere.
 */

/** Input types that behave like a text field: caret, typing, native undo. */
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

/** Nearest enclosing form control / editable region, if any. */
function closestControl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest<HTMLElement>(
    'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
  );
}

/** The focused element edits text — leave every shortcut to it. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = closestControl(target);
  if (!el) return false;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  if (el instanceof HTMLSelectElement) return false;
  return true; // textarea, or contenteditable region
}

/**
 * The focused element consumes bare keys (arrows, space, typeahead) itself,
 * so unmodified shortcuts must not also fire.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return closestControl(target) !== null;
}
