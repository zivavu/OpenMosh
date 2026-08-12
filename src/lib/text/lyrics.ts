import { sortClips } from "./resolve";
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
 *
 * `previous` is the lane's current clips. A line whose text is unchanged is
 * re-timed in place rather than replaced, so its id survives a re-sync and
 * anything keyed on it stays put.
 */
export function createLyricsClips(
  lines: string[],
  timings: number[],
  spanEnd: number,
  previous: TextClip[] = [],
): TextClip[] {
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    // Hold back enough room for every line still to come, so the tail keeps
    // its clips inside the span instead of running off the end.
    const latest = spanEnd - (lines.length - i) * MIN_CLIP_LENGTH;
    const capped = Math.min(timings[i], latest);
    starts.push(i > 0 ? Math.max(capped, starts[i - 1] + MIN_CLIP_LENGTH) : capped);
  }
  // Claimed one at a time, so a line repeated twice reuses two distinct clips.
  const spare = [...previous];
  return lines.map((text, i) => {
    const start = starts[i];
    const end =
      i + 1 < lines.length
        ? starts[i + 1]
        : Math.max(spanEnd, start + MIN_CLIP_LENGTH);
    const at = spare.findIndex((c) => c.text === text);
    if (at === -1) return createTextClip(start, end, text);
    const [kept] = spare.splice(at, 1);
    return { ...kept, start, end };
  });
}

/** The lines and timings a sync left in the lane, for reopening the modal on
 * what the timeline actually holds. Null before the first sync lands. */
export function lyricsDraftFromTimeline(
  timeline: TextTimeline,
): { lines: string[]; timings: number[]; clips: TextClip[] } | null {
  const lane = lyricsLane(timeline);
  if (!lane) return null;
  // A blank clip is no line at all. Dropping it here keeps lines and timings
  // index-aligned, which everything downstream assumes.
  const clips = sortClips(lane.clips).filter((c) => c.text.trim());
  if (clips.length === 0) return null;
  return {
    lines: clips.map((c) => c.text),
    timings: clips.map((c) => c.start),
    clips,
  };
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
