import { describe, expect, it } from "bun:test";
import {
  createSourceEdit,
  DEFAULT_CHROMA_KEY,
  isFullCrop,
  isIdleSourceEdit,
  normalizeSourceEdit,
  normalizeSourceEdits,
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
