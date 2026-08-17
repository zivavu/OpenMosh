import { describe, expect, test } from "bun:test";
import type { EffectInstance } from "../effects";
import {
  activeFxClips,
  appendFxLane,
  applyBpmToFxLanes,
  clearFxClips,
  createFxLayerSource,
  createFxLane,
  flattenFxLayers,
  fxClipWeight,
  findFxClip,
  fxClipTick,
  normalizeFxLanes,
  rollFxClips,
  setFxClipsMode,
  type FxClip,
  type FxLane,
} from "./fx-lanes";
import type { MoshOptions } from "./mosh";

const OPTIONS: MoshOptions = {
  moshMin: 3,
  moshMax: 6,
  randomizeOrder: true,
  moshAudioLink: false,
  moshAudioLinkStrength: 0,
  hasAudio: false,
};

/** The chain resolver as the preview builds it (no cloning). */
function resolveFxEffectsAt(
  lanes: FxLane[] | null | undefined,
  time: number,
  opts: { forceClipId?: string | null } = {},
) {
  return flattenFxLayers(
    createFxLayerSource(() => lanes, () => OPTIONS)(time, opts.forceClipId),
  );
}

/** Compare two chains by the fields that drive render output. */
function renderShape(effects: EffectInstance[]) {
  return effects.map((e) => ({
    defId: e.defId,
    enabled: e.enabled,
    values: { ...e.values },
  }));
}

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

describe("createFxEffectSource", () => {
  const source = (lanes: FxLane[], clone = false) => {
    const src = createFxLayerSource(() => lanes, () => OPTIONS, { clone });
    return (t: number) => flattenFxLayers(src(t));
  };

  test("clone keeps the export's per-frame values out of the user's clips", () => {
    const lanes = [lane("a", [clip("c1", 0, 5, ["grain"])])];
    const out = source(lanes, true)(1);
    expect(out[0]).not.toBe(lanes[0].clips[0].effects[0]);
    out[0].values.amount = 0.9;
    expect(lanes[0].clips[0].effects[0].values.amount).toBeUndefined();
  });

  test("clones are cached per clip, so a span doesn't re-clone per frame", () => {
    const lanes = [lane("a", [clip("c1", 0, 5, ["grain"])])];
    const src = source(lanes, true);
    expect(src(1)[0]).toBe(src(2)[0]);
  });

  test("without clone the caller sees the live instances", () => {
    const lanes = [lane("a", [clip("c1", 0, 5, ["grain"])])];
    expect(source(lanes)(1)[0]).toBe(lanes[0].clips[0].effects[0]);
  });

  test("no lanes resolves to nothing", () => {
    expect(source([])(1)).toEqual([]);
  });
});

describe("interval clips", () => {
  const auto = (id: string, start: number, end: number, intervalSec: number): FxClip => ({
    id,
    start,
    end,
    label: id,
    mode: "interval",
    seed: 4242,
    intervalSec,
    effects: [],
  });

  const source = (lanes: FxLane[]) => {
    const src = createFxLayerSource(() => lanes, () => OPTIONS);
    return (t: number) => flattenFxLayers(src(t));
  };

  test("tick counts re-rolls from the clip's own start, never below zero", () => {
    const c = auto("c1", 2, 6, 1);
    expect(fxClipTick(c, 2)).toBe(0);
    expect(fxClipTick(c, 2.9)).toBe(0);
    expect(fxClipTick(c, 3)).toBe(1);
    expect(fxClipTick(c, 0)).toBe(0);
  });

  test("the chain holds for a tick and changes at the next one", () => {
    const src = source([lane("a", [auto("c1", 0, 8, 1)])]);
    expect(renderShape(src(0.2))).toEqual(renderShape(src(0.9)));
    expect(renderShape(src(0.2))).not.toEqual(renderShape(src(1.2)));
  });

  test("a second source with the same inputs reproduces the preview exactly", () => {
    const lanes = [lane("a", [auto("c1", 0, 8, 0.5)])];
    const preview = source(lanes);
    const exportSrc = createFxLayerSource(() => lanes, () => OPTIONS, { clone: true });
    const exported = (t: number) => flattenFxLayers(exportSrc(t));
    for (const t of [0.1, 0.7, 1.4, 3.9]) {
      expect(renderShape(exported(t))).toEqual(renderShape(preview(t)));
    }
  });

  test("the same seed and tick give the same roll on a fresh source", () => {
    const lanes = [lane("a", [auto("c1", 0, 8, 1)])];
    expect(renderShape(source(lanes)(2.5))).toEqual(renderShape(source(lanes)(2.5)));
  });
});

