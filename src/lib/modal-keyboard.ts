/**
 * Whether an overlay owns the keyboard. Editors bind shortcuts at the window,
 * where listener order decides who runs first, so they ask here instead.
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
