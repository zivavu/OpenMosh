import {
   createTextClip,
   createTextLane,
   MIN_CLIP_LENGTH,
   type TextClip,
   type TextLane,
   type TextTimeline,
} from "./types";

/** The lane a lyrics sync writes its timed lines into. */
export const LYRICS_LANE_NAME = "Lyrics";

/** Karaoke-style placement for synced lines; restylable like any clip. */
export const LYRICS_STYLE = { x: 0.5, y: 0.85, size: 0.075 } as const;

/**
 * One clip per line, back-to-back: each line stays up until the next one
 * starts, and the last one holds to `spanEnd`.
 */
export function createLyricsClips(
   lines: string[],
   timings: number[],
   spanEnd: number,
): TextClip[] {
   return lines.map((text, i) => {
      const start = timings[i];
      const end = i + 1 < lines.length ? timings[i + 1] : spanEnd;
      return createTextClip(
         start,
         Math.max(end, start + MIN_CLIP_LENGTH),
         text,
         LYRICS_STYLE,
      );
   });
}

/** The timeline's lyrics lane, or undefined before the first sync lands. */
export function lyricsLane(timeline: TextTimeline): TextLane | undefined {
   return timeline.lanes.find((l) => l.name === LYRICS_LANE_NAME);
}

/**
 * Refill the lyrics lane with `clips`, creating the lane on the first sync.
 * Re-applying replaces the previous sync rather than stacking on top of it.
 */
export function applyLyricsToTimeline(
   timeline: TextTimeline,
   clips: TextClip[],
): TextTimeline {
   const existing = lyricsLane(timeline);
   const lane: TextLane = existing
      ? { ...existing, enabled: true, clips }
      : { ...createTextLane(LYRICS_LANE_NAME), clips };
   return {
      ...timeline,
      enabled: true,
      lanes: existing
         ? timeline.lanes.map((l) => (l.id === lane.id ? lane : l))
         : [...timeline.lanes, lane],
   };
}
