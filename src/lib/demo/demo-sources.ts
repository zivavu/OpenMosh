/**
 * Source material for the upload-screen demo, drawn procedurally rather than
 * bundled: no bytes to ship and no music/image licence to honour in a repo
 * anyone can fork. Every poster is a designed piece that should hold up before
 * a single effect touches it — bold flat graphics with hard edges and saturated
 * blocks also happen to be what the shaders chew on best.
 */

export const DEMO_WIDTH = 640;
export const DEMO_HEIGHT = 360;

const W = DEMO_WIDTH;
const H = DEMO_HEIGHT;
const TAU = Math.PI * 2;

type C = CanvasRenderingContext2D;
type Rand = () => number;

/** Deterministic RNG so a given poster index always looks the same. */
function mulberry32(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Palette {
  bg: string;
  ink: string;
  tones: string[];
}

const PALETTES: Palette[] = [
  { bg: "#0d0b14", ink: "#f4f0ff", tones: ["#ff2e63", "#08d9d6", "#f9ed69"] },
  { bg: "#101010", ink: "#ffffff", tones: ["#ff6b00", "#3a86ff", "#ffbe0b"] },
  { bg: "#0a1014", ink: "#e8fff8", tones: ["#00ff9c", "#7b2ff7", "#ff0059"] },
  { bg: "#140d0d", ink: "#fff4ec", tones: ["#ff4d00", "#00c2ff", "#ff90e8"] },
  { bg: "#080d1a", ink: "#dfe8ff", tones: ["#5865f2", "#00e0b0", "#ff3d7f"] },
  { bg: "#14060f", ink: "#ffe9f7", tones: ["#f72585", "#4cc9f0", "#b5179e"] },
  { bg: "#0b1207", ink: "#eaffd6", tones: ["#aaff00", "#ff007a", "#00b4d8"] },
  { bg: "#191006", ink: "#fff3d6", tones: ["#ffd60a", "#e5383b", "#0096c7"] },
];

const WORDS = [
  "GLITCH",
  "DECAY",
  "SIGNAL",
  "NOISE",
  "BREAK",
  "STATIC",
  "NO INPUT",
  "DROPOUT",
  "RIPPED",
  "ARTIFACT",
  "DEAD AIR",
  "REWIND",
];

function pickWord(rand: Rand): string {
  return WORDS[Math.floor(rand() * WORDS.length)];
}

function tone(p: Palette, i: number): string {
  return p.tones[((i % p.tones.length) + p.tones.length) % p.tones.length];
}

function heavy(ctx: C, size: number) {
  ctx.font = `900 ${size}px "Helvetica Neue", Arial, sans-serif`;
}

function mono(ctx: C, size: number) {
  ctx.font = `700 ${size}px "Courier New", monospace`;
}

/** Largest heavy-weight size that keeps `word` inside the given box. */
function fitWord(ctx: C, word: string, maxW: number, maxH: number): number {
  heavy(ctx, 100);
  return Math.min(maxH, (maxW / ctx.measureText(word).width) * 100);
}

/** Centred slab of type with an offset colour drop — reads as a channel split
 * the moment any effect touches it. */
function bigWord(
  ctx: C,
  rand: Rand,
  p: Palette,
  word: string,
  cy = H * 0.5,
  maxW = W * 0.86,
) {
  const size = fitWord(ctx, word, maxW, H * 0.44);
  heavy(ctx, size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const off = size * 0.05;
  ctx.fillStyle = tone(p, Math.floor(rand() * 3));
  ctx.fillText(word, W / 2 + off, cy + off);
  ctx.fillStyle = p.ink;
  ctx.fillText(word, W / 2, cy);
}

function label(ctx: C, text: string, x: number, y: number, size: number, color: string) {
  mono(ctx, size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function poly(ctx: C, pts: number[][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
}

/* ── posters ──────────────────────────────────────────────────────────── */

function testCard(ctx: C, rand: Rand, p: Palette) {
  const cols = [p.ink, tone(p, 2), tone(p, 1), tone(p, 0), p.ink, tone(p, 1), p.bg];
  const bw = W / cols.length;
  cols.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(i * bw, 0, bw + 1, H * 0.72);
  });
  const stubs = 5 + Math.floor(rand() * 4);
  for (let i = 0; i < stubs; i++) {
    ctx.fillStyle = i % 2 ? p.bg : tone(p, i);
    ctx.fillRect((i * W) / stubs, H * 0.72, W / stubs + 1, H * 0.28);
  }
  const cx = W / 2;
  const cy = H * 0.4;
  const r = H * 0.3;
  ctx.fillStyle = p.bg;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.72, 0, TAU);
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
  label(ctx, "NO SIGNAL", cx, cy + r * 0.45, 17, p.ink);
}

function synthSun(ctx: C, rand: Rand, p: Palette) {
  const horizon = H * 0.6;
  const cx = W / 2;
  const r = H * 0.42;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, horizon);
  ctx.clip();
  ctx.fillStyle = tone(p, 0);
  ctx.beginPath();
  ctx.arc(cx, horizon, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = p.bg;
  let sy = horizon - r * 0.3;
  let sh = 3;
  while (sy < horizon) {
    ctx.fillRect(cx - r, sy, r * 2, sh);
    sy += sh + 7;
    sh += 2.2;
  }
  ctx.restore();

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, horizon, W, H - horizon);
  ctx.strokeStyle = tone(p, 1);
  ctx.lineWidth = 2;
  for (let i = -9; i <= 9; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 16, horizon);
    ctx.lineTo(cx + i * W * 0.32, H);
    ctx.stroke();
  }
  let gy = horizon;
  let step = 3;
  while (gy < H) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(W, gy);
    ctx.stroke();
    gy += step;
    step *= 1.5;
  }
  label(ctx, pickWord(rand), W / 2, H * 0.12, 26, p.ink);
}

