/**
 * One time axis per editor, shared by every lane stacked under it (segments,
 * beat subdivisions, text lanes, the audio track). Owns the single
 * TimelineViewport all of them map through, so zooming or panning over any lane
 * moves the whole stack, and whether the view chases the playhead.
 *
 * TimelineStack.svelte creates this and puts it in context; lane components
 * read it with getTimelineStack() instead of building viewports of their own.
 */

import { getContext, setContext, type Snippet } from "svelte";
import { TimelineViewport } from "./timeline-viewport.svelte";

const KEY = Symbol("timeline-stack");

export class TimelineStackState {
   /** Whether the view chases the playhead. Panning by hand takes it over —
    * chasing while the user is reading somewhere else drags them back — and
    * only the Follow button hands it back. */
   followPlayhead = $state(true);

   /** The static playhead: where playback starts from. The clock runs away
    * from it while playing and is put back on it when playback stops, so a
    * paused editor shows this marker alone. */
   staticTime = $state(0);

   /** The lane the user last touched, so a bare split shortcut knows which
    * lane to cut. Lanes that can't split (audio) never set it. */
   activeLaneId = $state<string | null>(null);

   /** Split-at-time callbacks, keyed by lane id, for lanes that support it. */
   readonly #splitters = new Map<string, (time: number) => void>();

   /** Register a lane that can split its item at a time. Returns unregister. */
   registerSplitter(laneId: string, splitAt: (time: number) => void): () => void {
      this.#splitters.set(laneId, splitAt);
      return () => this.#splitters.delete(laneId);
   }

   markLaneUsed(laneId: string): void {
      this.activeLaneId = laneId;
   }

   /**
    * Contextual controls for whatever each lane has selected. They render in
    * the stack's one selection bar rather than in a row under their own lane:
    * a bar per lane both duplicated the controls and, appearing mid-stack,
    * pushed every lane below it down on each click.
    *
    * Newest registration last, and the last one wins — the lane whose
    * selection just filled is the one on show. Same "most recent edit, not the
    * selected one" rule the undo router follows.
    */
   #selectionBars = $state<{ laneId: string; render: Snippet }[]>([]);

   /** Publish a lane's selection controls. Returns unregister. */
   registerSelectionBar(laneId: string, render: Snippet): () => void {
      this.#selectionBars = [
         ...this.#selectionBars.filter((b) => b.laneId !== laneId),
         { laneId, render },
      ];
      return () => {
         this.#selectionBars = this.#selectionBars.filter(
            (b) => b.laneId !== laneId,
         );
      };
   }

   /** The controls the selection bar should show, or null when nothing is
    * selected anywhere. */
   get selectionBar(): Snippet | null {
      return this.#selectionBars.at(-1)?.render ?? null;
   }

   /** The active lane's split callback, or null when it has none. */
   get activeLaneSplitAt(): ((time: number) => void) | null {
      const id = this.activeLaneId;
      return id ? this.#splitters.get(id) ?? null : null;
   }

   readonly vp: TimelineViewport;

   /**
    * Lane width in px, kept current by a ResizeObserver.
    *
    * Observed rather than measured on demand because the callers that want it
    * read it while the lanes' own inline widths are being written — a
    * getBoundingClientRect() there forces a layout flush, once per clip, on
    * every frame the view pans.
    */
   laneWidth = $state(0);

   /** Every mounted lane track. They all share one geometry, so any of them can
    * measure the axis — kept as a set so deleting the lane that happened to
    * register (a text lane, say) doesn't leave the axis unmeasurable. */
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
         // Wheel-zoom pins the playhead when it's on screen, but only while
         // following; a hand-panned view zooms around the cursor instead.
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

   /** Move the master clock. Any lane can scrub — there is no ruler row to be
    * the only place that does. Scrubbing by hand takes the view over, the same
    * way panning does: recentring on a playhead the user is dragging fights the
    * drag. */
   seekTo(time: number): void {
      this.followPlayhead = false;
      const clamped = Math.max(0, Math.min(this.#getDuration(), time));
      this.#seek(clamped);
   }

   /** Move the static playhead, and the clock with it: the marker is where
    * playback is, not just where it would start, so dragging it scrubs — while
    * playing it jumps playback there, while paused it moves the one visible
    * marker. */
   seekStatic(time: number): void {
      const clamped = Math.max(0, Math.min(this.#getDuration(), time));
      this.staticTime = clamped;
      this.followPlayhead = false;
      this.#seek(clamped);
   }

   /** Put the clock back on the static marker. Called when playback stops, so
    * the live playhead leaves the screen where the marker already is rather
    * than stranding a second line wherever it happened to stop. */
   returnToStatic(): void {
      this.#seek(Math.max(0, Math.min(this.#getDuration(), this.staticTime)));
   }

   /**
    * Svelte action for a lane's track element. Registers it as the geometry the
    * axis measures against and gives it the shared wheel behaviour, so
    * scrolling over any lane zooms every lane.
    */
   lane = (node: HTMLElement | SVGElement, laneId?: string) => {
      const el = node as HTMLElement;
      this.#trackEls.add(el);
      this.#resizeObserver.observe(el);
      if (this.laneWidth <= 0) {
         this.laneWidth = el.getBoundingClientRect().width;
      }
      // Any touch marks the lane as the one a bare split shortcut aims at.
      // Capture phase: boundary drags stop propagation, but they still count.
      const markUsed = (e: PointerEvent) => {
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
         },
      };
   };
}

export function setTimelineStack(state: TimelineStackState): TimelineStackState {
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
