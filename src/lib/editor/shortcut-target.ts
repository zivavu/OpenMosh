/** Which shortcuts the element under a keydown may swallow. Text fields own every
 * key; other controls own only bare keys, so Ctrl+Z must still reach the app. */

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

function closestControl(target: EventTarget | null): HTMLElement | null {
	if (!(target instanceof HTMLElement)) return null;
	return target.closest<HTMLElement>(
		'input, textarea, select, [contenteditable=""], [contenteditable="true"]',
	);
}

/** The focused element edits text, leave every shortcut to it. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
	const el = closestControl(target);
	if (!el) return false;
	if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
	if (el instanceof HTMLSelectElement) return false;
	return true; // textarea, or contenteditable region
}

/** The focused element consumes bare keys (arrows, space, typeahead) itself, so
 * unmodified shortcuts must not also fire. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
	return closestControl(target) !== null;
}
