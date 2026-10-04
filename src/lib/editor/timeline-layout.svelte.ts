import { readJson, readRaw, writeJson, writeRaw } from "../storage";

/** Which side of the column gets the room is the user's call, and remembered. */
const SPLIT_KEY = "openmosh-timeline-split";
/** Enough for the toolbar, the ruler, the selection bar and a lane or two. */
const SPLIT_MIN = 150;
/** A lane row is 30px, and the split never leaves less than one of them. */
const LANE_MIN_H = 30;
/** What the preview keeps however far the split is dragged. */
const PREVIEW_MIN = 200;

function loadSplit(): number | null {
	const raw = readRaw(SPLIT_KEY);
	const px = raw === null ? Number.NaN : Number(raw);
	return Number.isFinite(px) && px > 0 ? px : null;
}

/** The split between the editor's preview and its timeline stack. Construct during
 * component init: it measures the lane list's scrollbar in an effect. */
export class TimelineSplit {
	/** null is automatic: the stack's own height, under its cap. */
	height = $state<number | null>(loadSplit());
	dragging = $state(false);
	mainAreaEl = $state<HTMLElement | null>(null);
	previewSlotEl = $state<HTMLElement | null>(null);
	/** The lane list, so the width its own scrollbar takes can be measured. */
	laneListEl = $state<HTMLElement | null>(null);
	/** What the lane list's vertical scrollbar costs it; zero where scrollbars overlay. */
	laneScrollbar = $state(0);

	constructor() {
		$effect(() => {
			const el = this.laneListEl;
			if (!el) return;
			const measure = () =>
				(this.laneScrollbar = el.offsetWidth - el.clientWidth);
			measure();
			const observer = new ResizeObserver(measure);
			observer.observe(el);
			return () => observer.disconnect();
		});
	}

	#stack(): HTMLElement | null {
		return this.mainAreaEl?.querySelector<HTMLElement>(".tl-stack") ?? null;
	}

	/** The tallest the timeline may go: its share of the column, leaving the preview something. */
	#ceiling(startSplit: number): number {
		const area = this.mainAreaEl;
		if (!area) return startSplit;
		const cap = area.clientHeight * 0.45;
		const preview = this.previewSlotEl;
		const previewH =
			preview && !preview.classList.contains("hidden")
				? preview.getBoundingClientRect().height
				: 0;
		// With the preview away in grid mode there is no floor to keep.
		const byPreview =
			previewH > 0 ? startSplit + Math.max(0, previewH - PREVIEW_MIN) : cap;
		return Math.max(SPLIT_MIN, Math.min(cap, byPreview));
	}

	/** The shortest the timeline may go: its fixed chrome plus one lane showing. */
	#floor(startSplit: number): number {
		const lanes = this.mainAreaEl?.querySelector<HTMLElement>(".tl-layers");
		const lanesH = lanes?.getBoundingClientRect().height ?? 0;
		return Math.max(SPLIT_MIN, startSplit - lanesH + LANE_MIN_H);
	}

	#commit() {
		writeRaw(SPLIT_KEY, this.height === null ? "" : String(this.height));
	}

	beginDrag = (e: PointerEvent) => {
		if (e.button !== 0) return;
		const stack = this.#stack();
		if (!stack) return;
		e.preventDefault();
		const startY = e.clientY;
		const startSplit = stack.getBoundingClientRect().height;
		const ceiling = this.#ceiling(startSplit);
		const floor = this.#floor(startSplit);
		this.dragging = true;

		const move = (ev: PointerEvent) => {
			const next = startSplit - (ev.clientY - startY);
			this.height = Math.round(Math.min(ceiling, Math.max(floor, next)));
		};
		const up = () => {
			this.dragging = false;
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", up);
			this.#commit();
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", up);
	};

	reset = () => {
		this.height = null;
		this.#commit();
	};

	onKeydown = (e: KeyboardEvent) => {
		const stack = this.#stack();
		if (!stack) return;
		const current = stack.getBoundingClientRect().height;
		const step = e.shiftKey ? 48 : 16;
		const floor = this.#floor(current);
		if (e.key === "ArrowUp") {
			this.height = Math.round(
				Math.min(this.#ceiling(current), Math.max(floor, current + step)),
			);
		} else if (e.key === "ArrowDown") {
			this.height = Math.round(Math.max(floor, current - step));
		} else if (e.key === "Home") {
			e.preventDefault();
			this.reset();
			return;
		} else {
			return;
		}
		e.preventDefault();
		this.#commit();
	};
}

/** Lanes folded to a strip; a view choice like solo, not saved. */
const FOLD_KEY = "openmosh-folded-lanes";
/** Lane ids from every project share the key, so only the latest folds stay. */
const MAX_FOLDED = 500;

export class LaneFolds {
	ids = $state<Set<string>>(new Set(readJson<string[]>(FOLD_KEY, [])));

	#set(next: Set<string>) {
		this.ids = next;
		writeJson(FOLD_KEY, [...next].slice(-MAX_FOLDED));
	}

	allFolded(laneIds: string[]): boolean {
		return laneIds.length > 0 && laneIds.every((id) => this.ids.has(id));
	}

	toggle = (laneId: string) => {
		const next = new Set(this.ids);
		if (next.has(laneId)) next.delete(laneId);
		else next.add(laneId);
		this.#set(next);
	};

	toggleAll(laneIds: string[]) {
		const fold = !this.allFolded(laneIds);
		const next = new Set(this.ids);
		for (const id of laneIds) {
			if (fold) next.add(id);
			else next.delete(id);
		}
		this.#set(next);
	}
}
