import type { EffectInstance } from "../effects";
import { applyVolumeLinksToEffects } from "./audio-utils";

export const FFT_SIZE = 2048;

/**
 * Decode an audio file to an AudioBuffer using the Web Audio API.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    return buffer;
  } finally {
    await ctx.close();
  }
}

/**
 * Create a new AudioBuffer containing only the samples in [start, end] (seconds).
 */
export function trimAudioBuffer(
  buffer: AudioBuffer,
  start: number,
  end: number,
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.max(0, Math.floor(start * sampleRate));
  const endSample = Math.min(buffer.length, Math.ceil(end * sampleRate));
  const length = Math.max(0, endSample - startSample);

  const trimmed = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length,
    sampleRate,
  });

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = trimmed.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      dst[i] = src[startSample + i];
    }
  }
  return trimmed;
}

/**
 * Tile `buffer` to fill `targetDuration` seconds (loops the buffer content).
 */
export function loopAudioBuffer(
  buffer: AudioBuffer,
  targetDuration: number,
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const srcLength = buffer.length;
  const dstLength = Math.ceil(targetDuration * sampleRate);
  const looped = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: dstLength,
    sampleRate,
  });

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = looped.getChannelData(ch);
    for (let i = 0; i < dstLength; i++) {
      dst[i] = src[i % srcLength];
    }
  }
  return looped;
}

export interface FrameAudioData {
  volumeLevel: number;
  frequencyData: Uint8Array;
}

const bitReversalTables = new Map<number, Uint32Array>();
const twiddleRealTables = new Map<number, Float32Array>();
const twiddleImagTables = new Map<number, Float32Array>();
const hannWindows = new Map<number, Float32Array>();

function getBitReversalTable(n: number): Uint32Array {
  let table = bitReversalTables.get(n);
  if (!table) {
    const log2n = Math.round(Math.log2(n));
    table = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let j = 0;
      let x = i;
      for (let b = 0; b < log2n; b++) {
        j = (j << 1) | (x & 1);
        x >>= 1;
      }
      table[i] = j;
    }
    bitReversalTables.set(n, table);
  }
  return table;
}

function getTwiddleTables(n: number): { real: Float32Array; imag: Float32Array } {
  let real = twiddleRealTables.get(n);
  let imag = twiddleImagTables.get(n);
  if (!real || !imag) {
    const log2n = Math.round(Math.log2(n));
    const total = (n / 2) * log2n;
    real = new Float32Array(total);
    imag = new Float32Array(total);
    let idx = 0;
    for (let len = 2; len <= n; len *= 2) {
      const angle = (-2 * Math.PI) / len;
      for (let j = 0; j < len / 2; j++) {
        real[idx] = Math.cos(angle * j);
        imag[idx] = Math.sin(angle * j);
        idx++;
      }
    }
    twiddleRealTables.set(n, real);
    twiddleImagTables.set(n, imag);
  }
  return { real, imag };
}

function getHannWindow(n: number): Float32Array {
  let w = hannWindows.get(n);
  if (!w) {
    w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1 || 1)));
    }
    hannWindows.set(n, w);
  }
  return w;
}

/**
 * In-place radix-2 FFT. Input and output in real/imag arrays; output is magnitude in freqData[0..fftSize/2].
 */
function fftMagnitude(
  real: Float32Array,
  imag: Float32Array,
  magnitude: Float32Array,
  fftSize: number,
): void {
  const n = fftSize;
  const bitRev = getBitReversalTable(n);
  for (let i = 0; i < n; i++) {
    const j = bitRev[i];
    if (i < j) {
      const tReal = real[i];
      real[i] = real[j];
      real[j] = tReal;
      const tImag = imag[i];
      imag[i] = imag[j];
      imag[j] = tImag;
    }
  }

  const { real: wReal, imag: wImag } = getTwiddleTables(n);
  let twiddleIdx = 0;
  for (let len = 2; len <= n; len *= 2) {
    const half = len / 2;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const idx1 = i + j;
        const idx2 = idx1 + half;
        const wr = wReal[twiddleIdx];
        const wi = wImag[twiddleIdx];
        const uReal = real[idx1];
        const uImag = imag[idx1];
        const vReal = real[idx2] * wr - imag[idx2] * wi;
        const vImag = real[idx2] * wi + imag[idx2] * wr;
        real[idx1] = uReal + vReal;
        imag[idx1] = uImag + vImag;
        real[idx2] = uReal - vReal;
        imag[idx2] = uImag - vImag;
        twiddleIdx++;
      }
    }
  }

  const half = n / 2;
  for (let i = 0; i < half; i++) {
    magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  }
}

