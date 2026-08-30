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

/**
 * One keyed value, stamped in seconds into the *source's own* media time —
 * not the timeline's. An edit is a fact about the file, so a key set 2.4s into
 * a clip lands at that same instant everywhere the clip is used: under a
 * segment, on a layer whose clip starts partway in, on two lanes at once.
 */
export interface Keyframe<T> {
  t: number;
  v: T;
}

/**
 * Where the erase mask sits at a given moment, relative to how it was painted.
 * `x`/`y` are in source-space units (1 = the whole frame), `scale` is about the
 * mask's own centre.
 *
 * The mask keeps one painted shape and moves it, rather than holding a repaint
 * per key: two painted blobs have no meaningful in-between — cross-fading them
 * shows both at half strength, which reads as ghosting rather than as motion —
 * while a shape that slides and grows covers the thing this is actually for,
 * which is a pan, a tracking shot or an object coming closer.
 */
export interface MaskTransform {
  x: number;
  y: number;
  scale: number;
}

export const IDENTITY_MASK_TRANSFORM: MaskTransform = { x: 0, y: 0, scale: 1 };

/** The key's tunable part. `enabled` never animates: a key is on or it isn't. */
export type AnimatedKey = Omit<ChromaKey, "enabled">;

/** Keyed tracks over a source's own time. An absent track is simply static. */
export interface SourceEditAnim {
  crop?: Keyframe<CropRect>[];
  key?: Keyframe<AnimatedKey>[];
  mask?: Keyframe<MaskTransform>[];
}

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
  /**
   * Keyed tracks, for sources whose subject moves. Absent on a still edit,
   * which is the common case and costs nothing to sample.
   */
  anim?: SourceEditAnim;
  /**
   * Where the mask sits *now*. Filled in by `sampleSourceEdit`; never stored —
   * a stored edit carries the track and the painted mask, not one moment of it.
   */
  maskTransform?: MaskTransform;
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
    !edit.mask &&
    !hasAnimation(edit)
  );
}

/** True when any track carries a key, so the edit varies over the clip. */
export function hasAnimation(edit: SourceEdit | undefined): boolean {
  const a = edit?.anim;
  if (!a) return false;
  return !!a.crop?.length || !!a.key?.length || !!a.mask?.length;
}

export function normalizeSourceEdit(raw: unknown): SourceEdit {
  const e = (raw ?? {}) as Partial<SourceEdit>;
  const k = (e.chromaKey ?? {}) as Partial<ChromaKey>;
  const c = (k.color ?? {}) as Partial<ChromaKey["color"]>;
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
    anim: normalizeAnim(e.anim),
    // Only a data URL is any use to the loader; anything else is dropped rather
    // than handed to an <img> that will fail asynchronously.
    mask:
      typeof e.mask === "string" && e.mask.startsWith("data:") ? e.mask : null,
  };
}

function normalizeCrop(raw: unknown): CropRect {
  const c = (raw ?? {}) as Partial<CropRect>;
  return clampCrop({
    x: num(c.x, 0),
    y: num(c.y, 0),
    w: num(c.w, 1),
    h: num(c.h, 1),
  });
}

