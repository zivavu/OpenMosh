import { describe, expect, it, beforeEach } from "bun:test";
import {
  dropSpectrumFollower,
  normalizeSpectrum,
  resetSpectrumRange,
  smoothSpectrum,
} from "./spectrum-range";

const BINS = 32;

/**
 * A frame shaped like real material: bins resting well above zero and well
 * below full scale, tilted so highs are quieter, and swinging on a kick every
 * half second so each bin has genuine frame-to-frame dynamics. `loudness`
 * scales the whole frame.
 */
function frame(loudness: number, t: number): Uint8Array {
  const a = new Uint8Array(BINS);
  const beat = Math.exp(-((t % 0.5) / 0.12));
  for (let i = 0; i < BINS; i++) {
    const shape = 1 - 0.35 * (i / BINS);
    const v = shape * loudness * (0.45 + 0.4 * beat);
    a[i] = Math.round(255 * Math.max(0, Math.min(1, v)));
  }
  return a;
}

const peak = (a: Uint8Array) => a.reduce((m, v) => (v > m ? v : m), 0);
const mean = (a: Uint8Array) => a.reduce((t, v) => t + v, 0) / a.length;

/**
 * Run a stretch of frames and report over the whole window, not on the last
 * one: with a beat in the signal, whether any single frame is loud depends
 * entirely on where in the bar it lands.
 */
function run(loudness: number, seconds: number, fps = 60, startT = 0) {
  const dt = 1 / fps;
  let t = startT;
  let high = 0;
  let low = 255;
  let meanSum = 0;
  const frames = Math.round(seconds * fps);
  for (let f = 0; f < frames; f++, t += dt) {
    const out = normalizeSpectrum(frame(loudness, t), dt)!;
    high = Math.max(high, peak(out));
    low = Math.min(low, peak(out));
    meanSum += mean(out);
  }
  return { t, high, low, mean: meanSum / frames };
}

describe("normalizeSpectrum", () => {
  beforeEach(resetSpectrumRange);

  it("expands a narrow input band to use the full output range", () => {
    // The bug this exists to fix: raw bins occupy a slice in the middle of the
    // byte range and never approach either end, so the bars barely move.
    const raw = frame(0.8, 0.4);
    expect(peak(raw)).toBeLessThan(150);
    expect(Math.min(...raw)).toBeGreaterThan(50);

    const { high, low } = run(0.8, 4);
    expect(high).toBeGreaterThan(230);
    expect(low).toBeLessThan(30);
  });

  it("still moves when overall loudness changes", () => {
    // The ceiling is shared across bins rather than per-bin, so a louder
    // passage lifts every bar before the envelope catches up. A per-bin
    // ceiling would pin each band at full scale and lose this entirely.
    const settled = run(0.8, 4);
    const quiet = run(0.8, 0.25, 60, settled.t);
    const loud = run(1.4, 0.25, 60, quiet.t);
    expect(loud.mean).toBeGreaterThan(quiet.mean * 1.2);
  });

  it("keeps silence silent instead of amplifying it", () => {
    const dt = 1 / 60;
    let out = new Uint8Array(BINS);
    for (let f = 0; f < 300; f++) out = normalizeSpectrum(new Uint8Array(BINS), dt)!;
    expect(peak(out)).toBe(0);
  });

  it("does not stretch near-silence into a full-scale display", () => {
    // Room tone or a fade tail: real, but with almost no dynamics. Auto-gain
    // will happily amplify it into a chorus unless the ceiling has a floor.
    expect(run(0.03, 5).high).toBeLessThan(120);
  });

  it("comes back to life within a beat of a hard cut", () => {
    // Until a bin's floor falls back to the new quiet level its height clamps
    // at zero, so there is a blank window after any downward step. What FLOOR_
    // FALL_TAU buys is that the floor is down again before the next kick lands,
    // so the display resumes on that beat instead of sitting out several.
    const settled = run(1, 5);
    const after = run(0.45, 1, 60, settled.t);
    expect(after.high).toBeGreaterThan(150);
    // And it is genuinely a beat-shaped recovery, not a constant glow.
    expect(after.low).toBe(0);
  });

  it("converges on the same envelope at 60fps and 30fps", () => {
    // A 30fps export has to agree with the 60fps preview it was set up against.
    const at60 = run(0.85, 4, 60);
    resetSpectrumRange();
    const at30 = run(0.85, 4, 30);
    expect(Math.abs(at60.mean - at30.mean)).toBeLessThan(12);
  });

  it("passes null and empty input straight through", () => {
    expect(normalizeSpectrum(null, 1 / 60)).toBeNull();
    const empty = new Uint8Array(0);
    expect(normalizeSpectrum(empty, 1 / 60)).toBe(empty);
  });

  it("draws a repeated note at the same height every time", () => {
    // Reported symptom: the first stab of a repeating figure read strongly and
    // every one after it a little weaker, at identical volume. Two causes, both
    // cumulative — the floor nudged up by the note itself, and a ceiling too
    // slow ever to reach the top of a transient.
    const gate = (t: number) => {
      const a = new Uint8Array(BINS);
      const level = t % 0.5 < 0.25 ? 0.85 : 0.42;
      for (let i = 0; i < BINS; i++) {
        a[i] = Math.round(255 * (1 - 0.3 * (i / BINS)) * level);
      }
      return a;
    };

    resetSpectrumRange();
    const dt = 1 / 60;
    let t = 0;
    const hits: number[] = [];
    for (let n = 0; n < 16; n++) {
      let high = 0;
      for (const end = t + 0.5; t < end; t += dt) {
        high = Math.max(high, mean(normalizeSpectrum(gate(t), dt)!));
      }
      hits.push(high);
    }

    // The opening hit is allowed to over-read: nothing has established the
    // scale yet. From there it has to hold, however long the figure runs.
    const settled = hits.slice(2);
    expect(Math.max(...settled) - Math.min(...settled)).toBeLessThan(3);
    // And it must not be drifting in one direction across the run.
    expect(settled[settled.length - 1]).toBeGreaterThan(settled[0] - 2);
  });

  it("still resolves loud from quiet instead of clipping everything flat", () => {
    // A ceiling unable to track a transient used to sag all the way to
    // MIN_CEIL, which pinned every bar at full height and flattened dynamics.
    const stab = (t: number, amount: number) => {
      const a = new Uint8Array(BINS);
      const env = Math.exp(-((t % 0.5) / 0.09));
      for (let i = 0; i < BINS; i++) {
        const v = (1 - 0.3 * (i / BINS)) * (0.42 + amount * env);
        a[i] = Math.round(255 * Math.min(1, v));
      }
      return a;
    };
    const play = (amount: number, seconds: number, startT: number) => {
      const dt = 1 / 60;
      let t = startT;
      let high = 0;
      for (const end = t + seconds; t < end; t += dt) {
        high = Math.max(high, mean(normalizeSpectrum(stab(t, amount), dt)!));
      }
      return { high, t };
    };
    resetSpectrumRange();
    const loud = play(0.42, 3, 0);
    const quiet = play(0.1, 3, loud.t);
    expect(quiet.high).toBeLessThan(loud.high * 0.7);
  });

  it("reseeds after a reset so a seek doesn't inherit the old envelope", () => {
    run(1, 5);
    resetSpectrumRange();
    // The first frame after a reset seeds the floors from itself, so nothing
    // has risen above its own resting level yet.
    expect(peak(normalizeSpectrum(frame(0.4, 0), 1 / 60)!)).toBe(0);
  });
});

