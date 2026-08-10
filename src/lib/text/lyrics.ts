import {
  createTextClip,
  createTextLane,
  DEFAULT_TEXT_STYLE,
  MIN_CLIP_LENGTH,
  type TextClip,
  type TextLane,
  type TextTimeline,
} from "./types";

/** The lane a lyrics sync writes its timed lines into. */
export const LYRICS_LANE_NAME = "Lyrics";

/** The karaoke-style placement a fresh lyrics lane starts from. */
export const LYRICS_STYLE = { x: 0.5, y: 0.85, size: 0.075 } as const;

/**
 * One clip per line, back-to-back: each line stays up until the next one
 * starts, and the last one holds to `spanEnd`.
 *
 * Timings are forced to climb on the way in. A nudge that clamps at the span
 * end, or a re-stamp after seeking backwards, can hand us lines that sit on or
 * behind their predecessor, and a lane's clips must never overlap.
 */
export function createLyricsClips(
  lines: string[],
  timings: number[],
  spanEnd: number,
): TextClip[] {
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Hold back enough room for every line still to come, so the tail keeps
    // its clips inside the span instead of running off the end.
    const latest = spanEnd - (lines.length - i) * MIN_CLIP_LENGTH;
    const capped = Math.min(timings[i], latest);
    starts.push(i > 0 ? Math.max(capped, starts[i - 1] + MIN_CLIP_LENGTH) : capped);
  }
  return lines.map((text, i) =>
    createTextClip(
      starts[i],
      i + 1 < lines.length
        ? starts[i + 1]
        : Math.max(spanEnd, starts[i] + MIN_CLIP_LENGTH),
      text,
    ),
  );
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
    : {
        ...createTextLane(LYRICS_LANE_NAME),
        style: { ...DEFAULT_TEXT_STYLE, ...LYRICS_STYLE },
        clips,
      };
  return {
    ...timeline,
    enabled: true,
    lanes: existing
      ? timeline.lanes.map((l) => (l.id === lane.id ? lane : l))
      : [...timeline.lanes, lane],
  };
}
