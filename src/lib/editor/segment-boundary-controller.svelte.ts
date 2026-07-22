/**
 * Shared undo/redo + boundary selection/clipboard logic for timeline
 * components that edit a flat, gapless list of time-span segments
 * (TimelineSegments.svelte and SequenceTimeline.svelte). Each caller wires
 * in its own segment shape and split behavior; this owns the mechanics
 * behind Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y, Ctrl/Cmd+C, Ctrl/Cmd+V,
 * Escape, and rectangle-select boundary math.
 */

export interface BoundarySegment {
	id: string;
	startTime: number;
	endTime?: number | null;
}

export interface SegmentBoundaryControllerOptions<
	S extends BoundarySegment,
	M = undefined,
> {
	getSegments: () => S[];
	getTrackDuration: () => number;
	onChange: (segments: S[]) => void;
	/** Split `seg` at absolute time `at`, returning the [left, right] replacements. */
	splitSegment: (seg: S, at: number) => [S, S];
	/** Capture whatever per-segment data a pasted boundary should restore (e.g. subdivision). */
	captureMeta?: (rightSegmentAtBoundary: S | undefined) => M;
	/** Apply captured meta to the freshly-split right segment when pasting. */
	applyMeta?: (seg: S, meta: M) => S;
	/** Called after every undo/redo restore, whichever code path triggered it. */
	onRestore?: () => void;
}

interface ClipboardEntry<M> {
	offset: number;
	meta: M;
}

export class SegmentBoundaryController<S extends BoundarySegment, M = undefined> {
	selectedBoundaryTimes = $state<number[]>([]);
	clipboard = $state<ClipboardEntry<M>[]>([]);
	pasteMode = $state(false);
	pasteCursorTime = $state(0);

	#undoStack = $state<S[][]>([]);
	#redoStack = $state<S[][]>([]);
	#opts: SegmentBoundaryControllerOptions<S, M>;

	constructor(opts: SegmentBoundaryControllerOptions<S, M>) {
		this.#opts = opts;
	}

	get canUndo(): boolean {
		return this.#undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.#redoStack.length > 0;
	}

	/** Snapshot current segments to history without changing anything — call once when a drag starts moving. */
	snapshotForDrag(): void {
		this.#undoStack = [...this.#undoStack, [...this.#opts.getSegments()]];
		this.#redoStack = [];
	}

	/** Apply new segments and record history — use for discrete, one-shot edits. */
	commit(segments: S[]): void {
		this.#undoStack = [...this.#undoStack, [...this.#opts.getSegments()]];
		this.#redoStack = [];
		this.#opts.onChange(segments);
	}

	/**
	 * Push an externally captured pre-edit state (deep-snapshotted by the
	 * caller) — for in-place edits that bypass commit(), e.g. effect panel
	 * tweaks mutating a segment's effects directly.
	 */
	pushState(prev: S[]): void {
		this.#undoStack = [...this.#undoStack, prev];
		this.#redoStack = [];
	}

	/**
	 * Apply new segments without recording history — mid-drag (after
	 * snapshotForDrag()), or for changes that belong to a different history
	 * than this one, such as mosh rolls driven by their own stack.
	 */
	live(segments: S[]): void {
		this.#opts.onChange(segments);
	}

