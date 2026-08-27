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
}

/** Everything editable about a source. One field for now; more will join it. */
export interface SourceEdit {
  chromaKey: ChromaKey;
}

export const DEFAULT_CHROMA_KEY: ChromaKey = {
  enabled: false,
  // Green screen, the colour anyone reaching for this is most likely holding.
  color: { r: 0, g: 1, b: 0 },
  threshold: 0.3,
  smoothing: 0.1,
};

export const DEFAULT_SOURCE_EDIT: SourceEdit = {
  chromaKey: DEFAULT_CHROMA_KEY,
};

export function createSourceEdit(): SourceEdit {
  return {
    chromaKey: { ...DEFAULT_CHROMA_KEY, color: { ...DEFAULT_CHROMA_KEY.color } },
  };
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
    k.smoothing === d.smoothing
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
    },
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