function skyline(ctx: C, rand: Rand, p: Palette) {
  ctx.fillStyle = tone(p, 0);
  ctx.beginPath();
  ctx.arc(W * 0.72, H * 0.3, H * 0.26, 0, TAU);
  ctx.fill();
  let x = -12;
  while (x < W) {
    const bw = 30 + rand() * 58;
    const bh = H * (0.3 + rand() * 0.55);
    ctx.fillStyle = p.bg;
    ctx.fillRect(x, H - bh, bw, bh);
    ctx.strokeStyle = tone(p, 1);
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, H - bh + 1, bw - 2, bh);
    for (let wy = H - bh + 14; wy < H - 12; wy += 17) {
      for (let wx = x + 9; wx < x + bw - 11; wx += 15) {
        if (rand() > 0.45) continue;
        ctx.fillStyle = rand() > 0.3 ? tone(p, 2) : p.ink;
        ctx.fillRect(wx, wy, 6, 9);
      }
    }
    x += bw + 5;
  }
}

function lowPoly(ctx: C, rand: Rand, p: Palette) {
  const cols = 6;
  const rows = 4;
  const cw = W / cols;
  const ch = H / rows;
  const pts: number[][][] = [];
  for (let r = 0; r <= rows; r++) {
    pts[r] = [];
    for (let c = 0; c <= cols; c++) {
      const jx = c === 0 || c === cols ? 0 : (rand() - 0.5) * cw * 0.6;
      const jy = r === 0 || r === rows ? 0 : (rand() - 0.5) * ch * 0.6;
      pts[r][c] = [c * cw + jx, r * ch + jy];
    }
  }
  const swatch = [...p.tones, p.ink, p.bg, tone(p, 0)];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = pts[r][c];
      const b = pts[r][c + 1];
      const d = pts[r + 1][c + 1];
      const e = pts[r + 1][c];
      ctx.fillStyle = swatch[Math.floor(rand() * swatch.length)];
      poly(ctx, [a, b, d]);
      ctx.fillStyle = swatch[Math.floor(rand() * swatch.length)];
      poly(ctx, [a, d, e]);
    }
  }
}