interface AnalysisScratch {
  real: Float32Array;
  imag: Float32Array;
  magnitude: Float32Array;
}

/**
 * Extract a single frame's audio analysis at time t (seconds): RMS volume and frequency bins (0-255).
 * `channels` should be each channel's Float32Array (fetched once per buffer by the caller).
 * `scratch` arrays are reused across frames to avoid per-frame allocations.
 */
function computeFrameAnalysis(
  channels: Float32Array[],
  length: number,
  sampleRate: number,
  timeSeconds: number,
  fftSize: number,
  scratch: AnalysisScratch,
  hannWindow: Float32Array,
): FrameAudioData {
  const numChannels = channels.length;
  const frameStartSample = Math.max(
    0,
    Math.floor(timeSeconds * sampleRate) - Math.floor(fftSize / 2),
  );
  const frameEndSample = Math.min(length, frameStartSample + fftSize);
  const actualLength = frameEndSample - frameStartSample;

  // Time-domain: mix down to mono and compute RMS
  let sumSq = 0;
  const real = scratch.real;
  const imag = scratch.imag;
  real.fill(0);
  imag.fill(0);
  for (let i = 0; i < actualLength; i++) {
    let s = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      s += channels[ch][frameStartSample + i];
    }
    s /= numChannels;
    real[i] = s * hannWindow[i];
    sumSq += s * s;
  }
  const volumeLevel =
    actualLength > 0 ? Math.min(1, Math.sqrt(sumSq / actualLength)) : 0;

  const magnitude = scratch.magnitude;
  fftMagnitude(real, imag, magnitude, fftSize);

  // Convert magnitude to byte frequency data (0-255) using the same dB scale
  // as AnalyserNode.getByteFrequencyData: dB = 20*log10(mag / fftSize),
  // mapped from [minDecibels, maxDecibels] → [0, 255].
  const minDecibels = -100;
  const maxDecibels = -30;
  const dbRange = maxDecibels - minDecibels;
  const frequencyData = new Uint8Array(fftSize / 2);
  for (let i = 0; i < frequencyData.length; i++) {
    const mag = magnitude[i];
    if (mag === 0) {
      frequencyData[i] = 0;
      continue;
    }
    const dB = 20 * Math.log10(mag / fftSize);
    const scaled = (255 * (dB - minDecibels)) / dbRange;
    frequencyData[i] = Math.max(0, Math.min(255, Math.round(scaled)));
  }

  return { volumeLevel, frequencyData };
}

/**
 * Pre-compute audio analysis for each frame timestamp. Yields to the event loop
 * every few frames so the UI can paint progress instead of freezing.
 */
export async function analyzeFrames(
  buffer: AudioBuffer,
  frameTimes: number[],
  fftSize: number = FFT_SIZE,
  onProgress?: (progress: number) => void,
): Promise<FrameAudioData[]> {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const hannWindow = getHannWindow(fftSize);
  const scratch: AnalysisScratch = {
    real: new Float32Array(fftSize),
    imag: new Float32Array(fftSize),
    magnitude: new Float32Array(fftSize / 2),
  };
  const results: FrameAudioData[] = [];
  const yieldEvery = 64;
  for (let i = 0; i < frameTimes.length; i++) {
    results.push(
      computeFrameAnalysis(
        channels,
        length,
        sampleRate,
        frameTimes[i],
        fftSize,
        scratch,
        hannWindow,
      ),
    );
    if (i % yieldEvery === yieldEvery - 1 && i < frameTimes.length - 1) {
      onProgress?.(i / frameTimes.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(1);
  return results;
}

/**
 * Apply pre-computed frame audio data to effects' values (volume-linked params).
 * Modifies effect.values in place.
 */
export function applyFrameAudioToEffects(
  effects: EffectInstance[],
  frameData: FrameAudioData,
  sampleRate: number,
  fftSize: number,
): void {
  applyVolumeLinksToEffects(
    effects,
    frameData.volumeLevel,
    frameData.frequencyData,
    sampleRate,
    fftSize,
  );
}
