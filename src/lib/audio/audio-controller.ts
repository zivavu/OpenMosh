import {
	applyVolumeLinksToEffects,
	wakeAudioContext,
	type AudioLinkGroup,
} from "./audio-utils";
import { onFrame } from "../frame-loop";
import { FFT_SIZE, SPECTRUM_MAX_DB, SPECTRUM_MIN_DB } from "./offline-audio";

export { applyVolumeLinksToEffects as applyVolumeLinksTick } from "./audio-utils";

export interface AudioGraphState {
	context: AudioContext;
	/** Null for sourceless graphs (callers connect their own source node). */
	source: MediaElementAudioSourceNode | null;
	/** Applied before the analyser so FFT/volume-link data sees the normalized signal. */
	normalizeGain: GainNode;
	/** Feeds the analyser, holding it back by the output latency. */
	analysisDelay: DelayNode;
	analyser: AnalyserNode;
	analysisSink: GainNode;
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
	wakeAudioContext(cap.ctx);
	return buildGraph(cap.ctx, cap.source);
}

/** Audio graph with no media-element source: callers connect their own source node
 * (e.g. an AudioBufferSourceNode) into `normalizeGain`. */
export function createOutputAudioGraph(): AudioGraphState {
	return buildGraph(new AudioContext(), null);
}

/** Seconds between the graph processing a sample and the speaker playing it. Large on
 * phones and Bluetooth, where an undelayed analyser runs visibly ahead of the sound. */
function heardLatency(ctx: AudioContext): number {
	return (ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0);
}

/** An analyser fed through a delay that keeps it in step with what is heard, pulled
 * by a silent sink so it runs off the audible path. Connect the signal to `input`. */
export function createAnalysisTap(ctx: AudioContext): {
	input: DelayNode;
	analyser: AnalyserNode;
	sink: GainNode;
} {
	const input = ctx.createDelay(1);
	const analyser = ctx.createAnalyser();
	analyser.fftSize = FFT_SIZE;
	// Raw bins. Smoothing lives in smoothBandLevel, which an export runs too: left at
	// the 0.8 default this path would be smoothed twice over and a render not at all.
	analyser.smoothingTimeConstant = 0;
	analyser.minDecibels = SPECTRUM_MIN_DB;
	analyser.maxDecibels = SPECTRUM_MAX_DB;
	const sink = ctx.createGain();
	sink.gain.value = 0;
	input.connect(analyser);
	analyser.connect(sink);
	sink.connect(ctx.destination);
	syncAnalysisDelay(input);
	return { input, analyser, sink };
}

/** The output latency is only known once the context runs, and moves with the device.
 * The analyser reads the window ending now, where the export centres it on the frame,
 * so half a window comes off the delay to line the two up. */
function syncAnalysisDelay(delay: DelayNode): void {
	const ctx = delay.context as AudioContext;
	const halfWindow = FFT_SIZE / 2 / ctx.sampleRate;
	const target = Math.max(0, Math.min(heardLatency(ctx) - halfWindow, 1));
	if (Math.abs(delay.delayTime.value - target) > 0.005) {
		delay.delayTime.value = target;
	}
}

/** source -> normalizeGain -> gain -> destination, with normalizeGain also tapped. */
function buildGraph(
	ctx: AudioContext,
	source: MediaElementAudioSourceNode | null,
): AudioGraphState {
	const normalizeGain = ctx.createGain();
	const tap = createAnalysisTap(ctx);
	const gain = ctx.createGain();
	source?.connect(normalizeGain);
	normalizeGain.connect(gain);
	normalizeGain.connect(tap.input);
	gain.connect(ctx.destination);
	return {
		context: ctx,
		source,
		normalizeGain,
		analysisDelay: tap.input,
		analyser: tap.analyser,
		analysisSink: tap.sink,
		gain,
		frequencyData: new Uint8Array(tap.analyser.frequencyBinCount),
		sampleRate: ctx.sampleRate,
		binCount: tap.analyser.frequencyBinCount,
	};
}

/** Tearing down a graph closes its context, nodes and all. A context holding a media
 * element's capture lives on for the next graph, so this one's nodes come off it. */
export function disposeAudioGraph(graph: AudioGraphState): void {
	const source = captureSources.get(graph.context);
	if (!source) {
		graph.context.close();
		return;
	}
	source.disconnect();
	for (const node of [
		graph.normalizeGain,
		graph.analysisDelay,
		graph.analyser,
		graph.analysisSink,
		graph.gain,
	]) {
		node.disconnect();
	}
	graph.context.suspend().catch(() => {});
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
	/** The analyser's input delay, kept matched to the output latency. */
	analysisDelay: DelayNode | null;
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
	analysisDelay,
	frequencyData,
	sampleRate,
	isPaused,
	getLinkGroups,
	onLevel,
}: LinkTickOptions): () => void {
	const timeData = new Uint8Array(analyser.fftSize);
	const fftSize = analyser.fftSize;
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
			return;
		}
		wasPaused = false;
		if (analysisDelay) syncAnalysisDelay(analysisDelay);
		const level = computeVolumeLevel(analyser, timeData);
		onLevel(level);
		if (frequencyData)
			analyser.getByteFrequencyData(frequencyData as Uint8Array<ArrayBuffer>);
		applyAll(level, dt);
	};
	// Read before the frame draws, so the draw shows this frame's audio.
	return onFrame("read", tick);
}
