/**
 * No direct signal for a keyboard, so this reads the primary input: a coarse
 * pointer that can't hover is a touch screen, where shortcuts are pointless.
 */
export const hasKeyboard =
	!window.matchMedia("(pointer: coarse)").matches &&
	!window.matchMedia("(hover: none)").matches;
