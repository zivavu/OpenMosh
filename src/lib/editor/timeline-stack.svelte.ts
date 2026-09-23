/** One time axis per editor, shared by every lane stacked under it. */

import { getContext, setContext, untrack, type Snippet } from "svelte";
import { findSnap, landedAt, type SnapPoint } from "../timeline/snap";
import { TimelineViewport } from "./timeline-viewport.svelte";

/** How close, on screen, a dragged edge has to come to a target to snap. */
const SNAP_PX = 7;
/** The least a group dragged across rows may slide to find room, on screen. */
const CROSS_LANE_PX = 32;
/** Beats closer than this on screen are left out of the targets. */
const MIN_BEAT_PX = 24;

const KEY = Symbol("timeline-stack");

export class TimelineStackState {
	/** Whether the view chases the playhead; panning by hand takes it over. */
	followPlayhead = $state(true);

	/** The static playhead: where playback starts from. */
	staticTime = $state(0);

	/** The lane last touched, so a bare split shortcut knows which to cut. */
	activeLaneId = $state<string | null>(null);

	/** Split-at-time callbacks, keyed by lane id, for lanes that support it. */
	readonly #splitters = new Map<string, (time: number) => void>();

	/** Register a lane that can split its item at a time. Returns unregister. */
	registerSplitter(
		laneId: string,
		splitAt: (time: number) => void,
	): () => void {
		this.#splitters.set(laneId, splitAt);
		return () => this.#splitters.delete(laneId);
	}

	markLaneUsed(laneId: string): void {
		this.activeLaneId = laneId;
	}

	// Every lane publishes its edges; a drag can land on any of them, plus the
	// track ends, the start marker and the beat grid.

	/** Tempo of the master track, for the beat grid. 0 = none known. */
	bpm = $state(0);

	/** The target the current drag is snapped to, for the guide line. */
	snapGuide = $state<number | null>(null);

	readonly #snapSources = new Map<string, () => SnapPoint[]>();

	/** Register a lane's edges as snap targets. Returns unregister. */
	registerSnapSource(laneId: string, edges: () => SnapPoint[]): () => void {
		this.#snapSources.set(laneId, edges);
		return () => this.#snapSources.delete(laneId);
	}

