import { describe, expect, it } from "bun:test";
import {
   applyLyricsToTimeline,
   createLyricsClips,
   LYRICS_LANE_NAME,
   lyricsLane,
} from "./lyrics";
import { createTextLane, type TextTimeline } from "./types";

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

   it("defaults synced lines to the karaoke style", () => {
      const [clip] = createLyricsClips(["a"], [0], 5);
      expect(clip.style.x).toBe(0.5);
      expect(clip.style.y).toBe(0.85);
      expect(clip.style.size).toBe(0.075);
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
      const t: TextTimeline = { enabled: true, lanes: [lane, createTextLane("Text 1")] };
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
