/** Shared zoom/pan viewport for every timeline. */

const MIN_ZOOM_FRACTION = 1 / 200;
/** One notch of zoom, shared by the wheel and the keyboard. */
const ZOOM_STEP = 1.2;
/** Wheel pixels in one zoom notch: a mouse click passes it, a pinch's small deltas don't. */
const PIXELS_PER_NOTCH = 40;

/** What a wheel event does. A pinch arrives as Ctrl+wheel, so it zooms. */
export function wheelGesture(
	e: Pick<WheelEvent, "shiftKey" | "ctrlKey" | "metaKey" | "deltaX" | "deltaY">,
	plainWheelScrolls: boolean,
): "pan" | "zoom" | "scroll" {
	if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return "pan";
	if (e.ctrlKey || e.metaKey) return "zoom";
	return plainWheelScrolls ? "scroll" : "zoom";
}

/** Zoom notches in a wheel event, at most one: positive zooms out. Lines and pages
 * (`deltaMode` above 0) only come from wheels with clicks, so each is a full notch. */
export function wheelZoomNotches(deltaY: number, deltaMode: number): number {
	if (deltaMode !== 0) return Math.sign(deltaY);
	return Math.max(-1, Math.min(1, deltaY / PIXELS_PER_NOTCH));
}

export class TimelineViewport {
	viewStart = $state(0);
	viewEnd = $state(0);

	readonly #getDuration: () => number;
	readonly #getRect: () => DOMRect | null;
	/** Optional playhead read: wheel-zoom pins it instead of the cursor. */
	readonly #getAnchorTime: (() => number | null) | null;

	constructor(
		getTrackDuration: () => number,
		getRect: () => DOMRect | null,
		getAnchorTime: (() => number | null) | null = null,
	) {
		this.#getDuration = getTrackDuration;
		this.#getRect = getRect;
		this.#getAnchorTime = getAnchorTime;
	}

	get viewDuration(): number {
		return Math.max(0.001, this.viewEnd - this.viewStart);
	}

	get isZoomed(): boolean {
		const td = this.#getDuration();
		return td > 0 && (this.viewStart > 0.001 || this.viewEnd < td - 0.001);
	}

	/** Like `clientXToTime`, but past the track's edges too: before 0 off its left. */
	clientXToTimeUnclamped(cx: number): number {
		const r = this.#getRect();
		if (!r || r.width <= 0) return this.viewStart;
		return this.viewStart + ((cx - r.left) / r.width) * this.viewDuration;
	}

	/** Client-x pixel → absolute track time via the current view window. */
	clientXToTime(cx: number): number {
		const r = this.#getRect();
		if (!r || this.viewDuration <= 0) return 0;
		const frac = Math.max(0, Math.min(1, (cx - r.left) / r.width));
		return this.viewStart + frac * this.viewDuration;
	}

	/** Absolute track time → view-relative percent (may be <0 or >100). */
	toPct(time: number): number {
		if (this.viewDuration <= 0) return 0;
		return ((time - this.viewStart) / this.viewDuration) * 100;
	}

	/** The playhead's position as a 0..1 view fraction, or null off-screen. */
	anchorFrac(): number | null {
		const t = this.#getAnchorTime?.();
		if (t == null || this.viewDuration <= 0) return null;
		const frac = (t - this.viewStart) / this.viewDuration;
		return frac >= 0 && frac <= 1 ? frac : null;
	}

	/** Slide the window by `delta` seconds, clamped to [0, trackDuration]. */
	panView(delta: number): void {
		const td = this.#getDuration();
		const dur = this.viewEnd - this.viewStart;
		let ns = this.viewStart + delta;
		let ne = ns + dur;
		if (ns < 0) {
			ne -= ns;
			ns = 0;
		}
		if (ne > td) {
			ns -= ne - td;
			ne = td;
		}
		this.viewStart = Math.max(0, ns);
		this.viewEnd = Math.min(td, ne);
	}

	/** Zoom by `factor` (>1 out, <1 in), keeping `cursorFrac` (0..1) fixed. */
	zoomView(factor: number, cursorFrac: number): void {
		const td = this.#getDuration();
		const minDur = Math.max(td * MIN_ZOOM_FRACTION, 0.1);
		const curDur = this.viewEnd - this.viewStart;
		const newDur = Math.max(minDur, Math.min(td, curDur * factor));
		const cursorTime = this.viewStart + cursorFrac * curDur;
		let ns = cursorTime - cursorFrac * newDur;
		let ne = ns + newDur;
		if (ns < 0) {
			ne -= ns;
			ns = 0;
		}
		if (ne > td) {
			ns -= ne - td;
			ne = td;
		}
		this.viewStart = Math.max(0, ns);
		this.viewEnd = Math.min(td, ne);
	}

	/** One notch of zoom from the keyboard, where there is no cursor. */
	zoomStep(inward: boolean): void {
		this.zoomView(inward ? 1 / ZOOM_STEP : ZOOM_STEP, this.anchorFrac() ?? 0.5);
	}

	/** Attach the shared wheel behavior (see `wheelGesture`) to `el`. */
	attachWheel(
		el: HTMLElement | SVGElement,
		onPan: (() => void) | null = null,
		plainWheelScrolls: () => boolean = () => false,
	): () => void {
		const handleWheel = (e: WheelEvent) => {
			const gesture = wheelGesture(e, plainWheelScrolls());
			// Left to the browser, which scrolls the lane list.
			if (gesture === "scroll") return;
			e.preventDefault();
			e.stopPropagation();
			if (this.#getDuration() <= 0) return;
			const r = el.getBoundingClientRect();
			const cursorFrac = Math.max(
				0,
				Math.min(1, (e.clientX - r.left) / r.width),
			);
			if (gesture === "pan") {
				onPan?.();
				// Some browsers report Shift+wheel on the horizontal axis.
				this.panView(
					e.shiftKey
						? this.viewDuration * 0.25 * Math.sign(e.deltaY || e.deltaX)
						: (e.deltaX / 200) * this.viewDuration,
				);
			} else {
				// Pin the playhead while zooming when it's on screen.
				this.zoomView(
					ZOOM_STEP ** wheelZoomNotches(e.deltaY, e.deltaMode),
					this.anchorFrac() ?? cursorFrac,
				);
			}
		};
		el.addEventListener("wheel", handleWheel as EventListener, {
			passive: false,
		});
		return () => el.removeEventListener("wheel", handleWheel as EventListener);
	}
}
