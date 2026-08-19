export { applyVolumeLinksToEffects as applyVolumeLinksTick } from "./audio-utils";

export interface AudioGraphState {
  context: AudioContext;
  /** Null for sourceless graphs (callers connect their own source node). */
  source: MediaElementAudioSourceNode | null;
  /** Applied before the analyser so FFT/volume-link data sees the normalized signal. */
  normalizeGain: GainNode;
  analyser: AnalyserNode;
  gain: GainNode;
  frequencyData: Uint8Array;
  sampleRate: number;
  binCount: number;
}

export function createAudioGraph(
  element: HTMLAudioElement | HTMLVideoElement,
): AudioGraphState {
  const ctx = new AudioContext();
  return buildGraph(ctx, ctx.createMediaElementSource(element));
}

/**
 * Audio graph with no media-element source — callers connect their own source
 * node (e.g. an AudioBufferSourceNode) into `normalizeGain`.
 */
export function createOutputAudioGraph(): AudioGraphState {
  return buildGraph(new AudioContext(), null);
}

/** source -> normalizeGain -> analyser -> gain -> destination. */
function buildGraph(
  ctx: AudioContext,
  source: MediaElementAudioSourceNode | null,
): AudioGraphState {
  const normalizeGain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  // Raw bins. Smoothing lives in smoothBandLevel, which an export runs too —
  // left at the 0.8 default this path would be smoothed twice over and a render
  // not at all. It also ran per rAF tick, so a 144 Hz monitor previewed
  // something a 60 Hz one never saw.
  analyser.smoothingTimeConstant = 0;
  const gain = ctx.createGain();
  source?.connect(normalizeGain);
  normalizeGain.connect(analyser);
  analyser.connect(gain);
  gain.connect(ctx.destination);
  return {
    context: ctx,
    source,
    normalizeGain,
    analyser,
    gain,
    frequencyData: new Uint8Array(analyser.frequencyBinCount),
    sampleRate: ctx.sampleRate,
    binCount: analyser.frequencyBinCount,
  };
}

/** Tearing down the graph is just closing its context; the nodes go with it. */
export function disposeAudioGraph(context: AudioContext): void {
  context.close();
}

export function computeVolumeLevel(
  analyser: AnalyserNode,
  timeData: Uint8Array<ArrayBuffer>,
): number {
  analyser.getByteTimeDomainData(timeData);
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) {
    const n = (timeData[i] - 128) / 128;
    sum += n * n;
  }
  return Math.min(1, Math.sqrt(sum / timeData.length));
}