function spiral(ctx: C, rand: Rand, p: Palette) {
  const cx = W * (0.35 + rand() * 0.3);
  const cy = H / 2;
  ctx.lineCap = "round";
  ctx.lineWidth = 18;
  for (let s = 0; s < 2; s++) {
    ctx.strokeStyle = tone(p, s);
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 7; a += 0.08) {
      const r = 6 + a * 9;
      const t = a + s * Math.PI;
      const x = cx + Math.cos(t) * r * 1.4;
      const y = cy + Math.sin(t) * r;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, 14, 0, TAU);
  ctx.fill();
}

function starburst(ctx: C, rand: Rand, p: Palette) {
  const cx = W * (0.3 + rand() * 0.4);
  const cy = H * (0.25 + rand() * 0.5);
  const wedges = 16 + Math.floor(rand() * 8) * 2;
  for (let i = 0; i < wedges; i++) {
    ctx.fillStyle = i % 2 ? tone(p, Math.floor(i / 2)) : p.bg;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, W * 1.2, (i / wedges) * TAU, ((i + 1) / wedges) * TAU);
    ctx.fill();
  }
  ctx.fillStyle = p.bg;
  ctx.beginPath();
  ctx.arc(cx, cy, H * 0.22, 0, TAU);
  ctx.fill();
  bigWord(ctx, rand, p, pickWord(rand), cy, W * 0.5);
}

function contour(ctx: C, rand: Rand, p: Palette) {
  const bands = 8 + Math.floor(rand() * 4);
  for (let i = bands; i >= 0; i--) {
    const base = H * (0.1 + (i / bands) * 0.95);
    const amp = 10 + rand() * 26;
    const freq = 0.006 + rand() * 0.012;
    const phase = rand() * TAU;
    ctx.fillStyle = i % 2 ? tone(p, i) : p.bg;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      ctx.lineTo(x, base + Math.sin(x * freq + phase) * amp);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }
}

function barcode(ctx: C, rand: Rand, p: Palette) {
  let x = 0;
  while (x < W) {
    const bw = 3 + rand() * 22;
    const roll = rand();
    ctx.fillStyle = roll > 0.8 ? p.bg : roll > 0.45 ? p.ink : tone(p, Math.floor(rand() * 3));
    ctx.fillRect(x, 0, bw, H);
    x += bw + 2 + rand() * 6;
  }
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, H * 0.36, W, H * 0.28);
  ctx.fillStyle = tone(p, 0);
  ctx.fillRect(0, H * 0.36, W, 4);
  ctx.fillRect(0, H * 0.64 - 4, W, 4);
  bigWord(ctx, rand, p, "404", H * 0.5, W * 0.4);
}

function wireGlobe(ctx: C, rand: Rand, p: Palette) {
  const cx = W / 2;
  const cy = H / 2;
  const R = H * 0.4;
  ctx.fillStyle = tone(p, 0);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = p.bg;
  ctx.lineWidth = 3;
  for (let i = -3; i <= 3; i++) {
    const y = (i / 4) * R;
    const rr = Math.sqrt(Math.max(0, R * R - y * y));
    ctx.beginPath();
    ctx.ellipse(cx, cy + y, rr, rr * 0.2, 0, 0, TAU);
    ctx.stroke();
  }
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * Math.abs(Math.cos((i / 5) * Math.PI)), R, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.strokeStyle = tone(p, 2);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, R * 1.3, R * 0.38, -0.35 - rand() * 0.3, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = tone(p, 1);
  ctx.beginPath();
  ctx.arc(cx + R * 1.1, cy - R * 0.5, 10, 0, TAU);
  ctx.fill();
}

