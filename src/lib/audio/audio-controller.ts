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

// A media element can be captured by one MediaElementSourceNode ever — a
// second createMediaElementSource throws, even after the first context closed.
// So each element keeps its context + source for life, and disposing a graph
// only detaches and suspends them.
const captures = new WeakMap<
	HTMLMediaElement,
	{ ctx: AudioContext; source: MediaElementAudioSourceNode }
>();
const captureSources = new WeakMap<AudioContext, MediaElementAudioSourceNode>();

export function createAudioGraph(
	element: HTMLAudioElement | HTMLVideoElement,
): AudioGraphState {
	let cap = captures.get(element);
	if (!cap || cap.ctx.state === "closed") {
		const ctx = new AudioContext();
		cap = { ctx, source: ctx.createMediaElementSource(element) };
		captures.set(element, cap);
		captureSources.set(ctx, cap.source);
	}
	cap.source.disconnect();
	if (cap.ctx.state === "suspended") cap.ctx.resume().catch(() => {});
	return buildGraph(cap.ctx, cap.source);
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
	const source = captureSources.get(context);
	if (!source) {
		context.close();
		return;
	}
	source.disconnect();
	context.suspend().catch(() => {});
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