/** A rectangle forced back inside the frame. Shared with the keyframe blend. */
export function clampCrop(c: CropRect): CropRect {
  const x = Math.min(Math.max(c.x, 0), 1);
  const y = Math.min(Math.max(c.y, 0), 1);
  return {
    x,
    y,
    // Clamped against the origin, so a rectangle can never reach past the frame
    // and leave the placement sampling outside the texture.
    w: Math.min(Math.max(c.w, 0.01), 1 - x),
    h: Math.min(Math.max(c.h, 0.01), 1 - y),
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

// ── Keyframes ──────────────────────────────────────────────────────────────
// Linear between neighbouring keys, held flat before the first and after the
// last. No easing: the tracks here follow something in the footage, and a value
// that eases away from where the subject actually is has to be corrected with
// another key.

/** Two keys are the same key within this many seconds. */
export const KEY_EPSILON = 1e-3;

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

/**
 * The track's value at `time`, or null when the track is empty. Keys are
 * assumed sorted — `putKeyframe` is the only way one gets in.
 */
export function sampleTrack<T>(
  keys: Keyframe<T>[] | undefined,
  time: number,
  blend: (a: T, b: T, k: number) => T,
): T | null {
  if (!keys || keys.length === 0) return null;
  if (keys.length === 1 || time <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (time >= last.t) return last.v;
  // Linear scan: a hand-placed track is a handful of keys, and a binary search
  // would cost more to read than it saves.
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (b.t < time) continue;
    const a = keys[i - 1];
    const span = b.t - a.t;
    return span <= 0 ? b.v : blend(a.v, b.v, (time - a.t) / span);
  }
  return last.v;
}

function blendCrop(a: CropRect, b: CropRect, k: number): CropRect {
  return clampCrop({
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    w: lerp(a.w, b.w, k),
    h: lerp(a.h, b.h, k),
  });
}

function blendKey(a: AnimatedKey, b: AnimatedKey, k: number): AnimatedKey {
  return {
    color: {
      r: lerp(a.color.r, b.color.r, k),
      g: lerp(a.color.g, b.color.g, k),
      b: lerp(a.color.b, b.color.b, k),
    },
    threshold: lerp(a.threshold, b.threshold, k),
    smoothing: lerp(a.smoothing, b.smoothing, k),
    lumaRange: lerp(a.lumaRange, b.lumaRange, k),
  };
}

function blendMaskTransform(
  a: MaskTransform,
  b: MaskTransform,
  k: number,
): MaskTransform {
  return {
    x: lerp(a.x, b.x, k),
    y: lerp(a.y, b.y, k),
    scale: lerp(a.scale, b.scale, k),
  };
}

/**
 * Where in the media `t` really lands, for a source `duration` seconds long.
 *
 * A clip longer than its media loops: the sampler wraps the frame it hands back
 * into [0, duration), so the edit has to be sampled at the same instant or the
 * two come apart. Unwrapped, a keyed edit runs off the end of its track on the
 * first pass and holds its last key for every loop after it — the picture back
 * at the start with the erase mask still parked where it finished.
 *
 * Duration 0 covers images and media not probed yet: they have no instants to
 * wrap into, so the time only has to be non-negative.
 */
export function wrapSourceTime(t: number, duration: number): number {
  if (!(duration > 0)) return Math.max(0, t);
  return ((t % duration) + duration) % duration;
}

/**
 * The edit as it stands at `time` seconds into the source: every track sampled
 * down to a plain value, `anim` dropped. Everything downstream takes one of
 * these and needn't know a track was ever involved.
 *
 * Returns the edit itself when nothing is keyed, so a still edit allocates
 * nothing on the way to the shader.
 */
export function sampleSourceEdit(edit: SourceEdit, time: number): SourceEdit {
  const anim = edit.anim;
  if (!anim || !hasAnimation(edit)) return edit;
  const crop = sampleTrack(anim.crop, time, blendCrop);
  const key = sampleTrack(anim.key, time, blendKey);
  const maskTransform = sampleTrack(anim.mask, time, blendMaskTransform);
  return {
    chromaKey: key
      ? { enabled: edit.chromaKey.enabled, ...key }
      : edit.chromaKey,
    crop: crop ?? edit.crop,
    mask: edit.mask,
    maskTransform: maskTransform ?? undefined,
  };
}

/**
 * The widest and tallest the crop ever gets, as a share of the source. What the
 * renderer sizes its crop buffer from: an animated crop changes shape every
 * frame, and a buffer re-allocated to match would mean a texture and a
 * framebuffer thrown away per frame.
 */
export function cropExtent(edit: SourceEdit): { w: number; h: number } {
  const keys = edit.anim?.crop;
  if (!keys || keys.length === 0) return { w: edit.crop.w, h: edit.crop.h };
  let w = 0;
  let h = 0;
  for (const k of keys) {
    if (k.v.w > w) w = k.v.w;
    if (k.v.h > h) h = k.v.h;
  }
  return { w: Math.min(w, 1), h: Math.min(h, 1) };
}

/**
 * `keys` with `v` set at `time`, replacing the key already there. Returns a new
 * array, sorted, so the caller can hand it straight to an undo snapshot.
 */
export function putKeyframe<T>(
  keys: Keyframe<T>[] | undefined,
  time: number,
  v: T,
): Keyframe<T>[] {
  const t = Math.max(0, time);
  const out = (keys ?? []).filter((k) => Math.abs(k.t - t) > KEY_EPSILON);
  out.push({ t, v });
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** `keys` without the one at `time`, if there is one. */
export function removeKeyframe<T>(
  keys: Keyframe<T>[] | undefined,
  time: number,
): Keyframe<T>[] {
  return (keys ?? []).filter((k) => Math.abs(k.t - time) > KEY_EPSILON);
}

/** The key at `time`, or null. */
export function keyframeAt<T>(
  keys: Keyframe<T>[] | undefined,
  time: number,
): Keyframe<T> | null {
  return (keys ?? []).find((k) => Math.abs(k.t - time) <= KEY_EPSILON) ?? null;
}

function normalizeAnim(raw: unknown): SourceEditAnim | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Partial<SourceEditAnim>;
  const crop = normalizeTrack(a.crop, (v) => normalizeCrop(v));
  const key = normalizeTrack(a.key, normalizeAnimatedKey);
  const mask = normalizeTrack(a.mask, normalizeMaskTransform);
  if (!crop && !key && !mask) return undefined;
  return {
    ...(crop ? { crop } : {}),
    ...(key ? { key } : {}),
    ...(mask ? { mask } : {}),
  };
}

/** Sorted, de-duplicated and dropped entirely when nothing survives. */
function normalizeTrack<T>(
  raw: unknown,
  value: (raw: unknown) => T,
): Keyframe<T>[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  let out: Keyframe<T>[] = [];
  for (const entry of raw) {
    const t = (entry as Partial<Keyframe<T>>)?.t;
    if (typeof t !== "number" || !Number.isFinite(t)) continue;
    out = putKeyframe(out, t, value((entry as Keyframe<T>).v));
  }
  return out.length > 0 ? out : undefined;
}

function normalizeAnimatedKey(raw: unknown): AnimatedKey {
  const k = (raw ?? {}) as Partial<AnimatedKey>;
  const c = (k.color ?? {}) as Partial<ChromaKey["color"]>;
  return {
    color: {
      r: num(c.r, DEFAULT_CHROMA_KEY.color.r),
      g: num(c.g, DEFAULT_CHROMA_KEY.color.g),
      b: num(c.b, DEFAULT_CHROMA_KEY.color.b),
    },
    threshold: num(k.threshold, DEFAULT_CHROMA_KEY.threshold),
    smoothing: num(k.smoothing, DEFAULT_CHROMA_KEY.smoothing),
    lumaRange: num(k.lumaRange, DEFAULT_CHROMA_KEY.lumaRange),
  };
}

function normalizeMaskTransform(raw: unknown): MaskTransform {
  const m = (raw ?? {}) as Partial<MaskTransform>;
  return {
    x: num(m.x, 0),
    y: num(m.y, 0),
    // A mask scaled to nothing erases nothing, which is indistinguishable from
    // a broken save; a floor keeps it recoverable.
    scale: Math.max(num(m.scale, 1), 0.01),
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
