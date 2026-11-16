/** Ctrl-dragging any slider in the app moves it at a tenth of the pointer's speed,
 * from where it was rather than from where it was clicked. */

import { FinePointer, isFine, rangeValueAfter } from "./fine-drag";

let active: HTMLInputElement | null = null;

function isRange(el: EventTarget | null): el is HTMLInputElement {
	return el instanceof HTMLInputElement && el.type === "range";
}

function onPointerDown(e: PointerEvent) {
	if (e.button !== 0 || e.pointerType === "touch" || !isFine(e)) return;
	const input = e.target;
	if (!isRange(input) || input.disabled) return;
	// The browser's own thumb drag would jump to the pointer.
	e.preventDefault();
	input.focus({ preventScroll: true });
	const min = Number(input.min || 0);
	const max = Number(input.max || 100);
	const start = input.valueAsNumber;
	const width = input.getBoundingClientRect().width;
	const pointer = new FinePointer(e);
	const x0 = pointer.x;
	active = input;
	input.setPointerCapture(e.pointerId);

	const move = (ev: PointerEvent) => {
		pointer.move(ev);
		const before = input.value;
		// The input snaps it to its step.
		input.value = String(
			rangeValueAfter(start, pointer.x - x0, width, min, max),
		);
		if (input.value !== before)
			input.dispatchEvent(new Event("input", { bubbles: true }));
	};
	const up = () => {
		input.removeEventListener("pointermove", move);
		input.removeEventListener("pointerup", up);
		input.removeEventListener("pointercancel", up);
		active = null;
		input.dispatchEvent(new Event("change", { bubbles: true }));
	};
	input.addEventListener("pointermove", move);
	input.addEventListener("pointerup", up);
	input.addEventListener("pointercancel", up);
}

if (typeof window !== "undefined") {
	window.addEventListener("pointerdown", onPointerDown, { capture: true });
	// Ctrl-click is a right-click on a Mac; the slider keeps the press.
	const swallow = (e: Event) => {
		if (active && isRange(e.target)) e.preventDefault();
	};
	window.addEventListener("mousedown", swallow, { capture: true });
	window.addEventListener("contextmenu", swallow, { capture: true });
}
