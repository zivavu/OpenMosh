import type {
  BoxState,
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
    count: Math.max(1, Math.round(num("count", 5))),
    sensitivity: num("sensitivity", 0.5),
    size: num("size", 0.12),
    thickness: num("thickness", 2),
    opacity: num("opacity", 1),
    color: str("color", "white") as TrackingParams["color"],
  };
}

/** Fixed seed for hex identities and per-box size variation. */
const SEED = 42;

function placementSignature(p: TrackingParams): string {
  return `${p.count}|${p.sensitivity.toFixed(3)}|${p.size.toFixed(3)}`;
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
    const sizeVar = 0.6 + hash2(SEED + k, 3) * 0.9;
    const aspect = 0.7 + hash2(SEED + k, 5) * 0.6;
    const w = params.size * sizeVar;
    const h = w * aspect;
    const prev = state.boxes[k];
    boxes.push({
      key: k,
      hex: hexId(SEED, k),
      baseX: pt.x,
      baseY: pt.y,
      drawX: pt.x,
      drawY: pt.y,
      w,
      h,
      quality: 0.6,
      state: "lock",
      stateChangedAt: time,
      // Fresh boxes spawn already faded in so a single frozen render (PNG/JPG
      // preview) shows the HUD; the fade only plays on later re-acquires.
      acquiredAt: prev ? prev.acquiredAt : time - 0.35,
    });
  }
  state.boxes = boxes;
  state.signature = sig;
  state.primaryKey = -1;
}

const PATCH_R = 3; // 7x7-cell template
const SEARCH_R = 5; // +/- cells searched around the last position

// Quality thresholds for the state machine (with hysteresis).
const Q_DEGRADE = 0.5; // lock → degraded below this
const Q_RELOCK = 0.65; // degraded → lock above this
const Q_LOST = 0.22; // degraded → lost below this
// Disturbance below this counts as "the feed has settled".
const SETTLED = 0.25;
const LOST_MIN_S = 0.35; // minimum time spent visibly lost
const LOST_MAX_S = 2.5; // force reacquire even mid-disturbance
const REACQUIRE_S = 0.45; // search animation length

/**
 * Frame-to-frame tracking with believable failure. Each box's luminance patch
 * is matched against the new grid within a local search window (SSD); the
 * match residual drives a signal-quality value that drops fast and recovers
 * slowly. A global disturbance metric (mean luminance change across the whole
 * grid) distinguishes "the feed is glitching" from "my target moved". Boxes
 * move through lock → degraded → lost → reacquire: when a glitch effect nukes
 * the frame they freeze at their last good position and report signal loss
 * instead of chasing garbage, then re-acquire once the feed settles.
 */
export function trackBoxes(
  state: TrackingState,
  params: TrackingParams,
  lum: Float32Array,
  gw: number,
  gh: number,
  time: number,
): void {
  const gap = state.lastTick < 0 ? Infinity : time - state.lastTick;
  state.lastTick = time;
  const prev = state.prevLum;

  if (gap < 0 || gap > 0.4) {
    // Scene cut / single-frame render (frozen preview, param tweak between
    // stills, time reset): no frame-to-frame story to tell. Re-seat boxes
    // instantly onto the current content, confident and locked — a still
    // export should show a clean HUD, not mid-glitch theatrics.
    state.disturbance = 0;
    for (let k = 0; k < state.boxes.length; k++) {
      const box = state.boxes[k];
      const pt = state.salPoints[k];
      if (pt) {
        box.baseX = pt.x;
        box.baseY = pt.y;
      }
      box.drawX = box.baseX;
      box.drawY = box.baseY;
      box.quality = 0.75;
      if (box.state !== "lock") setState(box, "lock", time);
    }
  } else if (prev && state.gridW === gw && state.gridH === gh) {
    // Global disturbance: rises instantly with frame change, decays ~0.5s.
    let diff = 0;
    const n = gw * gh;
    for (let i = 0; i < n; i++) diff += Math.abs(lum[i] - prev[i]);
    const inst = Math.min(1, (diff / n) * 8);
    state.disturbance = Math.max(inst, state.disturbance * 0.75);

    for (const box of state.boxes) {
      switch (box.state) {
        case "lock":
        case "degraded":
          matchBox(box, prev, lum, gw, gh);
          if (box.state === "lock" && box.quality < Q_DEGRADE) {
            setState(box, "degraded", time);
          } else if (box.state === "degraded") {
            if (box.quality < Q_LOST) setState(box, "lost", time);
            else if (box.quality > Q_RELOCK) setState(box, "lock", time);
          }
          break;
        case "lost": {
          // Frozen: no matching, no movement. Wait for the feed to settle.
          const lostFor = time - box.stateChangedAt;
          const settled = state.disturbance < SETTLED && lostFor > LOST_MIN_S;
          if (settled || lostFor > LOST_MAX_S) {
            reacquire(box, state, time);
          }
          break;
        }
        case "reacquire":
          if (time - box.stateChangedAt > REACQUIRE_S) {
            box.quality = 0.6;
            setState(box, "lock", time);
          }
          break;
      }
    }

    // Primary designation (drone hierarchy): sticky, only reassigned when the
    // current primary is gone or has lost its target.
    const cur = state.boxes.find((b) => b.key === state.primaryKey);
    if (!cur || cur.state === "lost" || cur.quality < 0.3) {
      let best: TrackBox | null = null;
      for (const b of state.boxes) {
        if (b.state === "lost" || b.state === "reacquire") continue;
        if (!best || b.quality > best.quality) best = b;
      }
      if (best) state.primaryKey = best.key;
      else if (!cur) state.primaryKey = -1;
    }
  }
  // Store the new grid for the next tick (copy: the RGBA buffer is reused).
  state.prevLum = lum.slice();
  state.gridW = gw;
  state.gridH = gh;
}