function typeStack(ctx: C, rand: Rand, p: Palette) {
  const word = pickWord(rand);
  const rows = 4 + Math.floor(rand() * 2);
  const rh = H / rows;
  heavy(ctx, fitWord(ctx, word, W * 0.98, rh * 1.2));
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const width = ctx.measureText(word).width;
  for (let r = 0; r < rows; r++) {
    if (r % 3 === 1) {
      ctx.fillStyle = tone(p, r);
      ctx.fillRect(0, rh * r, W, rh);
      ctx.fillStyle = p.bg;
    } else {
      ctx.fillStyle = r % 3 === 2 ? tone(p, r + 1) : p.ink;
    }
    ctx.fillText(word, (W - width) / 2 + (rand() - 0.5) * 46, rh * (r + 0.5));
  }
}

function checkerWarp(ctx: C, rand: Rand, p: Palette) {
  let y = 0;
  let rh = 12;
  for (let r = 0; y < H; r++) {
    const cw = 28 + r * 9;
    const phase = rand() * cw;
    for (let i = -1; i * cw < W + cw; i++) {
      ctx.fillStyle = (i + r) % 2 ? tone(p, r) : p.bg;
      ctx.fillRect(i * cw + phase, y, cw, rh);
    }
    y += rh;
    rh *= 1.4;
  }
  ctx.fillStyle = p.ink;
  ctx.fillRect(0, H * 0.44, W, 5);
}

function waveform(ctx: C, rand: Rand, p: Palette) {
  const bars = 64;
  const bw = W / bars;
  const cy = H / 2;
  let v = 0.4;
  for (let i = 0; i < bars; i++) {
    v = Math.max(0.06, Math.min(1, v + (rand() - 0.5) * 0.55));
    const h = v * H * 0.46;
    ctx.fillStyle = tone(p, i);
    ctx.fillRect(i * bw + 1, cy - h, bw - 2, h * 2);
  }
  ctx.fillStyle = p.ink;
  ctx.fillRect(0, cy - 1, W, 2);
  label(ctx, "SIG // CLIPPED", W / 2, H * 0.09, 20, p.ink);
}

function circuit(ctx: C, rand: Rand, p: Palette) {
  ctx.lineWidth = 3;
  ctx.lineCap = "square";
  for (let i = 0; i < 28; i++) {
    let x = Math.floor(rand() * (W / 20)) * 20;
    let y = Math.floor(rand() * (H / 20)) * 20;
    ctx.strokeStyle = tone(p, i);
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 4 + Math.floor(rand() * 5);
    for (let s = 0; s < steps; s++) {
      const dist = 20 * (1 + Math.floor(rand() * 4)) * (rand() > 0.5 ? 1 : -1);
      if (rand() > 0.5) x += dist;
      else y += dist;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = tone(p, i);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, TAU);
    ctx.fill();
  }
  const cw = 170;
  const ch = 76;
  const cx = (W - cw) / 2;
  const cy = (H - ch) / 2;
  ctx.fillStyle = tone(p, 1);
  for (let i = 0; i < 8; i++) {
    ctx.fillRect(cx + 14 + i * 19, cy - 12, 9, 12);
    ctx.fillRect(cx + 14 + i * 19, cy + ch, 9, 12);
  }
  ctx.fillStyle = p.ink;
  ctx.fillRect(cx, cy, cw, ch);
  label(ctx, "OM-808", cx + cw / 2, cy + ch / 2, 26, p.bg);
}

function eye(ctx: C, rand: Rand, p: Palette) {
  const cx = W / 2;
  const cy = H / 2;
  for (let i = 0; i < 30; i++) {
    ctx.fillStyle = i % 2 ? tone(p, 1) : p.bg;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, W, (i / 30) * TAU, ((i + 1) / 30) * TAU);
    ctx.fill();
  }
  const w = W * 0.42;
  const h = H * 0.3;
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.moveTo(cx - w, cy);
  ctx.quadraticCurveTo(cx, cy - h * 1.7, cx + w, cy);
  ctx.quadraticCurveTo(cx, cy + h * 1.7, cx - w, cy);
  ctx.fill();
  ctx.fillStyle = tone(p, 0);
  ctx.beginPath();
  ctx.arc(cx, cy, h * 0.92, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = p.bg;
  ctx.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU + rand() * 0.05;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * h * 0.4, cy + Math.sin(a) * h * 0.4);
    ctx.lineTo(cx + Math.cos(a) * h * 0.92, cy + Math.sin(a) * h * 0.92);
    ctx.stroke();
  }
  ctx.fillStyle = p.bg;
  ctx.beginPath();
  ctx.arc(cx, cy, h * 0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.arc(cx - h * 0.16, cy - h * 0.16, h * 0.1, 0, TAU);
  ctx.fill();
}

