/** The defId this overlay effect is registered under in EFFECT_DEFINITIONS. */
export const TRACKING_EFFECT_ID = "tracking";

export interface TrackingParams {
  /** Max number of tracking boxes. */
  count: number;
  /** 0..1 — how selective the saliency picker is (higher = only strongest spots). */
  sensitivity: number;
  /** Base box size as a fraction of the smaller image dimension. */
  size: number;
  /** 0..1 — micro-jitter amplitude. */
  jitter: number;
  /** 0..1 — frequency/strength of occasional glitch-jumps. */
  glitchJump: number;
  /** 0..1 — how fast the data labels scramble. */
  scramble: number;
  /** Stroke width, in px at a 720px reference height (scaled to actual size). */
  thickness: number;
  /** 0..1 overall overlay opacity. */
  opacity: number;
  lineMode: "chain" | "mesh" | "none";
  color: "white" | "black";
  /** When true, append a fake confidence value to each label. */
  showConfidence: boolean;
  /** Stable seed for ids/placement variation. */
  seed: number;
}

/** A salient point in normalized coords (x: left→right, y: top→bottom). */
export interface SalPoint {
  x: number;
  y: number;
  score: number;
}

/** A persistent tracked box (locked spot + identity), independent of per-frame jitter. */
export interface TrackBox {
  /** Stable slot index, used to derive deterministic noise/ids. */
  key: number;
  /** 4-char hex identity shown in the label. */
  hex: string;
  /** Locked normalized center the box jitters around. */
  baseX: number;
  baseY: number;
  /** Normalized box size. */
  w: number;
  h: number;
  /** Per-box noise seed. */
  jumpSeed: number;
  /** Fake confidence (stable per box). */
  conf: number;
  /** Animation-time the box was (re)acquired, for fade-in. */
  acquiredAt: number;
}

export interface TrackingState {
  boxes: TrackBox[];
  salPoints: SalPoint[];
  /** Animation-time of the last saliency analysis (-1 = never). */
  lastAnalyze: number;
  /** Signature of placement-affecting params; change forces re-acquire. */
  signature: string;
}

/** A box resolved for the current frame (jitter + glitch applied). */
export interface FrameBox {
  /** Normalized center incl. jitter/glitch. */
  cx: number;
  cy: number;
  w: number;
  h: number;
  /** Primary label line (id + status). */
  label: string;
  /** Secondary label line (coords / dims). */
  sub: string;
  /** 0..1 fade-in alpha. */
  alpha: number;
}

export interface TrackingFrame {
  boxes: FrameBox[];
  /** Index pairs into `boxes` describing connecting lines. */
  lines: [number, number][];
}