	undo(): boolean {
		if (this.#undoStack.length === 0) return false;
		this.#redoStack = [...this.#redoStack, [...this.#opts.getSegments()]];
		const prev = this.#undoStack[this.#undoStack.length - 1];
		this.#undoStack = this.#undoStack.slice(0, -1);
		this.#opts.onChange(prev);
		this.#opts.onRestore?.();
		return true;
	}

	redo(): boolean {
		if (this.#redoStack.length === 0) return false;
		this.#undoStack = [...this.#undoStack, [...this.#opts.getSegments()]];
		const next = this.#redoStack[this.#redoStack.length - 1];
		this.#redoStack = this.#redoStack.slice(0, -1);
		this.#opts.onChange(next);
		this.#opts.onRestore?.();
		return true;
	}

	clearSelection(): void {
		this.selectedBoundaryTimes = [];
	}

	copySelection(): boolean {
		if (this.selectedBoundaryTimes.length === 0) return false;
		const minTime = Math.min(...this.selectedBoundaryTimes);
		const segments = this.#opts.getSegments();
		this.clipboard = this.selectedBoundaryTimes.map((t) => {
			const rightSeg = segments.find((s) => Math.abs(s.startTime - t) < 0.001);
			return {
				offset: t - minTime,
				meta: this.#opts.captureMeta?.(rightSeg) as M,
			};
		});
		return true;
	}

	enterPasteMode(): boolean {
		if (this.clipboard.length === 0) return false;
		this.pasteMode = true;
		this.clearSelection();
		return true;
	}

	cancelPaste(): void {
		this.pasteMode = false;
	}

	/** Split segments at anchorTime + each clipboard offset. Records history. */
	pasteAt(anchorTime: number): void {
		const duration = this.#opts.getTrackDuration();
		let segments = [...this.#opts.getSegments()];
		for (const { offset, meta } of this.clipboard) {
			const t = anchorTime + offset;
			if (t <= 0.001 || t >= duration - 0.001) continue;
			const hit = segments.find((s) => {
				const end = s.endTime ?? duration;
				return t > s.startTime + 0.01 && t < end - 0.01;
			});
			if (!hit) continue;
			const [left, right] = this.#opts.splitSegment(hit, t);
			const finalRight =
				meta !== undefined && this.#opts.applyMeta
					? this.#opts.applyMeta(right, meta)
					: right;
			segments = segments
				.filter((s) => s.id !== hit.id)
				.concat([left, finalRight]);
		}
		this.commit(segments);
		this.pasteMode = false;
	}

	/** Merge segments at each selected boundary time. Records history. */
	deleteSelection(): boolean {
		if (this.selectedBoundaryTimes.length === 0) return false;
		const duration = this.#opts.getTrackDuration();
		let segs = [...this.#opts.getSegments()];
		const times = [...this.selectedBoundaryTimes].sort((a, b) => a - b);
		for (const t of times) {
			const sorted = [...segs].sort((a, b) => a.startTime - b.startTime);
			const left = sorted.find(
				(s) => Math.abs((s.endTime ?? duration) - t) < 0.001,
			);
			const right = sorted.find((s) => Math.abs(s.startTime - t) < 0.001);
			if (!left || !right) continue;
			const merged: S = { ...left, endTime: right.endTime ?? duration };
			segs = segs
				.filter((s) => s.id !== left.id && s.id !== right.id)
				.concat([merged]);
		}
		this.clearSelection();
		this.commit(segs);
		return true;
	}

	/** Boundary times inside [minTime, maxTime] — used both for live rect-select highlighting and on commit. */
	boundaryTimesInRange(minTime: number, maxTime: number): number[] {
		const duration = this.#opts.getTrackDuration();
		const times = new Set<number>();
		for (const s of this.#opts.getSegments()) {
			if (s.startTime > 0.001 && s.startTime >= minTime && s.startTime <= maxTime)
				times.add(s.startTime);
			const end = s.endTime ?? duration;
			if (end < duration - 0.001 && end >= minTime && end <= maxTime)
				times.add(end);
		}
		return [...times];
	}

	setSelectionFromRange(minTime: number, maxTime: number): void {
		this.selectedBoundaryTimes = this.boundaryTimesInRange(minTime, maxTime);
	}

	/**
	 * Handles the shortcuts that don't depend on component-specific selection
	 * priority (undo/redo/copy/paste/escape). Returns true if consumed —
	 * callers should e.preventDefault() and, where a competing outer keydown
	 * handler exists, stop the event from reaching it.
	 */
	onKeydown(e: KeyboardEvent): boolean {
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, select')) return false;

		const key = e.key.toLowerCase();
		const mod = e.ctrlKey || e.metaKey;

		if (mod && key === 'z' && !e.shiftKey) {
			if (this.undo()) {
				e.preventDefault();
				return true;
			}
			return false;
		}
		if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
			if (this.redo()) {
				e.preventDefault();
				return true;
			}
			return false;
		}
		if (mod && key === 'c') {
			if (this.copySelection()) {
				e.preventDefault();
				return true;
			}
			return false;
		}
		if (mod && key === 'v') {
			if (this.enterPasteMode()) {
				e.preventDefault();
				return true;
			}
			return false;
		}
		if (e.key === 'Escape') {
			if (this.pasteMode) {
				this.cancelPaste();
				return true;
			}
			if (this.selectedBoundaryTimes.length > 0) {
				this.clearSelection();
				return true;
			}
			return false;
		}
		return false;
	}

	/** True if onKeydown would consume this key right now (used to decide whether to stop propagation). */
	wouldHandle(e: KeyboardEvent): boolean {
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, select')) return false;

		const key = e.key.toLowerCase();
		const mod = e.ctrlKey || e.metaKey;

		if (mod && key === 'z' && !e.shiftKey) return this.canUndo;
		if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) return this.canRedo;
		if (mod && key === 'c') return this.selectedBoundaryTimes.length > 0;
		if (mod && key === 'v') return this.clipboard.length > 0;
		if (e.key === 'Escape')
			return this.pasteMode || this.selectedBoundaryTimes.length > 0;
		return false;
	}
}