function arcs(ctx: C, rand: Rand, p: Palette) {
  const cx = W * (0.2 + rand() * 0.6);
  const cy = H * 1.02;
  const rings = 8;
  for (let i = rings; i > 0; i--) {
    ctx.fillStyle = i % 2 ? tone(p, i) : p.bg;
    ctx.beginPath();
    ctx.arc(cx, cy, (i / rings) * H * 1.3, Math.PI, TAU);
    ctx.fill();
  }
  ctx.fillStyle = p.ink;
  ctx.beginPath();
  ctx.arc(cx, cy, H * 0.1, Math.PI, TAU);
  ctx.fill();
  label(ctx, pickWord(rand), W / 2, H * 0.14, 30, p.ink);
}

function isoCubes(ctx: C, rand: Rand, p: Palette) {
  const s = 46;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 10; c++) {
      if (rand() > 0.72) continue;
      const x = c * s + (r % 2) * s * 0.5 - s * 0.5;
      const y = r * s * 0.5 + 24;
      const col = tone(p, r + c);
      ctx.fillStyle = col;
      poly(ctx, [
        [x, y - s * 0.5],
        [x + s * 0.5, y - s * 0.25],
        [x, y],
        [x - s * 0.5, y - s * 0.25],
      ]);
      ctx.globalAlpha = 0.62;
      poly(ctx, [
        [x - s * 0.5, y - s * 0.25],
        [x, y],
        [x, y + s * 0.5],
        [x - s * 0.5, y + s * 0.25],
      ]);
      ctx.globalAlpha = 0.32;
      poly(ctx, [
        [x + s * 0.5, y - s * 0.25],
        [x, y],
        [x, y + s * 0.5],
        [x + s * 0.5, y + s * 0.25],
      ]);
      ctx.globalAlpha = 1;
    }
  }
}

function hudTarget(ctx: C, rand: Rand, p: Palette) {
  ctx.strokeStyle = tone(p, 1);
  ctx.lineWidth = 2;
  for (let x = 0; x < W; x += 16) {
    const long = x % 64 === 0;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, long ? 18 : 9);
    ctx.moveTo(x, H);
    ctx.lineTo(x, H - (long ? 18 : 9));
    ctx.stroke();
  }
  const bx = W * (0.16 + rand() * 0.12);
  const by = H * 0.22;
  const bw = W * 0.38;
  const bh = H * 0.46;
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = tone(p, 0);
  ctx.fillRect(bx, by, bw, bh);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = tone(p, 0);
  ctx.lineWidth = 5;
  const L = 30;
  const corners = [
    [bx, by, 1, 1],
    [bx + bw, by, -1, 1],
    [bx, by + bh, 1, -1],
    [bx + bw, by + bh, -1, -1],
  ];
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + dx * L, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * L);
    ctx.stroke();
  }
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(bx + bw / 2, by + bh / 2, 26, 0, TAU);
  ctx.moveTo(bx + bw / 2 - 40, by + bh / 2);
  ctx.lineTo(bx + bw / 2 + 40, by + bh / 2);
  ctx.moveTo(bx + bw / 2, by + bh / 2 - 40);
  ctx.lineTo(bx + bw / 2, by + bh / 2 + 40);
  ctx.stroke();
  ctx.fillStyle = tone(p, 2);
  ctx.beginPath();
  ctx.arc(W * 0.78, H * 0.2, 9, 0, TAU);
  ctx.fill();
  label(ctx, "REC  LOCK 0.98", W * 0.78 + 74, H * 0.2, 18, p.ink);
  label(ctx, "X 048.2   Y 113.7", W * 0.76, H * 0.72, 18, tone(p, 1));
}

