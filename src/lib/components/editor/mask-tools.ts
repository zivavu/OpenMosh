import type { ParamHistory } from "../../effects/mask-paint.svelte";
import { isTextEntryTarget } from "../../editor/shortcut-target";
import type { GlRenderer } from "../../gl/renderer";
import type { MediaLane } from "../../media";

/** What the Mask tools on the preview share: where the Mask's chain sits on
 * screen, and an undo stack that stays inside one session. */

/** The chain's frame in preview-area pixels, turned by `rot` about its centre. */
export type MaskBox = {
	left: number;
	top: number;
	w: number;
	h: number;
	rot: number;
};

export function measureMaskBox(
	renderer: GlRenderer,
	canvas: HTMLCanvasElement,
	area: HTMLElement,
	lane: MediaLane | null,
	/** Set for a media clip's chain, which runs over that layer's box. */
	laneId: string | null,
): MaskBox | null {
	if (canvas.width <= 0 || canvas.height <= 0) return null;
	const cr = canvas.getBoundingClientRect();
	const ar = area.getBoundingClientRect();
	const s = Math.min(cr.width / canvas.width, cr.height / canvas.height);
	if (!Number.isFinite(s) || s <= 0) return null;
	const fx = cr.left - ar.left + (cr.width - canvas.width * s) / 2;
	const fy = cr.top - ar.top + (cr.height - canvas.height * s) / 2;
	if (laneId) {
		if (!lane || lane.id !== laneId) return null;
		const rect = renderer.mediaLayerRect(lane.id, lane.style);
		if (!rect) return null;
		// The clip's chain runs over its box grown by the bleed margin.
		const grow = 1 + 2 * Math.max(0, lane.style.bleed ?? 0);
		const w = rect.w * grow;
		const h = rect.h * grow;
		return {
			left: fx + (rect.x - (w - rect.w) / 2) * s,
			top: fy + (rect.y - (h - rect.h) / 2) * s,
			w: w * s,
			h: h * s,
			rot: rect.rot,
		};
	}
	return {
		left: fx,
		top: fy,
		w: canvas.width * s,
		h: canvas.height * s,
		rot: 0,
	};
}

export function sameBox(a: MaskBox | null, b: MaskBox | null): boolean {
	if (!a || !b) return a === b;
	return (
		Math.abs(a.left - b.left) < 0.5 &&
		Math.abs(a.top - b.top) < 0.5 &&
		Math.abs(a.w - b.w) < 0.5 &&
		Math.abs(a.h - b.h) < 0.5 &&
		a.rot === b.rot
	);
}

/** Calls `measure` every frame and hands on what changed; returns a stop. */
export function followBox(
	measure: () => MaskBox | null,
	onChange: (box: MaskBox | null) => void,
): () => void {
	let raf = 0;
	let held: MaskBox | null = null;
	const tick = () => {
		const next = measure();
		if (!sameBox(held, next)) {
			held = next;
			onChange(next);
		}
		raf = requestAnimationFrame(tick);
	};
	tick();
	return () => cancelAnimationFrame(raf);
}

/** A point in preview-area pixels as the box's own uv, y down. */
export function boxUv(
	box: MaskBox,
	x: number,
	y: number,
): { u: number; v: number } {
	const dx = x - (box.left + box.w / 2);
	const dy = y - (box.top + box.h / 2);
	const c = Math.cos(box.rot);
	const s = Math.sin(box.rot);
	return {
		u: (dx * c + dy * s) / box.w + 0.5,
		v: (-dx * s + dy * c) / box.h + 0.5,
	};
}

/** The other way: box uv back to preview-area pixels. */
export function uvPoint(
	box: MaskBox,
	u: number,
	v: number,
): { x: number; y: number } {
	const lx = (u - 0.5) * box.w;
	const ly = (v - 0.5) * box.h;
	const c = Math.cos(box.rot);
	const s = Math.sin(box.rot);
	return {
		x: box.left + box.w / 2 + lx * c - ly * s,
		y: box.top + box.h / 2 + lx * s + ly * c,
	};
}

/** One tool session's edits to a param: undone one at a time and never past where
 * the session began, while the editor's history gets one entry for all of it. */
export function createParamSession(
	start: string,
	commit: (value: string, history: ParamHistory) => void,
) {
	let value = start;
	let undoStack: string[] = [];
	let redoStack: string[] = [];
	let pushed = false;

	function write(next: string) {
		value = next;
		commit(next, pushed ? "none" : "new");
		pushed = true;
	}

	function step(from: string[], to: string[]): string | null {
		const next = from.pop();
		if (next === undefined) return null;
		to.push(value);
		write(next);
		return next;
	}

	return {
		get value() {
			return value;
		},
		/** A new step; `extend` folds it into the step before (a drag's later ticks). */
		save(next: string, extend = false) {
			if (!extend) {
				undoStack.push(value);
				redoStack = [];
			}
			write(next);
		},
		/** The value changed from outside (the card, an undo button). */
		adopt(next: string) {
			value = next;
		},
		undo: () => step(undoStack, redoStack),
		redo: () => step(redoStack, undoStack),
	};
}

/** Takes Escape and Ctrl+Z/Ctrl+Y in the capture phase, ahead of the editor's own
 * shortcuts, which would reach past the session. Returns a stop. */
export function captureToolKeys(on: {
	close: () => void;
	undo: () => void;
	redo: () => void;
}): () => void {
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.stopImmediatePropagation();
			on.close();
			return;
		}
		const key = e.key.toLowerCase();
		if (!(e.ctrlKey || e.metaKey) || (key !== "z" && key !== "y")) return;
		if (isTextEntryTarget(e.target)) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		if (key === "y" || e.shiftKey) on.redo();
		else on.undo();
	};
	window.addEventListener("keydown", onKey, true);
	return () => window.removeEventListener("keydown", onKey, true);
}