describe("smoothSpectrum", () => {
  beforeEach(resetSpectrumRange);

  /** Hold a level for `seconds`, then read what the follower reports. */
  function hold(key: string, level: number, seconds: number, smoothing: number) {
    const src = new Uint8Array([level]);
    const dest = new Uint8Array(1);
    const dt = 1 / 60;
    for (let f = 0; f < Math.round(seconds * 60); f++) {
      smoothSpectrum(key, src, dest, dt, smoothing);
    }
    return dest[0];
  }

  it("rises faster than it falls, at every smoothing setting", () => {
    // Asymmetric on purpose: a follower quick enough to catch a transient is
    // also quick enough to flicker on every gap between hits. Compared as
    // ground covered in the same window, since the absolute attack does get
    // slower as smoothing rises — it is the ratio that has to hold.
    for (const smoothing of [0, 0.45, 1]) {
      const key = `asym-${smoothing}`;
      hold(key, 0, 1, smoothing);
      const rose = hold(key, 255, 0.05, smoothing);
      hold(key, 255, 3, smoothing);
      const fell = 255 - hold(key, 0, 0.05, smoothing);
      expect(rose).toBeGreaterThan(fell);
    }
  });

  it("holds the tail longer as smoothing rises", () => {
    const tail = (smoothing: number) => {
      const key = `tail-${smoothing}`;
      hold(key, 255, 1, smoothing);
      return hold(key, 0, 0.15, smoothing);
    };
    expect(tail(0.9)).toBeGreaterThan(tail(0.45));
    expect(tail(0.45)).toBeGreaterThan(tail(0));
  });

  it("keeps a separate follower per instance", () => {
    // Two Audio Bars at different Smoothing settings read the same audio, so
    // sharing one follower would let the slower instance drag the faster one.
    hold("a", 255, 1, 0);
    hold("b", 255, 1, 0.9);
    const fast = hold("a", 0, 0.15, 0);
    const slow = hold("b", 0, 0.15, 0.9);
    expect(slow).toBeGreaterThan(fast);
  });

  it("seeds from the first frame rather than sweeping up from zero", () => {
    const dest = new Uint8Array(1);
    smoothSpectrum("seed", new Uint8Array([200]), dest, 1 / 60, 1);
    expect(dest[0]).toBe(200);
  });

  it("forgets a dropped instance", () => {
    hold("gone", 255, 1, 1);
    dropSpectrumFollower("gone");
    const dest = new Uint8Array(1);
    smoothSpectrum("gone", new Uint8Array([10]), dest, 1 / 60, 1);
    expect(dest[0]).toBe(10);
  });
});
