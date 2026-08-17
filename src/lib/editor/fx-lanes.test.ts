import { describe, expect, test } from "bun:test";
import type { EffectInstance } from "../effects";
import {
  appendFxLane,
  createFxLane,
  findFxClip,
  normalizeFxLanes,
  resolveFxEffectsAt,
  type FxClip,
  type FxLane,
} from "./fx-lanes";

function fx(id: string): EffectInstance {
  return {
    instanceId: id,
    defId: id,
    enabled: true,
    locked: false,
    expanded: false,
    values: {},
  } as EffectInstance;
}

function clip(id: string, start: number, end: number, effects: string[]): FxClip {
  return { id, start, end, label: id, effects: effects.map(fx) };
}

function lane(id: string, clips: FxClip[], enabled = true): FxLane {
  return { id, name: id, enabled, clips };
}

describe("resolveFxEffectsAt", () => {
  test("returns nothing when no lane covers the time", () => {
    const lanes = [lane("a", [clip("c1", 2, 3, ["blur"])])];
    expect(resolveFxEffectsAt(lanes, 1)).toEqual([]);
    expect(resolveFxEffectsAt(lanes, 3)).toEqual([]);
  });

  test("clips are half-open: start is inside, end is not", () => {
    const lanes = [lane("a", [clip("c1", 1, 2, ["blur"])])];
    expect(resolveFxEffectsAt(lanes, 1).map((e) => e.defId)).toEqual(["blur"]);
    expect(resolveFxEffectsAt(lanes, 2)).toEqual([]);
  });

  test("stacks lanes in order, which is chain order", () => {
    const lanes = [
      lane("a", [clip("c1", 0, 5, ["grain"])]),
      lane("b", [clip("c2", 0, 5, ["shift", "invert"])]),
    ];
    expect(resolveFxEffectsAt(lanes, 1).map((e) => e.defId)).toEqual([
      "grain",
      "shift",
      "invert",
    ]);
  });

  test("a disabled lane contributes nothing but keeps its clips", () => {
    const lanes = [
      lane("a", [clip("c1", 0, 5, ["grain"])], false),
      lane("b", [clip("c2", 0, 5, ["shift"])]),
    ];
    expect(resolveFxEffectsAt(lanes, 1).map((e) => e.defId)).toEqual(["shift"]);
    expect(lanes[0].clips).toHaveLength(1);
  });

  test("the empty result is shared, so quiet frames don't churn identity", () => {
    const lanes = [lane("a", [clip("c1", 2, 3, ["blur"])])];
    expect(resolveFxEffectsAt(lanes, 0)).toBe(resolveFxEffectsAt(lanes, 1));
    expect(resolveFxEffectsAt([], 0)).toBe(resolveFxEffectsAt(null, 0));
  });

  test("a forced clip contributes even when the playhead is past it", () => {
    const lanes = [lane("a", [clip("c1", 0, 1, ["grain"]), clip("c2", 4, 5, ["blur"])])];
    expect(resolveFxEffectsAt(lanes, 9, { forceClipId: "c2" }).map((e) => e.defId)).toEqual(
      ["blur"],
    );
  });

  test("a forced clip replaces its own lane's clip, never doubling it", () => {
    const lanes = [lane("a", [clip("c1", 0, 5, ["grain"]), clip("c2", 5, 9, ["blur"])])];
    // Playhead sits on c1, but c2 is the one being edited.
    expect(resolveFxEffectsAt(lanes, 1, { forceClipId: "c2" }).map((e) => e.defId)).toEqual(
      ["blur"],
    );
  });

  test("forcing a clip leaves other lanes reading the playhead", () => {
    const lanes = [
      lane("a", [clip("c1", 8, 9, ["blur"])]),
      lane("b", [clip("c2", 0, 5, ["shift"])]),
    ];
    expect(resolveFxEffectsAt(lanes, 1, { forceClipId: "c1" }).map((e) => e.defId)).toEqual(
      ["blur", "shift"],
    );
  });

  test("two lanes may run the same effect — instances stay distinct", () => {
    const lanes = [
      lane("a", [{ ...clip("c1", 0, 5, []), effects: [fx("echo")] }]),
      lane("b", [
        { ...clip("c2", 0, 5, []), effects: [{ ...fx("echo"), instanceId: "echo-2" }] },
      ]),
    ];
    const out = resolveFxEffectsAt(lanes, 1);
    expect(out.map((e) => e.instanceId)).toEqual(["echo", "echo-2"]);
  });
});

describe("findFxClip", () => {
  test("locates a clip and the lane holding it", () => {
    const lanes = [lane("a", [clip("c1", 0, 1, [])]), lane("b", [clip("c2", 0, 1, [])])];
    expect(findFxClip(lanes, "c2")?.lane.id).toBe("b");
    expect(findFxClip(lanes, "nope")).toBeNull();
    expect(findFxClip(lanes, null)).toBeNull();
  });
});

describe("normalizeFxLanes", () => {
  test("a missing or malformed list normalizes to no lanes", () => {
    expect(normalizeFxLanes(undefined)).toEqual([]);
    expect(normalizeFxLanes({})).toEqual([]);
  });

  test("fills in what a saved lane dropped, and defaults enabled to true", () => {
    const [out] = normalizeFxLanes([{ clips: [{ start: 1, end: 2, effects: [] }] }]);
    expect(out.name).toBe("FX 1");
    expect(out.enabled).toBe(true);
    expect(out.id).toBeTruthy();
    expect(out.clips[0].label).toBe("clean");
    expect(out.clips[0].id).toBeTruthy();
  });

  test("drops clips that carry no chain", () => {
    const [out] = normalizeFxLanes([
      { clips: [{ start: 0, end: 1 }, { start: 1, end: 2, effects: [] }] },
    ]);
    expect(out.clips).toHaveLength(1);
  });
});

describe("appendFxLane", () => {
  test("names each lane after its position", () => {
    const lanes = appendFxLane(appendFxLane([]));
    expect(lanes.map((l) => l.name)).toEqual(["FX 1", "FX 2"]);
    expect(lanes[0].id).not.toBe(lanes[1].id);
  });

  test("a fresh lane starts empty and enabled", () => {
    const l = createFxLane("FX 1");
    expect(l.clips).toEqual([]);
    expect(l.enabled).toBe(true);
  });
});
