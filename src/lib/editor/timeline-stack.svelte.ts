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

   readonly vp: TimelineViewport;

   /** Every mounted lane track. They all share one geometry, so any of them can
    * measure the axis — kept as a set so deleting the lane that happened to
    * register (a text lane, say) doesn't leave the axis unmeasurable. */
   readonly #trackEls = new Set<HTMLElement>();
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

   /**
    * Svelte action for a lane's track element. Registers it as the geometry the
    * axis measures against and gives it the shared wheel behaviour, so
    * scrolling over any lane zooms every lane.
    */
   lane = (node: HTMLElement | SVGElement) => {
      const el = node as HTMLElement;
      this.#trackEls.add(el);
      const detachWheel = this.vp.attachWheel(node, () => {
         this.followPlayhead = false;
      });
      return {
         destroy: () => {
            detachWheel();
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
