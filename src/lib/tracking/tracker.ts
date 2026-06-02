import type {
  FrameBox,
  TrackBox,
  TrackingFrame,
  TrackingParams,
  TrackingState,
} from "./types";

const HEX = "0123456789ABCDEF";
const STATUS = ["TRACK", "ACQ", "LOCK", "SCAN", "TRACE", "SYNC"];

/** Deterministic 0..1 hash of two integers. */
function hash2(a: number, b: number): number {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ ((b | 0) + 0x165667b1), 0xc2b2ae35);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1 for a given seed over continuous t. */
function noise1(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = hash2(seed, i);
  const b = hash2(seed, i + 1);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

function hexId(seed: number, key: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += HEX[Math.floor(hash2(seed + key * 17, i) * 16)];
  }
  return s;
}

export function readTrackingParams(
  v: Record<string, number | string>,
): TrackingParams {
  const num = (key: string, d: number) =>
    typeof v[key] === "number" ? (v[key] as number) : d;
  const str = (key: string, d: string) =>
    typeof v[key] === "string" ? (v[key] as string) : d;
  return {
    count: Math.max(1, Math.round(num("count", 8))),
    sensitivity: num("sensitivity", 0.5),
    size: num("size", 0.12),
    jitter: num("jitter", 0.4),
    glitchJump: num("glitchJump", 0.3),
    scramble: num("scramble", 0.5),
    thickness: num("thickness", 2),
    opacity: num("opacity", 1),
    lineMode: str("lineMode", "chain") as TrackingParams["lineMode"],
    color: str("color", "white") as TrackingParams["color"],
    showConfidence: num("showConfidence", 0) > 0.5,
    seed: Math.round(num("seed", 42)),
  };
}

function placementSignature(p: TrackingParams): string {
  return `${p.count}|${p.sensitivity.toFixed(3)}|${p.size.toFixed(3)}|${p.seed}`;
}

/**
 * Rebuild the persistent box set from the current salient points when the
 * placement params changed, the box set is empty, or new saliency arrived.
 * Identities (hex) are derived from seed+slot so they stay stable across
 * re-analysis as long as the count is unchanged.
 */
export function syncBoxes(
  state: TrackingState,
  params: TrackingParams,
  time: number,
  salUpdated: boolean,
): void {
  const sig = placementSignature(params);
  const needsRebuild =
    salUpdated || state.signature !== sig || state.boxes.length === 0;
  if (!needsRebuild) return;

  const pts = state.salPoints;
  const boxes: TrackBox[] = [];
  for (let k = 0; k < pts.length && k < params.count; k++) {
    const pt = pts[k];
    const sizeVar = 0.6 + hash2(params.seed + k, 3) * 0.9;
    const aspect = 0.7 + hash2(params.seed + k, 5) * 0.6;
    const w = params.size * sizeVar;
    const h = w * aspect;
    const prev = state.boxes[k];
    boxes.push({
      key: k,
      hex: hexId(params.seed, k),
      baseX: pt.x,
      baseY: pt.y,
      w,
      h,
      jumpSeed: 1013 + params.seed * 31 + k * 101,
      conf: 0.62 + hash2(params.seed + k, 7) * 0.37,
      acquiredAt: prev ? prev.acquiredAt : time,
    });
  }
  state.boxes = boxes;
  state.signature = sig;
}

function scramble(
  str: string,
  key: number,
  time: number,
  rate: number,
): string {
  if (rate <= 0) return str;
  const bucket = Math.floor(time * (2 + rate * 22));
  let out = "";
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === " " || c === ":" || c === "#" || c === "." || c === "x") {
      out += c;
      continue;
    }
    if (hash2(bucket * 7 + key, i) < rate * 0.45) {
      out += HEX[Math.floor(hash2(i * 3 + bucket, key) * 16)];
    } else {
      out += c;
    }
  }
  return out;
}

function pad(n: number, width: number): string {
  const s = Math.abs(Math.round(n)).toString();
  return s.padStart(width, "0");
}

/** Resolve every persistent box into a drawable frame (jitter + glitch + labels). */
export function resolveFrame(
  state: TrackingState,
  params: TrackingParams,
  time: number,
  imgW: number,
  imgH: number,
): TrackingFrame {
  const boxes: FrameBox[] = [];
  const margin = 0.02;

  for (const box of state.boxes) {
    // Smooth micro-jitter around the locked spot.
    const amp = params.jitter * 0.045;
    let cx = box.baseX + (noise1(box.jumpSeed, time * 5.5) - 0.5) * amp;
    let cy = box.baseY + (noise1(box.jumpSeed + 31, time * 5.5) - 0.5) * amp;

    // Occasional glitch-jump: a brief, large offset to a random direction.
    const jumpRate = 0.6 + params.glitchJump * 7;
    const bucket = Math.floor(time * jumpRate + box.jumpSeed);
    const jumped = hash2(box.jumpSeed, bucket) < params.glitchJump * 0.5;
    if (jumped) {
      cx += (hash2(bucket, box.jumpSeed + 3) - 0.5) * 0.18;
      cy += (hash2(bucket, box.jumpSeed + 9) - 0.5) * 0.18;
    }

    cx = Math.min(1 - margin, Math.max(margin, cx));
    cy = Math.min(1 - margin, Math.max(margin, cy));

    // Status word cycles; glitch-jumps read as a brief re-acquire.
    const statusIdx =
      Math.floor(time * 0.8 + box.key) % STATUS.length;
    const status = jumped ? "ACQ" : STATUS[statusIdx];

    let label = `#${box.hex} ${status}`;
    if (params.showConfidence) label += ` ${box.conf.toFixed(2)}`;
    let sub = `X:${pad(cx * imgW, 4)} Y:${pad(cy * imgH, 4)}`;

    label = scramble(label, box.key, time, params.scramble);
    sub = scramble(sub, box.key + 5, time, params.scramble);

    const age = time - box.acquiredAt;
    const alpha = Math.min(1, Math.max(0, age / 0.35));

    boxes.push({ cx, cy, w: box.w, h: box.h, label, sub, alpha });
  }

  return { boxes, lines: buildLines(boxes, params) };
}

function buildLines(
  boxes: FrameBox[],
  params: TrackingParams,
): [number, number][] {
  if (params.lineMode === "none" || boxes.length < 2) return [];

  if (params.lineMode === "chain") {
    const lines: [number, number][] = [];
    for (let i = 0; i < boxes.length - 1; i++) lines.push([i, i + 1]);
    return lines;
  }

  // Mesh: connect each box to its nearest neighbour (deduped).
  const seen = new Set<string>();
  const lines: [number, number][] = [];
  for (let i = 0; i < boxes.length; i++) {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < boxes.length; j++) {
      if (j === i) continue;
      const dx = boxes[i].cx - boxes[j].cx;
      const dy = boxes[i].cy - boxes[j].cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) continue;
    const key = i < best ? `${i}-${best}` : `${best}-${i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push([i, best]);
  }
  return lines;
}
