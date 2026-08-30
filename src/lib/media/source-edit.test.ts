import { describe, expect, it } from "bun:test";
import {
  createSourceEdit,
  cropExtent,
  DEFAULT_CHROMA_KEY,
  isFullCrop,
  isIdleSourceEdit,
  keyframeAt,
  normalizeSourceEdit,
  normalizeSourceEdits,
  putKeyframe,
  removeKeyframe,
  sampleSourceEdit,
  wrapSourceTime,
} from "./source-edit";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("crop", () => {
  it("starts on the whole frame", () => {
    expect(isFullCrop(createSourceEdit().crop)).toBe(true);
  });

  it("keeps a saved rectangle inside the frame", () => {
    const e = normalizeSourceEdit({ crop: { x: 0.8, y: 0.9, w: 1, h: 1 } });
    // Clamped against its own origin: a rectangle reaching past the edge would
    // leave the placement sampling outside the texture.
    expect(e.crop.x + e.crop.w).toBeCloseTo(1, 5);
    expect(e.crop.y + e.crop.h).toBeCloseTo(1, 5);
  });

  it("refuses a degenerate rectangle", () => {
    const e = normalizeSourceEdit({ crop: { x: 0.5, y: 0.5, w: 0, h: -3 } });
    expect(e.crop.w).toBeGreaterThan(0);
    expect(e.crop.h).toBeGreaterThan(0);
  });

  it("falls back to the whole frame on junk", () => {
    expect(isFullCrop(normalizeSourceEdit({ crop: "nope" }).crop)).toBe(true);
    expect(isFullCrop(normalizeSourceEdit({}).crop)).toBe(true);
  });
});

describe("mask", () => {
  it("keeps a data URL and drops anything else", () => {
    expect(normalizeSourceEdit({ mask: PNG }).mask).toBe(PNG);
    // An <img> handed a bare path fails asynchronously, long after the load
    // that would have reported it.
    expect(normalizeSourceEdit({ mask: "/masks/1.png" }).mask).toBeNull();
    expect(normalizeSourceEdit({ mask: 42 }).mask).toBeNull();
  });
});

describe("isIdleSourceEdit", () => {
  it("counts a crop or a mask as work worth storing", () => {
    expect(isIdleSourceEdit(createSourceEdit())).toBe(true);

    const cropped = createSourceEdit();
    cropped.crop = { x: 0.1, y: 0, w: 0.5, h: 1 };
    expect(isIdleSourceEdit(cropped)).toBe(false);

    const erased = createSourceEdit();
    erased.mask = PNG;
    expect(isIdleSourceEdit(erased)).toBe(false);
  });

  it("still counts a tuned but switched-off key", () => {
    const tuned = createSourceEdit();
    tuned.chromaKey = { ...DEFAULT_CHROMA_KEY, threshold: 0.7 };
    expect(isIdleSourceEdit(tuned)).toBe(false);
  });
});

describe("normalizeSourceEdits", () => {
  it("keeps a cropped-only entry and drops untouched ones", () => {
    const map = normalizeSourceEdits({
      a: { crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } },
      b: {},
    });
    expect(Object.keys(map)).toEqual(["a"]);
    expect(map.a.crop.w).toBe(0.5);
  });
});

describe("keyframes", () => {
  const at = (t: number, x: number) => ({ t, v: { x, y: 0, w: 0.5, h: 0.5 } });

  it("holds flat before the first key and after the last", () => {
    const e = createSourceEdit();
    e.anim = { crop: [at(1, 0.2), at(3, 0.4)] };
    expect(sampleSourceEdit(e, 0).crop.x).toBeCloseTo(0.2, 5);
    expect(sampleSourceEdit(e, 99).crop.x).toBeCloseTo(0.4, 5);
  });

  it("interpolates between two keys", () => {
    const e = createSourceEdit();
    e.anim = { crop: [at(1, 0.2), at(3, 0.4)] };
    expect(sampleSourceEdit(e, 2).crop.x).toBeCloseTo(0.3, 5);
  });

  it("leaves a still edit exactly as it is", () => {
    const e = createSourceEdit();
    expect(sampleSourceEdit(e, 5)).toBe(e);
  });

  it("keeps the key's on/off state out of the interpolation", () => {
    const e = createSourceEdit();
    e.chromaKey.enabled = true;
    e.anim = {
      key: [
        { t: 0, v: { ...DEFAULT_CHROMA_KEY, threshold: 0.1 } },
        { t: 2, v: { ...DEFAULT_CHROMA_KEY, threshold: 0.5 } },
      ],
    };
    const mid = sampleSourceEdit(e, 1);
    expect(mid.chromaKey.threshold).toBeCloseTo(0.3, 5);
    expect(mid.chromaKey.enabled).toBe(true);
  });

  it("moves the mask rather than repainting it", () => {
    const e = createSourceEdit();
    e.mask = PNG;
    e.anim = {
      mask: [
        { t: 0, v: { x: 0, y: 0, scale: 1 } },
        { t: 2, v: { x: 0.4, y: 0.2, scale: 2 } },
      ],
    };
    const mid = sampleSourceEdit(e, 1);
    expect(mid.mask).toBe(PNG);
    expect(mid.maskTransform).toEqual({ x: 0.2, y: 0.1, scale: 1.5 });
  });

  it("keeps an interpolated rectangle inside the frame", () => {
    const e = createSourceEdit();
    e.anim = {
      crop: [
        { t: 0, v: { x: 0, y: 0, w: 1, h: 1 } },
        { t: 2, v: { x: 0.9, y: 0.9, w: 1, h: 1 } },
      ],
    };
    const mid = sampleSourceEdit(e, 1);
    expect(mid.crop.x + mid.crop.w).toBeLessThanOrEqual(1.0001);
    expect(mid.crop.y + mid.crop.h).toBeLessThanOrEqual(1.0001);
  });

  it("replaces the key already at a time and stays sorted", () => {
    let keys = putKeyframe<number>(undefined, 2, 20);
    keys = putKeyframe(keys, 1, 10);
    keys = putKeyframe(keys, 2, 99);
    expect(keys.map((k) => k.t)).toEqual([1, 2]);
    expect(keys.map((k) => k.v)).toEqual([10, 99]);
    expect(keyframeAt(keys, 2)?.v).toBe(99);
    expect(removeKeyframe(keys, 2)).toHaveLength(1);
  });

  it("sizes the crop buffer from the widest key, not the current one", () => {
    const e = createSourceEdit();
    e.anim = { crop: [at(0, 0), { t: 2, v: { x: 0, y: 0, w: 0.8, h: 0.9 } }] };
    expect(cropExtent(e)).toEqual({ w: 0.8, h: 0.9 });
  });

  it("counts a keyed edit as worth storing, and restores its tracks", () => {
    const e = createSourceEdit();
    e.anim = { crop: [at(1, 0.2)] };
    expect(isIdleSourceEdit(e)).toBe(false);

    const back = normalizeSourceEdit(JSON.parse(JSON.stringify(e)));
    expect(back.anim?.crop).toHaveLength(1);
    expect(back.anim?.crop?.[0].t).toBe(1);
  });

  it("drops junk keys and sorts what is left", () => {
    const back = normalizeSourceEdit({
      anim: {
        crop: [
          { t: 3, v: { x: 0.3, y: 0, w: 0.5, h: 0.5 } },
          { t: "nope", v: {} },
          { t: 1, v: { x: 0.1, y: 0, w: 0.5, h: 0.5 } },
        ],
        key: [],
      },
    });
    expect(back.anim?.crop?.map((k) => k.t)).toEqual([1, 3]);
    // An empty track is no track at all.
    expect(back.anim?.key).toBeUndefined();
  });
});