	/** The shift that lands one of `edges` on the nearest target, or 0 when none is near. */
	snapShift(
		edges: number[],
		exclude: ReadonlySet<string>,
		bypass = false,
	): number {
		if (bypass || this.laneWidth <= 0) {
			this.snapGuide = null;
			return 0;
		}
		const secPerPx = this.vp.viewDuration / this.laneWidth;
		const duration = this.#getDuration();
		const targets: SnapPoint[] = [
			{ time: 0, ownerId: null },
			{ time: duration, ownerId: null },
			{ time: this.staticTime, ownerId: null },
		];
		for (const source of this.#snapSources.values()) targets.push(...source());
		const beatSec = this.bpm > 0 ? 60 / this.bpm : 0;
		const hit = findSnap(
			edges,
			targets,
			SNAP_PX * secPerPx,
			exclude,
			beatSec / secPerPx >= MIN_BEAT_PX ? beatSec : 0,
		);
		this.snapGuide = hit?.at ?? null;
		return hit?.shift ?? 0;
	}

	/** How far a group dragged into another row may slide to find room. */
	crossLaneTolerance(group: readonly { start: number; end: number }[]): number {
		const secPerPx =
			this.laneWidth > 0 ? this.vp.viewDuration / this.laneWidth : 0;
		const length =
			Math.max(...group.map((c) => c.end)) -
			Math.min(...group.map((c) => c.start));
		return Math.max(length, secPerPx * CROSS_LANE_PX);
	}

	/** snapShift() for a single edge: the time it should land on. */
	snapTime(time: number, exclude: ReadonlySet<string>, bypass = false): number {
		return time + this.snapShift([time], exclude, bypass);
	}

	/** Keep the guide only if a dragged edge reached it. */
	confirmSnap(edges: number[]): void {
		if (this.snapGuide !== null && !landedAt(edges, this.snapGuide)) {
			this.snapGuide = null;
		}
	}

	/** The drag is over; the guide goes with it. */
	endSnap(): void {
		this.snapGuide = null;
	}

	/** Contextual controls for each lane's selection, in the stack's one selection bar. */
	#selectionBars = $state<{ laneId: string; render: Snippet }[]>([]);

	/** Publish a lane's selection controls. Returns unregister. */
	registerSelectionBar(laneId: string, render: Snippet): () => void {
		untrack(() => {
			this.#selectionBars = [
				...this.#selectionBars.filter((b) => b.laneId !== laneId),
				{ laneId, render },
			];
		});
		return () =>
			untrack(() => {
				this.#selectionBars = this.#selectionBars.filter(
					(b) => b.laneId !== laneId,
				);
			});
	}

	/** The controls the selection bar shows, or null when nothing is selected. */
	get selectionBar(): Snippet | null {
		return this.#selectionBars.at(-1)?.render ?? null;
	}

	/** The active lane's split callback, or null when it has none. */
	get activeLaneSplitAt(): ((time: number) => void) | null {
		const id = this.activeLaneId;
		return id ? (this.#splitters.get(id) ?? null) : null;
	}

	readonly vp: TimelineViewport;

	/** Lane width in px, kept current by a ResizeObserver. */
	laneWidth = $state(0);

	/** Every mounted lane track; they share one geometry, so any can measure the axis. */
	readonly #trackEls = new Set<HTMLElement>();
	readonly #resizeObserver = new ResizeObserver((entries) => {
		const width = entries[entries.length - 1].contentRect.width;
		if (width > 0) this.laneWidth = width;
	});
	readonly #getDuration: () => number;
	readonly #getCurrentTime: () => number;
	readonly #seek: (time: number) => void;

	constructor(
		getDuration: () => number,
		getCurrentTime: () => number,
		seek: (time: number) => void = () => {},
	) {
		this.#getDuration = getDuration;
		this.#getCurrentTime = getCurrentTime;
		this.#seek = seek;
		this.vp = new TimelineViewport(
			getDuration,
			() => this.#laneRect(),
			// Wheel-zoom pins the playhead when on screen, but only while following.
			() => (this.followPlayhead ? getCurrentTime() : null),
		);
	}

	#laneRect(): DOMRect | null {
		for (const el of this.#trackEls) {
			if (el.isConnected) return el.getBoundingClientRect();
		}
		return null;
	}

	get trackDuration(): number {
		return this.#getDuration();
	}

	get currentTime(): number {
		return this.#getCurrentTime();
	}

	/** Absolute track time → view-relative percent. */
	toPct(time: number): number {
		return this.vp.toPct(time);
	}

	/** Client-x pixel → absolute track time. */
	timeAt(clientX: number): number {
		return this.vp.clientXToTime(clientX);
	}

	/** Move the master clock; any lane can scrub, since there is no ruler row. */
	seekTo(time: number): void {
		this.followPlayhead = false;
		const clamped = Math.max(0, Math.min(this.#getDuration(), time));
		this.#seek(clamped);
	}

	/** Move the static playhead and the clock with it. */
	seekStatic(time: number): void {
		const clamped = Math.max(0, Math.min(this.#getDuration(), time));
		this.staticTime = clamped;
		this.followPlayhead = false;
		this.#seek(clamped);
	}

	/** Put the clock back on the static marker when playback stops. */
	returnToStatic(): void {
		this.#seek(Math.max(0, Math.min(this.#getDuration(), this.staticTime)));
	}

	/** Track elements by lane id, for hit-testing a drag against the rows. */
	readonly #laneEls = new Map<HTMLElement, string>();

	/** The lane whose track spans `y`, or null between rows. */
	laneIdAt(y: number): string | null {
		for (const [el, id] of this.#laneEls) {
			const r = el.getBoundingClientRect();
			if (y >= r.top && y < r.bottom) return id;
		}
		return null;
	}

	/** Lanes whose rows overlap the band between two screen heights, top to bottom. */
	laneIdsBetween(y0: number, y1: number): string[] {
		const top = Math.min(y0, y1);
		const bottom = Math.max(y0, y1);
		return [...this.#laneEls]
			.map(([el, id]) => ({ id, r: el.getBoundingClientRect() }))
			.filter(({ r }) => r.bottom > top && r.top <= bottom)
			.sort((a, b) => a.r.top - b.r.top)
			.map(({ id }) => id);
	}

	/** Svelte action for a lane's track element; registers it as the axis geometry. */
	lane = (node: HTMLElement | SVGElement, laneId?: string) => {
		const el = node as HTMLElement;
		this.#trackEls.add(el);
		if (laneId) this.#laneEls.set(el, laneId);
		this.#resizeObserver.observe(el);
		if (this.laneWidth <= 0) {
			this.laneWidth = el.getBoundingClientRect().width;
		}
		// Any touch marks the lane a bare split shortcut aims at.
		const markUsed = () => {
			if (laneId) this.markLaneUsed(laneId);
		};
		el.addEventListener("pointerdown", markUsed, true);
		const detachWheel = this.vp.attachWheel(node, () => {
			this.followPlayhead = false;
		});
		return {
			destroy: () => {
				el.removeEventListener("pointerdown", markUsed, true);
				detachWheel();
				this.#resizeObserver.unobserve(el);
				this.#trackEls.delete(el);
				this.#laneEls.delete(el);
			},
		};
	};
}

export function setTimelineStack(
	state: TimelineStackState,
): TimelineStackState {
	return setContext(KEY, state);
}

/** The enclosing stack's axis. Throws when a lane is mounted outside a stack. */
export function getTimelineStack(): TimelineStackState {
	const state = tryGetTimelineStack();
	if (!state) {
		throw new Error("Timeline lane rendered outside a <TimelineStack>");
	}
	return state;
}

/** For components that render either inside a stack or standalone. */
export function tryGetTimelineStack(): TimelineStackState | undefined {
	return getContext<TimelineStackState | undefined>(KEY);
}
