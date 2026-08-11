/**
 * Shared zoom/pan viewport for the segment and text timelines (single-editor
 * sequence timeline, slideshow beat timeline, text timeline). Owns the visible
 * [viewStart, viewEnd] window over a track of `getTrackDuration()` seconds and
 * the coordinate mapping between client-x pixels and track time.
 *
 * The reset/clamp policy on duration change stays with each component — they
 * differ — so this class exposes the mutable state and leaves initialization
 * to the caller.
 */

const MIN_ZOOM_FRACTION = 1 / 200;

export class TimelineViewport {
   viewStart = $state(0);
   viewEnd = $state(0);

   readonly #getDuration: () => number;
   readonly #getRect: () => DOMRect | null;
   /** Optional playhead read: wheel-zoom pins it instead of the cursor. Return
    * null to fall back to the cursor (e.g. while not following the playhead). */
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

   /**
    * Attach the shared wheel behavior (shift/horizontal → pan, vertical → zoom,
    * pinned to the playhead when it's on screen) to `el` with a non-passive
    * listener. `onPan` fires on the pan gestures only, for callers that treat a
    * deliberate pan as taking the view over. Returns a cleanup fn.
    */
   attachWheel(
      el: HTMLElement | SVGElement,
      onPan: (() => void) | null = null,
   ): () => void {
      const handleWheel = (e: WheelEvent) => {
         e.preventDefault();
         e.stopPropagation();
         if (this.#getDuration() <= 0) return;
         const r = el.getBoundingClientRect();
         const cursorFrac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
         if (e.shiftKey) {
            onPan?.();
            this.panView(this.viewDuration * 0.25 * Math.sign(e.deltaY));
         } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
            onPan?.();
            this.panView((e.deltaX / 200) * this.viewDuration);
         } else {
            // Pin the playhead while zooming when it's on screen, so the view
            // grows around it instead of under the cursor.
            this.zoomView(
               e.deltaY > 0 ? 1.2 : 1 / 1.2,
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