describe("wrapSourceTime", () => {
  it("leaves a time inside the media alone", () => {
    expect(wrapSourceTime(2.5, 6)).toBe(2.5);
  });

  it("wraps a looped clip back into the media, as the sampler does", () => {
    // A 6s video under a 20s segment: at 14s the sampler is showing second 2,
    // so the edit has to be sampled there too. Unwrapped it sat past the last
    // key for every loop after the first.
    expect(wrapSourceTime(14, 6)).toBeCloseTo(2, 10);
  });

  it("has no instants to wrap into without a duration", () => {
    expect(wrapSourceTime(14, 0)).toBe(14);
    expect(wrapSourceTime(-3, 0)).toBe(0);
  });

  it("keeps a keyed mask moving on every loop", () => {
    const edit = {
      ...createSourceEdit(),
      mask: PNG,
      anim: {
        mask: [
          { t: 0, v: { x: 0, y: 0, scale: 1 } },
          { t: 4, v: { x: 0.4, y: 0, scale: 1 } },
        ],
      },
    };
    const at = (t: number) =>
      sampleSourceEdit(edit, wrapSourceTime(t, 6)).maskTransform?.x;
    expect(at(2)).toBeCloseTo(0.2, 10);
    // Second time around the clip, not stuck on the last key.
    expect(at(8)).toBeCloseTo(0.2, 10);
  });
});

describe("keyed erase masks", () => {
  const PNG_B = "data:image/png;base64,AAAAAA==";
  const edit = {
    ...createSourceEdit(),
    mask: PNG,
    anim: {
      mask: [
        { t: 0, v: { x: 0, y: 0, scale: 1, mask: PNG } },
        { t: 4, v: { x: 0.4, y: 0, scale: 1, mask: PNG_B } },
      ],
    },
  };

  it("holds each key's shape until the next one", () => {
    // Not a cross-fade: halfway between the keys the first shape still stands,
    // whole, rather than two paintings at half strength.
    expect(sampleSourceEdit(edit, 0).mask).toBe(PNG);
    expect(sampleSourceEdit(edit, 2).mask).toBe(PNG);
    expect(sampleSourceEdit(edit, 3.99).mask).toBe(PNG);
    expect(sampleSourceEdit(edit, 4).mask).toBe(PNG_B);
    expect(sampleSourceEdit(edit, 9).mask).toBe(PNG_B);
  });

  it("still blends where the shape sits", () => {
    expect(sampleSourceEdit(edit, 2).maskTransform?.x).toBeCloseTo(0.2, 10);
  });

  it("lets a key erase nothing", () => {
    const off = {
      ...createSourceEdit(),
      mask: PNG,
      anim: { mask: [{ t: 2, v: { x: 0, y: 0, scale: 1, mask: null } }] },
    };
    expect(sampleSourceEdit(off, 3).mask).toBeNull();
  });

  it("leaves the stored shape standing for a key that carries none", () => {
    const moved = {
      ...createSourceEdit(),
      mask: PNG,
      anim: { mask: [{ t: 0, v: { x: 0.2, y: 0, scale: 1 } }] },
    };
    expect(sampleSourceEdit(moved, 1).mask).toBe(PNG);
  });

  it("keeps a keyed shape across a save", () => {
    const back = normalizeSourceEdit(edit);
    expect(back.anim?.mask?.[1].v.mask).toBe(PNG_B);
    expect(back.anim?.mask?.[0].v.x).toBe(0);
  });
});