describe("fxClipWeight", () => {
  const faded = (fadeSec: number, start = 0, end = 10): FxClip => ({
    ...clip("c1", start, end, []),
    fadeSec,
  });

  test("a clip without a fade is fully applied everywhere", () => {
    const c = clip("c1", 0, 10, []);
    expect(fxClipWeight(c, 0)).toBe(1);
    expect(fxClipWeight(c, 5)).toBe(1);
  });

  test("ramps from 0 at the start to 1 once the fade is done", () => {
    const c = faded(2);
    expect(fxClipWeight(c, 0)).toBe(0);
    expect(fxClipWeight(c, 1)).toBeCloseTo(0.5, 5);
    expect(fxClipWeight(c, 2)).toBe(1);
    expect(fxClipWeight(c, 5)).toBe(1);
  });

  test("ramps back down to 0 at the end", () => {
    const c = faded(2);
    expect(fxClipWeight(c, 8)).toBe(1);
    expect(fxClipWeight(c, 9)).toBeCloseTo(0.5, 5);
    expect(fxClipWeight(c, 10)).toBe(0);
  });

  test("a fade longer than half the clip meets in the middle, never overlapping", () => {
    // 4s clip, 10s fade: the ramps cap at 2s each and peak exactly at centre.
    const c = faded(10, 0, 4);
    expect(fxClipWeight(c, 2)).toBe(1);
    expect(fxClipWeight(c, 1)).toBeCloseTo(0.5, 5);
    expect(fxClipWeight(c, 3)).toBeCloseTo(0.5, 5);
    expect(fxClipWeight(c, 0)).toBe(0);
    expect(fxClipWeight(c, 4)).toBe(0);
  });

  test("never leaves [0, 1], even outside the clip", () => {
    const c = faded(2);
    expect(fxClipWeight(c, -5)).toBe(0);
    expect(fxClipWeight(c, 50)).toBe(0);
  });
});

describe("fade weights in the layer source", () => {
  test("a fading clip reports its ramp, and a plain one reports full", () => {
    const lanes = [
      lane("a", [{ ...clip("c1", 0, 10, ["grain"]), fadeSec: 2 }]),
      lane("b", [clip("c2", 0, 10, ["shift"])]),
    ];
    const at = createFxLayerSource(() => lanes, () => OPTIONS);
    expect(at(1).map((l) => l.weight)).toEqual([0.5, 1]);
    expect(at(5).map((l) => l.weight)).toEqual([1, 1]);
  });

  test("the clip being edited shows at full strength, fade or not", () => {
    const lanes = [lane("a", [{ ...clip("c1", 0, 10, ["grain"]), fadeSec: 2 }])];
    const at = createFxLayerSource(() => lanes, () => OPTIONS);
    expect(at(1, "c1")[0].weight).toBe(1);
    expect(at(1)[0].weight).toBe(0.5);
  });
});

