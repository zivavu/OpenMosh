/**
 * Whether a keyboard can be assumed. There is no direct signal for one, so
 * this reads the primary input instead: a coarse pointer that can't hover is
 * a touch screen, and the shortcut surfaces are pointless there. A tablet
 * with a mouse attached reads as fine/hover, and almost always has a
 * keyboard next to it.
 */
export const hasKeyboard =
	!window.matchMedia("(pointer: coarse)").matches &&
	!window.matchMedia("(hover: none)").matches;
