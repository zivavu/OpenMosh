/**
 * One time axis per editor, shared by every lane stacked under it (segments,
 * beat subdivisions, text lanes, the audio track). Owns the single
 * TimelineViewport all of them map through, so zooming or panning over any lane
 * moves the whole stack, and whether the view chases the playhead.
 *
 * TimelineStack.svelte creates this and puts it in context; lane components
 * read it with getTimelineStack() instead of building viewports of their own.
 */

import { getContext, setContext } from "svelte";
import { TimelineViewport } from "./timeline-viewport.svelte";

const KEY = Symbol("timeline-stack");

export class TimelineStackState {
   /** Whether the view chases the playhead. Panning by hand takes it over —
    * chasing while the user is reading somewhere else drags them back — and
    * only the Follow button hands it back. */
   followPlayhead = $state(true);

   /** The static playhead: where the next play starts from. It never moves
    * with the clock — only a direct drag moves it, which is why it is a
    * separate marker rather than a second clock. */
   staticTime = $state(0);

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

   /** Move the static playhead. Unlike seekTo this never touches the master
    * clock — the marker only decides where the next play starts from. */
   seekStatic(time: number): void {
      this.staticTime = Math.max(0, Math.min(this.#getDuration(), time));
   }

   /**
    * Svelte action for a lane's track element. Registers it as the geometry the
    * axis measures against and gives it the shared wheel behaviour, so
    * scrolling over any lane zooms every lane.
    */
   lane = (node: HTMLElement | SVGElement) => {
      const el = node as HTMLElement;
      this.#trackEls.add(el);
      this.#resizeObserver.observe(el);
      if (this.laneWidth <= 0) {
         this.laneWidth = el.getBoundingClientRect().width;
      }
      const detachWheel = this.vp.attachWheel(node, () => {
         this.followPlayhead = false;
      });
      return {
         destroy: () => {
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
