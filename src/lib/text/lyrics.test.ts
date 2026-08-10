import { describe, expect, it } from "bun:test";
import {
  applyLyricsToTimeline,
  createLyricsClips,
  LYRICS_LANE_NAME,
  lyricsDraftFromTimeline,
  lyricsLane,
} from "./lyrics";
import {
  createTextLane,
  MIN_CLIP_LENGTH,
  type TextClip,
  type TextTimeline,
} from "./types";

/** A lane holding `clips`, as a synced timeline would. */
function timelineWithLyrics(clips: TextClip[]): TextTimeline {
  return {
    enabled: true,
    lanes: [{ ...createTextLane(LYRICS_LANE_NAME), clips }],
  };
}

describe("createLyricsClips", () => {
  it("lays lines back-to-back and holds the last to the span end", () => {
    const clips = createLyricsClips(["a", "b", "c"], [1, 3, 6], 10);
    expect(clips.map((c) => [c.start, c.end, c.text])).toEqual([
      [1, 3, "a"],
      [3, 6, "b"],
      [6, 10, "c"],
    ]);
  });

  it("keeps every clip at least MIN_CLIP_LENGTH long", () => {
    const clips = createLyricsClips(["a", "b"], [1, 1.01], 5);
    expect(clips[0].end - clips[0].start).toBeGreaterThanOrEqual(0.05);
  });

  it("never overlaps clips when timings collapse onto one instant", () => {
    // A fine-tune nudge clamps every timing at the span end.
    const clips = createLyricsClips(["a", "b", "c"], [5, 5, 5], 5);
    for (let i = 1; i < clips.length; i++) {
      expect(clips[i].start).toBeGreaterThanOrEqual(clips[i - 1].end);
    }
  });

  it("never overlaps clips when a re-stamp lands behind the line before it", () => {
    const clips = createLyricsClips(["a", "b", "c"], [4, 2, 6], 10);
    for (let i = 1; i < clips.length; i++) {
      expect(clips[i].start).toBeGreaterThanOrEqual(clips[i - 1].end);
      expect(clips[i].end).toBeGreaterThan(clips[i].start);
    }
  });

  it("keeps clips inside the span, reserving room for the lines after each", () => {
    const clips = createLyricsClips(["a", "b", "c"], [9, 9, 9], 10);
    expect(clips[0].start).toBeLessThanOrEqual(10 - 3 * MIN_CLIP_LENGTH);
    expect(clips[clips.length - 1].end).toBe(10);
  });

  it("re-times a matching line in place, keeping its id and effects", () => {
    const first = createLyricsClips(["a", "b"], [1, 3], 10);
    first[1].effects = [{ instanceId: "fx-1" } as never];
    const again = createLyricsClips(["a", "b"], [1, 4], 10, first);
    expect(again[1].id).toBe(first[1].id);
    expect(again[1].effects).toEqual(first[1].effects);
    expect(again[1].start).toBe(4);
  });

  it("gives a changed line a fresh clip, leaving its neighbours intact", () => {
    const first = createLyricsClips(["a", "b", "c"], [1, 3, 6], 10);
    const again = createLyricsClips(["a", "typo fixed", "c"], [1, 3, 6], 10, first);
    expect(again[0].id).toBe(first[0].id);
    expect(again[2].id).toBe(first[2].id);
    expect(again[1].id).not.toBe(first[1].id);
  });

  it("gives a repeated line one clip per occurrence", () => {
    const first = createLyricsClips(["oh", "oh"], [1, 3], 10);
    const again = createLyricsClips(["oh", "oh"], [1, 3], 10, first);
    expect(new Set(again.map((c) => c.id)).size).toBe(2);
    expect(again.map((c) => c.id).sort()).toEqual(
      first.map((c) => c.id).sort(),
    );
  });

  it("gives a fresh lyrics lane the karaoke style", () => {
    const t: TextTimeline = { enabled: true, lanes: [] };
    const next = applyLyricsToTimeline(t, createLyricsClips(["a"], [0], 5));
    const style = lyricsLane(next)?.style;
    expect(style?.x).toBe(0.5);
    expect(style?.y).toBe(0.85);
    expect(style?.size).toBe(0.075);
  });
});

describe("applyLyricsToTimeline", () => {
  it("creates the lyrics lane on the first sync", () => {
    const t: TextTimeline = { enabled: true, lanes: [createTextLane("Text 1")] };
    const clips = createLyricsClips(["a"], [0], 5);
    const next = applyLyricsToTimeline(t, clips);
    expect(lyricsLane(next)?.name).toBe(LYRICS_LANE_NAME);
    expect(next.lanes).toHaveLength(2);
    expect(next.lanes[1].clips).toEqual(clips);
  });

  it("replaces the clips in an existing lyrics lane instead of stacking", () => {
    const lane = {
      ...createTextLane(LYRICS_LANE_NAME),
      clips: createLyricsClips(["old"], [0], 5),
    };
    const t: TextTimeline = {
      enabled: true,
      lanes: [lane, createTextLane("Text 1")],
    };
    const clips = createLyricsClips(["new"], [2], 5);
    const next = applyLyricsToTimeline(t, clips);
    expect(next.lanes).toHaveLength(2);
    expect(next.lanes[0].clips.map((c) => c.text)).toEqual(["new"]);
  });

  it("enables a disabled timeline", () => {
    const t: TextTimeline = { enabled: false, lanes: [] };
    const next = applyLyricsToTimeline(t, createLyricsClips(["a"], [0], 5));
    expect(next.enabled).toBe(true);
  });
});

describe("lyricsDraftFromTimeline", () => {
  it("reads the lane's lines and start times back out", () => {
    const clips = createLyricsClips(["a", "b", "c"], [1, 3, 6], 10);
    const draft = lyricsDraftFromTimeline(timelineWithLyrics(clips));
    expect(draft?.lines).toEqual(["a", "b", "c"]);
    expect(draft?.timings).toEqual([1, 3, 6]);
  });

  it("reads clips in time order, not lane order", () => {
    const [a, b] = createLyricsClips(["a", "b"], [1, 3], 10);
    const draft = lyricsDraftFromTimeline(timelineWithLyrics([b, a]));
    expect(draft?.lines).toEqual(["a", "b"]);
  });

  it("survives a round trip through createLyricsClips unchanged", () => {
    const clips = createLyricsClips(["a", "b", "c"], [1, 3, 6], 10);
    const draft = lyricsDraftFromTimeline(timelineWithLyrics(clips))!;
    const again = createLyricsClips(draft.lines, draft.timings, 10, draft.clips);
    expect(again).toEqual(clips);
  });

  it("drops blank clips, keeping lines and timings index-aligned", () => {
    const clips = createLyricsClips(["a", "b", "c"], [1, 3, 6], 10);
    clips[1].text = "  ";
    const draft = lyricsDraftFromTimeline(timelineWithLyrics(clips))!;
    expect(draft.lines).toEqual(["a", "c"]);
    expect(draft.timings).toEqual([1, 6]);
    expect(draft.lines).toHaveLength(draft.timings.length);
  });

  it("is null before any sync lands", () => {
    expect(lyricsDraftFromTimeline({ enabled: true, lanes: [] })).toBeNull();
    expect(lyricsDraftFromTimeline(timelineWithLyrics([]))).toBeNull();
  });
});
