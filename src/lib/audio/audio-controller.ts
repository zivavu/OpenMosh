import { applyVolumeLinksToEffects, type AudioLinkGroup } from "./audio-utils";

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

// A media element can be captured by one MediaElementSourceNode ever: a second
// createMediaElementSource throws, even after the first context closed.
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

/** Audio graph with no media-element source: callers connect their own source node
 * (e.g. an AudioBufferSourceNode) into `normalizeGain`. */
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
	// Raw bins. Smoothing lives in smoothBandLevel, which an export runs too: left at
	// the 0.8 default this path would be smoothed twice over and a render not at all.
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

export interface LinkTickOptions {
	analyser: AnalyserNode;
	frequencyData: Uint8Array | null;
	sampleRate: number;
	isPaused: () => boolean;
	getLinkGroups: () => AudioLinkGroup[];
	onLevel: (level: number) => void;
}

/** Feed the analyser's level and spectrum to every audio link, once per frame.
 * Returns the stop function. */
export function startLinkTick({
	analyser,
	frequencyData,
	sampleRate,
	isPaused,
	getLinkGroups,
	onLevel,
}: LinkTickOptions): () => void {
	const timeData = new Uint8Array(analyser.fftSize);
	const fftSize = analyser.fftSize;
	let rafId: number;
	let wasPaused = false;
	let lastTick = performance.now();
	const applyAll = (level: number, dt: number) => {
		for (const group of getLinkGroups()) {
			applyVolumeLinksToEffects(
				group.effects,
				level,
				frequencyData,
				sampleRate,
				fftSize,
				dt,
				group.response,
				group.scope,
			);
		}
	};
	const tick = () => {
		const now = performance.now();
		const dt = (now - lastTick) / 1000;
		lastTick = now;
		if (isPaused()) {
			if (!wasPaused) {
				// Settle to baseline once on pause, not freeze at the last non-silent frame.
				wasPaused = true;
				onLevel(0);
				frequencyData?.fill(0);
				// Envelopes survive a pause; re-learning would cost dead seconds.
				applyAll(0, dt);
			}
			rafId = requestAnimationFrame(tick);
			return;
		}
		wasPaused = false;
		const level = computeVolumeLevel(analyser, timeData);
		onLevel(level);
		if (frequencyData)
			analyser.getByteFrequencyData(frequencyData as Uint8Array<ArrayBuffer>);
		applyAll(level, dt);
		rafId = requestAnimationFrame(tick);
	};
	rafId = requestAnimationFrame(tick);
	return () => cancelAnimationFrame(rafId);
}