describe("setFxClipsMode", () => {
  test("switching to interval mints a seed and keeps the spacing", () => {
    const lanes = [lane("a", [clip("c1", 0, 5, ["grain"])])];
    const [out] = setFxClipsMode(lanes, new Set(["c1"]), "interval", 0.5, 1);
    expect(out.clips[0].mode).toBe("interval");
    expect(out.clips[0].seed).toBeGreaterThan(0);
    expect(out.clips[0].intervalSec).toBe(0.5);
    expect(out.clips[0].intervalBeats).toBe(1);
  });

  test("a null beat count drops the beat link, so a BPM change won't retime it", () => {
    const lanes = [lane("a", [{ ...clip("c1", 0, 5, []), intervalBeats: 2 }])];
    const [out] = setFxClipsMode(lanes, new Set(["c1"]), "interval", 1, null);
    expect(out.clips[0].intervalBeats).toBeUndefined();
  });

  test("going back to static keeps the chain rather than blanking it", () => {
    const lanes = [lane("a", [clip("c1", 0, 5, ["grain"])])];
    const [out] = setFxClipsMode(lanes, new Set(["c1"]), "static");
    expect(out.clips[0].mode).toBe("static");
    expect(out.clips[0].effects.map((e) => e.defId)).toEqual(["grain"]);
  });

  test("clips outside the selection are untouched, by identity", () => {
    const lanes = [lane("a", [clip("c1", 0, 5, [])]), lane("b", [clip("c2", 0, 5, [])])];
    const out = setFxClipsMode(lanes, new Set(["c1"]), "interval");
    expect(out[1]).toBe(lanes[1]);
  });
});

describe("rollFxClips", () => {
  test("an interval clip gets a new seed, not a new chain", () => {
    const lanes = [
      lane("a", [{ ...clip("c1", 0, 5, ["grain"]), mode: "interval" as const, seed: 1 }]),
    ];
    const [out] = rollFxClips(lanes, new Set(["c1"]), OPTIONS);
    expect(out.clips[0].seed).not.toBe(1);
    expect(out.clips[0].effects.map((e) => e.defId)).toEqual(["grain"]);
  });

  test("a static clip gets a fresh chain and drops its preset link", () => {
    const lanes = [
      lane("a", [{ ...clip("c1", 0, 5, ["grain"]), presetName: "vhs", modified: true }]),
    ];
    const [out] = rollFxClips(lanes, new Set(["c1"]), OPTIONS);
    expect(out.clips[0].label).toBe("mosh");
    expect(out.clips[0].presetName).toBeUndefined();
    expect(out.clips[0].modified).toBe(false);
    expect(out.clips[0].effects.length).toBeGreaterThan(0);
  });
});

describe("clearFxClips", () => {
  test("resets to a static, all-disabled chain", () => {
    const lanes = [
      lane("a", [{ ...clip("c1", 0, 5, ["grain"]), mode: "interval" as const }]),
    ];
    const [out] = clearFxClips(lanes, new Set(["c1"]));
    expect(out.clips[0].mode).toBe("static");
    expect(out.clips[0].label).toBe("clean");
    expect(out.clips[0].effects.every((e) => !e.enabled)).toBe(true);
  });
});

describe("applyBpmToFxLanes", () => {
  test("retimes beat-set clips and leaves second-set ones alone", () => {
    const lanes = [
      lane("a", [
        { ...clip("c1", 0, 5, []), intervalBeats: 1, intervalSec: 0.5 },
        { ...clip("c2", 5, 9, []), intervalSec: 0.25 },
      ]),
    ];
    const [out] = applyBpmToFxLanes(lanes, 120);
    expect(out.clips[0].intervalSec).toBeCloseTo(0.5, 5);
    expect(out.clips[1].intervalSec).toBe(0.25);

    const [changed] = applyBpmToFxLanes(lanes, 60);
    expect(changed.clips[0].intervalSec).toBeCloseTo(1, 5);
  });

  test("returns the input by identity when nothing moves", () => {
    const lanes = [lane("a", [clip("c1", 0, 5, [])])];
    expect(applyBpmToFxLanes(lanes, 120)).toBe(lanes);
    expect(applyBpmToFxLanes(lanes, 0)).toBe(lanes);
  });
});

describe("activeFxClips", () => {
  test("returns the contributing clips in lane order", () => {
    const lanes = [
      lane("a", [clip("c1", 0, 5, [])]),
      lane("b", [clip("c2", 0, 5, [])], false),
      lane("c", [clip("c3", 0, 5, [])]),
    ];
    expect(activeFxClips(lanes, 1).map((c) => c.id)).toEqual(["c1", "c3"]);
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
