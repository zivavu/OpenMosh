import { describe, expect, it } from "bun:test";
import { copyMediaClips, pasteMediaClips } from "./clipboard";
import {
  createMediaClip,
  createMediaLane,
  type MediaLane,
  type MediaTimeline,
} from "./types";

function laneWith(spans: [number, number, number?][], name = "Layer 1"): MediaLane {
  const lane = createMediaLane(name, "src-a");
  return {
    ...lane,
    clips: spans.map(([s, e, into]) => createMediaClip(s, e, into ?? 0)),
  };
}

function timelineOf(lanes: MediaLane[]): MediaTimeline {
  return { enabled: true, lanes };
}

describe("copyMediaClips", () => {
  it("anchors offsets at the earliest clip", () => {
    const lane = laneWith([
      [10, 14],
      [20, 22],
    ]);
    const copied = copyMediaClips(
      timelineOf([lane]),
      lane.clips.map((c) => c.id),
    );
    expect(copied.map((c) => c.offset)).toEqual([0, 10]);
    expect(copied.map((c) => c.length)).toEqual([4, 2]);
  });

  it("carries the in-point and the fade", () => {
    const lane = laneWith([[0, 5, 30]]);
    lane.clips[0].fadeSec = 0.5;
    const [entry] = copyMediaClips(timelineOf([lane]), [lane.clips[0].id]);
    expect(entry.sourceStart).toBe(30);
    expect(entry.fadeSec).toBe(0.5);
  });

  it("carries the clip's own source", () => {
    const lane = laneWith([[0, 5]]);
    lane.clips[0].sourceId = "src-b";
    const [entry] = copyMediaClips(timelineOf([lane]), [lane.clips[0].id]);
    expect(entry.sourceId).toBe("src-b");
  });

  it("ignores ids that aren't in the timeline", () => {
    const lane = laneWith([[0, 5]]);
    expect(copyMediaClips(timelineOf([lane]), ["nope"])).toEqual([]);
  });
});

describe("pasteMediaClips", () => {
  it("keeps the copied length and in-point", () => {
    const lane = laneWith([[0, 5, 12]]);
    const t = timelineOf([lane]);
    const copied = copyMediaClips(t, [lane.clips[0].id]);
    const { timeline, clipIds } = pasteMediaClips(t, copied, 20, 60);
    const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
    expect(pasted.start).toBe(20);
    expect(pasted.end).toBe(25);
    expect(pasted.sourceStart).toBe(12);
  });

  it("pastes a retargeted clip still showing its own media", () => {
    const lane = laneWith([[0, 5]]);
    lane.clips[0].sourceId = "src-b";
    const t = timelineOf([lane]);
    const copied = copyMediaClips(t, [lane.clips[0].id]);
    const { timeline, clipIds } = pasteMediaClips(t, copied, 20, 60);
    const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
    expect(pasted.sourceId).toBe("src-b");
  });

  it("lands the copy after the original when the playhead is inside it", () => {
    const lane = laneWith([[0, 10]]);
    const t = timelineOf([lane]);
    const copied = copyMediaClips(t, [lane.clips[0].id]);
    const { timeline, clipIds } = pasteMediaClips(t, copied, 4, 60);
    const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
    expect(pasted.start).toBe(10);
    expect(pasted.end).toBe(20);
  });

  it("slides past everything in the way rather than trimming", () => {
    const lane = laneWith([
      [0, 10],
      [12, 30],
    ]);
    const t = timelineOf([lane]);
    const copied = copyMediaClips(t, [lane.clips[0].id]);
    const { timeline, clipIds } = pasteMediaClips(t, copied, 5, 60);
    const pasted = timeline.lanes[0].clips.find((c) => c.id === clipIds[0])!;
    expect(pasted.start).toBe(30);
    expect(pasted.end).toBe(40);
  });

  it("pastes nothing when the rest of the timeline has no room", () => {
    const lane = laneWith([[0, 10]]);
    const t = timelineOf([lane]);
    const copied = copyMediaClips(t, [lane.clips[0].id]);
    const result = pasteMediaClips(t, copied, 5, 15);
    expect(result.clipIds).toEqual([]);
    expect(result.timeline).toBe(t);
  });

  it("keeps a multi-lane copy's spacing and puts each clip back on its lane", () => {
    const a = laneWith([[0, 4]], "Layer 1");
    const b = laneWith([[6, 8]], "Layer 2");
    const t = timelineOf([a, b]);
    const copied = copyMediaClips(t, [a.clips[0].id, b.clips[0].id]);
    const { timeline } = pasteMediaClips(t, copied, 20, 60);
    const newA = timeline.lanes[0].clips.find((c) => c.start === 20)!;
    const newB = timeline.lanes[1].clips.find((c) => c.start === 26)!;
    expect(newA.end).toBe(24);
    expect(newB.end).toBe(28);
  });

  it("drops entries whose lane is gone", () => {
    const a = laneWith([[0, 4]], "Layer 1");
    const b = laneWith([[6, 8]], "Layer 2");
    const t = timelineOf([a, b]);
    const copied = copyMediaClips(t, [a.clips[0].id, b.clips[0].id]);
    const { timeline, clipIds } = pasteMediaClips(
      timelineOf([b]),
      copied,
      20,
      60,
    );
    expect(clipIds).toHaveLength(1);
    expect(timeline.lanes[0].clips.some((c) => c.start === 26)).toBe(true);
  });
});
