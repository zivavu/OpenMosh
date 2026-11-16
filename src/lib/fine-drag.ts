/** Ctrl (Cmd on a Mac) held through a drag: sliders, clips and keys move at a tenth
 * of the pointer's speed. */

export const FINE_DRAG = 0.1;

/** Movement under this many pixels is a click, not a drag. */
export const CLICK_PX = 3;

export function isFine(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
	return e.ctrlKey || e.metaKey;
}

interface PointerLike {
	clientX: number;
	clientY: number;
	ctrlKey: boolean;
	metaKey: boolean;
}

/** Where a drag sees the pointer. Moves made with Ctrl held count for a tenth, and
 * Ctrl can come and go mid-drag without the dragged thing jumping. */
export class FinePointer {
	x: number;
	y: number;
	#lastX: number;
	#lastY: number;

	constructor(e: Pick<PointerLike, "clientX" | "clientY">) {
		this.x = this.#lastX = e.clientX;
		this.y = this.#lastY = e.clientY;
	}

	move(e: PointerLike): this {
		const k = isFine(e) ? FINE_DRAG : 1;
		this.x += (e.clientX - this.#lastX) * k;
		this.y += (e.clientY - this.#lastY) * k;
		this.#lastX = e.clientX;
		this.#lastY = e.clientY;
		return this;
	}
}

/** A slider's value after its thumb moved `dx` pixels along a `width`-pixel track. */
export function rangeValueAfter(
	start: number,
	dx: number,
	width: number,
	min: number,
	max: number,
): number {
	if (!(width > 0)) return start;
	return Math.min(max, Math.max(min, start + (dx / width) * (max - min)));
}

/** No modifier held, for a press that picks as a plain click would. */
export const PLAIN = { shiftKey: false, ctrlKey: false, metaKey: false };