function dripBlocks(ctx: C, rand: Rand, p: Palette) {
  const cols = 6 + Math.floor(rand() * 3);
  const cw = W / cols;
  for (let i = 0; i < cols; i++) {
    ctx.fillStyle = tone(p, i);
    const top = H * (0.04 + rand() * 0.18);
    const bh = H * (0.2 + rand() * 0.26);
    ctx.fillRect(i * cw, top, cw + 1, bh);
    const drips = 1 + Math.floor(rand() * 3);
    for (let d = 0; d < drips; d++) {
      const dx = i * cw + rand() * (cw - 24);
      const dw = 9 + rand() * 20;
      const dl = 24 + rand() * 130;
      ctx.fillRect(dx, top + bh, dw, dl);
      ctx.beginPath();
      ctx.arc(dx + dw / 2, top + bh + dl, dw / 2, 0, TAU);
      ctx.fill();
    }
  }
  bigWord(ctx, rand, p, pickWord(rand), H * 0.6);
}

function stripeSplit(ctx: C, rand: Rand, p: Palette) {
  const bands = 5 + Math.floor(rand() * 4);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate((rand() - 0.5) * 0.9);
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = tone(p, i);
    const h = 16 + rand() * 46;
    ctx.fillRect(-W, -H / 2 + i * (H / bands), W * 2, h);
  }
  ctx.restore();
  bigWord(ctx, rand, p, pickWord(rand), H * (0.4 + rand() * 0.2));
}

function blockGrid(ctx: C, rand: Rand, p: Palette) {
  const cols = 10 + Math.floor(rand() * 6);
  const cell = W / cols;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y * cell < H; y++) {
      const roll = rand();
      if (roll > 0.62) continue;
      ctx.fillStyle = roll > 0.5 ? p.ink : tone(p, Math.floor(rand() * 3));
      if (rand() > 0.75) {
        ctx.beginPath();
        ctx.arc(x * cell + cell / 2, y * cell + cell / 2, cell * 0.45, 0, TAU);
        ctx.fill();
      } else {
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  }
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, H * 0.38, W, H * 0.26);
  bigWord(ctx, rand, p, pickWord(rand), H * 0.51);
}

const POSTERS = [
  testCard,
  synthSun,
  typeStack,
  lowPoly,
  hudTarget,
  starburst,
  skyline,
  waveform,
  spiral,
  barcode,
  contour,
  circuit,
  eye,
  checkerWarp,
  isoCubes,
  dripBlocks,
  arcs,
  wireGlobe,
  stripeSplit,
  blockGrid,
];

/** Speckle so uniform fills still give pixel-sort/data-bend something to bite. */
function drawGrain(ctx: C, rand: Rand) {
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#fff" : "#000";
    ctx.fillRect(rand() * W, rand() * H, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawPoster(index: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(index * 9176 + 13);
  // Stride 5 is coprime with the palette count, so consecutive posters never
  // repeat a colourway.
  const p = PALETTES[(index * 5) % PALETTES.length];

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, W, H);
  POSTERS[index % POSTERS.length](ctx, rand, p);
  drawGrain(ctx, rand);

  return canvas;
}

function toImage(canvas: HTMLCanvasElement): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = canvas.toDataURL("image/jpeg", 0.9);
  });
}

/**
 * Posters as images, since GlRenderer's upload path takes HTMLImageElement.
 * All share one size so switching source never reallocates the FBOs.
 */
export async function loadDemoSources(
  count = POSTERS.length,
): Promise<HTMLImageElement[]> {
  const posters = Array.from({ length: count }, (_, i) => drawPoster(i));
  return Promise.all(posters.map(toImage));
}
