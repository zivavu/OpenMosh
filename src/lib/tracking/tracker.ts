import type {
  FrameBox,
  SalPoint,
  TrackBox,
  TrackingFrame,
  TrackingParams,
  TrackingState,
} from "./types";

const HEX = "0123456789ABCDEF";

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
 * placement params changed or the box set is empty. Boxes otherwise persist —
 * their motion is owned by trackBoxes. Identities (hex) are derived from
 * seed+slot so they stay stable across rebuilds with the same count.
 */
export function syncBoxes(
  state: TrackingState,
  params: TrackingParams,
  time: number,
): void {
  const sig = placementSignature(params);
  const needsRebuild = state.signature !== sig || state.boxes.length === 0;
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
      drawX: pt.x,
      drawY: pt.y,
      w,
      h,
      jumpSeed: 1013 + params.seed * 31 + k * 101,
      conf: 0.5,
      acquiredAt: prev ? prev.acquiredAt : time,
    });
  }
  state.boxes = boxes;
  state.signature = sig;
}

const PATCH_R = 3; // 7x7-cell template
const SEARCH_R = 5; // +/- cells searched around the last position
const LOST_CONF = 0.18;

/**
 * Real frame-to-frame tracking: each box's luminance patch (from the previous
 * grid, at its previous position) is matched against the new grid within a
 * local search window (SSD). The box moves to the best match; confidence is
 * derived from the residual error. Boxes that genuinely lose their content
 * re-acquire onto an unclaimed salient point.
 */
export function trackBoxes(
  state: TrackingState,
  params: TrackingParams,
  lum: Float32Array,
  gw: number,
  gh: number,
  time: number,
): void {
  const prev = state.prevLum;
  if (prev && state.gridW === gw && state.gridH === gh) {
    for (const box of state.boxes) {
      const px = clampCell(Math.round(box.baseX * (gw - 1)), gw);
      const py = clampCell(Math.round(box.baseY * (gh - 1)), gh);
      let bestErr = Infinity;
      let bestX = px;
      let bestY = py;
      for (let dy = -SEARCH_R; dy <= SEARCH_R; dy++) {
        for (let dx = -SEARCH_R; dx <= SEARCH_R; dx++) {
          const cx = px + dx;
          const cy = py + dy;
          if (
            cx < PATCH_R ||
            cy < PATCH_R ||
            cx >= gw - PATCH_R ||
            cy >= gh - PATCH_R
          ) {
            continue;
          }
          let err = 0;
          for (let oy = -PATCH_R; oy <= PATCH_R; oy++) {
            for (let ox = -PATCH_R; ox <= PATCH_R; ox++) {
              const d =
                prev[(py + oy) * gw + (px + ox)] -
                lum[(cy + oy) * gw + (cx + ox)];
              err += d * d;
            }
          }
          // Tiny bias toward staying put so flat regions don't wander.
          err += (dx * dx + dy * dy) * 0.0004;
          if (err < bestErr) {
            bestErr = err;
            bestX = cx;
            bestY = cy;
          }
        }
      }
      if (bestErr < Infinity) {
        const n = (PATCH_R * 2 + 1) * (PATCH_R * 2 + 1);
        const rmse = Math.sqrt(bestErr / n);
        const conf = Math.max(0, Math.min(1, 1 - rmse * 6));
        box.conf = box.conf * 0.7 + conf * 0.3;
        box.baseX = bestX / (gw - 1);
        box.baseY = bestY / (gh - 1);
      }
      if (box.conf < LOST_CONF) {
        reacquire(box, state, time);
      }
    }
  }
  // Store the new grid for the next tick (copy: the RGBA buffer is reused).
  state.prevLum = lum.slice();
  state.gridW = gw;
  state.gridH = gh;
}

function clampCell(c: number, size: number): number {
  return Math.min(size - 1 - PATCH_R, Math.max(PATCH_R, c));
}

/** Move a lost box onto the strongest salient point no other box claims. */
function reacquire(box: TrackBox, state: TrackingState, time: number): void {
  let best: SalPoint | null = null;
  for (const pt of state.salPoints) {
    let claimed = false;
    for (const other of state.boxes) {
      if (other === box) continue;
      const dx = other.baseX - pt.x;
      const dy = other.baseY - pt.y;
      if (dx * dx + dy * dy < 0.01) {
        claimed = true;
        break;
      }
    }
    if (!claimed) {
      best = pt;
      break; // salPoints are sorted strongest-first
    }
  }
  if (!best) return;
  box.baseX = best.x;
  box.baseY = best.y;
  box.drawX = best.x;
  box.drawY = best.y;
  box.conf = 0.5;
  box.acquiredAt = time;
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
    // Ease the display position toward the tracked spot (analysis is ~8 Hz).
    box.drawX += (box.baseX - box.drawX) * 0.22;
    box.drawY += (box.baseY - box.drawY) * 0.22;

    // Smooth micro-jitter around the tracked spot.
    const amp = params.jitter * 0.045;
    let cx = box.drawX + (noise1(box.jumpSeed, time * 5.5) - 0.5) * amp;
    let cy = box.drawY + (noise1(box.jumpSeed + 31, time * 5.5) - 0.5) * amp;

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

    // Status reflects real match confidence; glitch-jumps read as re-acquire.
    const status = jumped
      ? "ACQ"
      : box.conf > 0.72
        ? "LOCK"
        : box.conf > 0.4
          ? "TRACK"
          : "SCAN";

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
