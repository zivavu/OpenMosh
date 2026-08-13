/**
 * Source material for the upload-screen demo, drawn procedurally rather than
 * bundled: no bytes to ship and no music/image licence to honour in a repo
 * anyone can fork. Bold flat graphics also mosh better than a photo would at
 * this size — the effects have hard edges and saturated blocks to chew on.
 */

export const DEMO_WIDTH = 640;
export const DEMO_HEIGHT = 360;

/** Deterministic RNG so a given poster index always looks the same. */
function mulberry32(seed: number): () => number {
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
];

const WORDS = ["MOSH", "GLITCH", "DECAY", "SIGNAL", "NOISE", "BREAK"];

function drawBars(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  p: Palette,
) {
  const count = 5 + Math.floor(rand() * 4);
  const w = DEMO_WIDTH / count;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = p.tones[i % p.tones.length];
    const h = DEMO_HEIGHT * (0.35 + rand() * 0.65);
    ctx.fillRect(i * w, DEMO_HEIGHT - h, w + 1, h);
  }
}

function drawRings(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  p: Palette,
) {
  const cx = DEMO_WIDTH * (0.3 + rand() * 0.4);
  const cy = DEMO_HEIGHT * (0.3 + rand() * 0.4);
  const rings = 6 + Math.floor(rand() * 5);
  for (let i = rings; i > 0; i--) {
    ctx.fillStyle = p.tones[i % p.tones.length];
    ctx.beginPath();
    ctx.arc(cx, cy, (i / rings) * DEMO_HEIGHT * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  p: Palette,
) {
  const cols = 8 + Math.floor(rand() * 8);
  const cell = DEMO_WIDTH / cols;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y * cell < DEMO_HEIGHT; y++) {
      if (rand() > 0.45) continue;
      ctx.fillStyle = p.tones[Math.floor(rand() * p.tones.length)];
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
}

function drawSlashes(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  p: Palette,
) {
  ctx.save();
  ctx.translate(DEMO_WIDTH / 2, DEMO_HEIGHT / 2);
  ctx.rotate((rand() - 0.5) * 0.9);
  const bands = 4 + Math.floor(rand() * 5);
  for (let i = 0; i < bands; i++) {
    ctx.fillStyle = p.tones[i % p.tones.length];
    const h = 14 + rand() * 46;
    ctx.fillRect(-DEMO_WIDTH, -DEMO_HEIGHT / 2 + i * (DEMO_HEIGHT / bands), DEMO_WIDTH * 2, h);
  }
  ctx.restore();
}

const LAYOUTS = [drawBars, drawRings, drawGrid, drawSlashes];

/** Speckle so uniform fills still give pixel-sort/data-bend something to bite. */
function drawGrain(ctx: CanvasRenderingContext2D, rand: () => number) {
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = rand() > 0.5 ? "#fff" : "#000";
    ctx.fillRect(rand() * DEMO_WIDTH, rand() * DEMO_HEIGHT, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawWord(
  ctx: CanvasRenderingContext2D,
  rand: () => number,
  p: Palette,
  word: string,
) {
  const size = DEMO_HEIGHT * (0.26 + rand() * 0.16);
  ctx.font = `900 ${size}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const x = DEMO_WIDTH / 2;
  const y = DEMO_HEIGHT * (0.35 + rand() * 0.3);
  // Offset shadow in a palette tone reads as a channel split once effects hit it
  ctx.fillStyle = p.tones[Math.floor(rand() * p.tones.length)];
  ctx.fillText(word, x + size * 0.04, y + size * 0.04);
  ctx.fillStyle = p.ink;
  ctx.fillText(word, x, y);
}

function drawPoster(index: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = DEMO_WIDTH;
  canvas.height = DEMO_HEIGHT;
  const ctx = canvas.getContext("2d")!;
  const rand = mulberry32(index * 9176 + 13);
  const p = PALETTES[index % PALETTES.length];

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, DEMO_WIDTH, DEMO_HEIGHT);
  LAYOUTS[index % LAYOUTS.length](ctx, rand, p);
  drawWord(ctx, rand, p, WORDS[index % WORDS.length]);
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
export async function loadDemoSources(count = 4): Promise<HTMLImageElement[]> {
  const posters = Array.from({ length: count }, (_, i) => drawPoster(i));
  return Promise.all(posters.map(toImage));
}