/** SSD patch match around the box's last position; updates position + quality. */
function matchBox(
  box: TrackBox,
  prev: Float32Array,
  lum: Float32Array,
  gw: number,
  gh: number,
): void {
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
            prev[(py + oy) * gw + (px + ox)] - lum[(cy + oy) * gw + (cx + ox)];
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
  if (bestErr === Infinity) return;
  const n = (PATCH_R * 2 + 1) * (PATCH_R * 2 + 1);
  const rmse = Math.sqrt(bestErr / n);
  const q = Math.max(0, Math.min(1, 1 - rmse * 6));
  // Asymmetric smoothing: lose the lock fast, re-confirm it slowly.
  box.quality =
    q < box.quality
      ? box.quality * 0.4 + q * 0.6
      : box.quality * 0.85 + q * 0.15;
  box.baseX = bestX / (gw - 1);
  box.baseY = bestY / (gh - 1);
}

function setState(box: TrackBox, next: BoxState, time: number): void {
  box.state = next;
  box.stateChangedAt = time;
}

function clampCell(c: number, size: number): number {
  return Math.min(size - 1 - PATCH_R, Math.max(PATCH_R, c));
}

/** Snap a lost box onto the strongest salient point no other box claims. */
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
  if (!best) return; // nothing to lock onto yet — retry next tick
  box.baseX = best.x;
  box.baseY = best.y;
  box.quality = 0.4;
  box.acquiredAt = time;
  setState(box, "reacquire", time);
}

function pad(n: number, width: number): string {
  const s = Math.abs(Math.round(n)).toString();
  return s.padStart(width, "0");
}

const STATUS: Record<BoxState, string> = {
  lock: "LOCK",
  degraded: "TRACK",
  lost: "SIGNAL LOST",
  reacquire: "ACQ",
};

/** Resolve every persistent box into a drawable frame (motion + labels). */
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
    // Display easing per state: smooth when locked, hesitant when degraded,
    // frozen when lost, snappy while reacquiring.
    let ease: number;
    if (box.state === "lock") ease = 0.25;
    else if (box.state === "degraded") ease = 0.09;
    else if (box.state === "reacquire") ease = 0.5;
    else ease = 0;
    box.drawX += (box.baseX - box.drawX) * ease;
    box.drawY += (box.baseY - box.drawY) * ease;

    const cx = Math.min(1 - margin, Math.max(margin, box.drawX));
    const cy = Math.min(1 - margin, Math.max(margin, box.drawY));

    const primary = box.key === state.primaryKey;
    let label = "";
    let sub = "";
    if (primary) {
      label = `TGT ${box.hex} ${STATUS[box.state]}`;
      sub = `X:${pad(cx * imgW, 4)} Y:${pad(cy * imgH, 4)}`;
    } else if (box.state === "lost") {
      label = STATUS[box.state];
    } else {
      label = box.hex;
    }

    // Brackets fade in on acquire.
    const age = time - box.acquiredAt;
    const alpha = Math.min(1, Math.max(0, age / 0.35));

    boxes.push({
      cx,
      cy,
      w: box.w,
      h: box.h,
      hex: box.hex,
      state: box.state,
      stateAge: time - box.stateChangedAt,
      primary,
      label,
      sub,
      alpha,
    });
  }

  return { boxes, disturbance: state.disturbance };
}
