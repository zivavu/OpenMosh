/**
 * Edits that belong to a piece of media itself rather than to any one place it
 * is used. A source edited here is edited everywhere it is drawn — the point
 * being that "this clip has a green screen behind it" is a fact about the file,
 * not about the layer that happens to show it.
 */

/** Knocks a flat background colour out of a source. */
export interface ChromaKey {
  enabled: boolean;
  /** The colour to key out, 0..1 per channel. */
  color: { r: number; g: number; b: number };
  /** Chroma distance below which a pixel is fully cut, 0..1. */
  threshold: number;
  /** Width of the soft band above the threshold, 0..1. 0 gives a hard edge. */
  smoothing: number;
  /**
   * How far a pixel's brightness may differ from the key colour's and still be
   * cut, 0..1. 1 ignores brightness entirely, which is what the key did before
   * this existed — and why keying a grey backdrop also took every white and
   * black in the frame: on chroma alone every neutral is the same colour.
   */
  lumaRange: number;
}

/** A rectangle of the source to keep, normalized to its own frame. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/**
 * Longest edge of a stored erase mask, in pixels. The mask rides along in the
 * saved JSON as a data URL, so it is kept small on purpose: an eraser is for
 * taking out a lamp post, not for cutting hair, and a full-resolution PNG per
 * source would dwarf everything else in the save.
 */
export const MASK_MAX = 512;

/** Everything editable about a source, applied wherever it is drawn. */
export interface SourceEdit {
  chromaKey: ChromaKey;
  /** What is left after cropping. Full frame by default. */
  crop: CropRect;
  /**
   * Hand-erased areas, as a PNG data URL: the red channel is coverage, so
   * white keeps a pixel and black takes it out. In *source* space, not crop
   * space, so cropping afterwards doesn't slide the erased parts around.
   *
   * Null when nothing has been erased, which is the common case and worth not
   * paying a texture for.
   */
  mask: string | null;
}

export const DEFAULT_CHROMA_KEY: ChromaKey = {
  enabled: false,
  // Green screen, the colour anyone reaching for this is most likely holding.
  color: { r: 0, g: 1, b: 0 },
  threshold: 0.3,
  smoothing: 0.1,
  // Wide enough for the shadows and hot spots on an unevenly lit backdrop,
  // tight enough that a mid-grey key leaves white and black alone.
  lumaRange: 0.35,
};

export const DEFAULT_SOURCE_EDIT: SourceEdit = {
  chromaKey: DEFAULT_CHROMA_KEY,
  crop: FULL_CROP,
  mask: null,
};

export function createSourceEdit(): SourceEdit {
  return {
    chromaKey: { ...DEFAULT_CHROMA_KEY, color: { ...DEFAULT_CHROMA_KEY.color } },
    crop: { ...FULL_CROP },
    mask: null,
  };
}

/** True when the rectangle keeps the whole frame, so nothing has to be done. */
export function isFullCrop(crop: CropRect | undefined): boolean {
  if (!crop) return true;
  return (
    Math.abs(crop.x) < 1e-4 &&
    Math.abs(crop.y) < 1e-4 &&
    Math.abs(crop.w - 1) < 1e-4 &&
    Math.abs(crop.h - 1) < 1e-4
  );
}

/**
 * True when the edit is the untouched default, so it needn't be stored.
 *
 * Compared in full rather than just on `enabled`: switching the key off while
 * tuning it would otherwise throw the tuning away, and turning it back on would
 * hand back a green screen at the default threshold.
 */
export function isIdleSourceEdit(edit: SourceEdit | undefined): boolean {
  if (!edit) return true;
  const k = edit.chromaKey;
  const d = DEFAULT_CHROMA_KEY;
  return (
    !k.enabled &&
    k.color.r === d.color.r &&
    k.color.g === d.color.g &&
    k.color.b === d.color.b &&
    k.threshold === d.threshold &&
    k.smoothing === d.smoothing &&
    k.lumaRange === d.lumaRange &&
    isFullCrop(edit.crop) &&
    !edit.mask
  );
}

export function normalizeSourceEdit(raw: unknown): SourceEdit {
  const e = (raw ?? {}) as Partial<SourceEdit>;
  const k = (e.chromaKey ?? {}) as Partial<ChromaKey>;
  const c = (k.color ?? {}) as Partial<ChromaKey["color"]>;
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    chromaKey: {
      enabled: !!k.enabled,
      color: {
        r: num(c.r, DEFAULT_CHROMA_KEY.color.r),
        g: num(c.g, DEFAULT_CHROMA_KEY.color.g),
        b: num(c.b, DEFAULT_CHROMA_KEY.color.b),
      },
      threshold: num(k.threshold, DEFAULT_CHROMA_KEY.threshold),
      smoothing: num(k.smoothing, DEFAULT_CHROMA_KEY.smoothing),
      lumaRange: num(k.lumaRange, DEFAULT_CHROMA_KEY.lumaRange),
    },
    crop: normalizeCrop(e.crop),
    // Only a data URL is any use to the loader; anything else is dropped rather
    // than handed to an <img> that will fail asynchronously.
    mask:
      typeof e.mask === "string" && e.mask.startsWith("data:") ? e.mask : null,
  };
}

function normalizeCrop(raw: unknown): CropRect {
  const c = (raw ?? {}) as Partial<CropRect>;
  const n = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;
  const x = Math.min(Math.max(n(c.x, 0), 0), 1);
  const y = Math.min(Math.max(n(c.y, 0), 0), 1);
  return {
    x,
    y,
    // Clamped against the origin, so a saved rectangle can never reach past the
    // frame and leave the placement sampling outside the texture.
    w: Math.min(Math.max(n(c.w, 1), 0.01), 1 - x),
    h: Math.min(Math.max(n(c.h, 1), 0.01), 1 - y),
  };
}

/** Drops idle entries from a restored map. */
export function normalizeSourceEdits(
  raw: unknown,
): Record<string, SourceEdit> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, SourceEdit> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const edit = normalizeSourceEdit(value);
    if (!isIdleSourceEdit(edit)) out[id] = edit;
  }
  return out;
}
