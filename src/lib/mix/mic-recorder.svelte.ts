/** Records the microphone onto an audio lane while the project plays along. The mic
 * is tapped into the mixer's own context, so the take and the playback share a clock. */

import { onFrame } from "../frame-loop";
import { MIN_CLIP_LENGTH } from "../timeline/clips";
import { stopStream } from "../webcam/camera";
import {
	assembleChunks,
	encodeWav,
	MIC_CAPTURE_PROCESSOR,
	MIC_CAPTURE_WORKLET,
	placeTake,
	type MicChunk,
	type TakeClock,
} from "./mic-take";
import type { SequenceMixer } from "./mixer.svelte";

export interface MicTakeResult {
	laneId: string;
	file: File;
	/** Timeline seconds the take starts at. */
	start: number;
	length: number;
}

interface Session {
	laneId: string;
	ctx: AudioContext;
	stream: MediaStream;
	source: MediaStreamAudioSourceNode;
	node: AudioWorkletNode;
	sink: GainNode;
	chunks: MicChunk[];
	clock: TakeClock;
	stopWatch: () => void;
}

/** How long a stop waits for the audio thread to hand over its last chunk. */
const FLUSH_TIMEOUT_MS = 500;

const loaded = new WeakSet<BaseAudioContext>();

async function loadCaptureWorklet(ctx: AudioContext) {
	if (loaded.has(ctx)) return;
	const url = URL.createObjectURL(
		new Blob([MIC_CAPTURE_WORKLET], { type: "text/javascript" }),
	);
	try {
		await ctx.audioWorklet.addModule(url);
		loaded.add(ctx);
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** A failure worded for the user, unlike whatever the audio graph throws. */
class MicError extends Error {}

/** The raw mic: the browser's voice-call cleanup would color the take and add delay. */
async function openMic(): Promise<MediaStream> {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new MicError("This browser can't open a microphone.");
	}
	try {
		return await navigator.mediaDevices.getUserMedia({
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false,
			},
		});
	} catch (e) {
		throw new MicError(micErrorMessage(e));
	}
}

function micErrorMessage(e: unknown): string {
	switch (e instanceof DOMException ? e.name : "") {
		case "NotAllowedError":
		case "SecurityError":
			return "Microphone access was blocked. Allow it in the browser and try again.";
		case "NotFoundError":
		case "OverconstrainedError":
			return "No microphone found.";
		case "NotReadableError":
		case "AbortError":
			return "The microphone is busy in another app.";
		default:
			return "Couldn't open the microphone.";
	}
}

/** Seconds from the mix leaving the context to the performer's sound coming back in. */
function roundTripLatency(ctx: AudioContext, stream: MediaStream): number {
	const input =
		(stream.getAudioTracks()[0]?.getSettings() as { latency?: number })
			?.latency ?? 0;
	return (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + input;
}

function takeName(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `Mic take ${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}.wav`;
}

export class MicRecorder {
	/** The lane being recorded onto, and the timeline time the take began at. */
	take = $state<{ laneId: string; start: number } | null>(null);
	/** The lane whose mic is being asked for, from the click until the take runs or fails. */
	arming = $state<string | null>(null);

	#mixer: SequenceMixer;
	#onTake: (take: MicTakeResult) => void;
	#onError: (message: string) => void;
	#session: Session | null = null;
	/** Stop pressed while the mic was still being asked for. */
	#cancelled = false;

	constructor(
		mixer: SequenceMixer,
		onTake: (take: MicTakeResult) => void,
		onError: (message: string) => void,
	) {
		this.#mixer = mixer;
		this.#onTake = onTake;
		this.#onError = onError;
	}

	/** Call from the click: the context has to start inside the gesture. */
	async start(laneId: string, from: number): Promise<void> {
		if (this.#session || this.arming) return;
		this.arming = laneId;
		this.#cancelled = false;
		const mixer = this.#mixer;
		const ctx = mixer.context();
		let stream: MediaStream | null = null;
		let session: Session;
		try {
			stream = await openMic();
			await loadCaptureWorklet(ctx);
			if (ctx.state !== "running") await ctx.resume();
			const source = ctx.createMediaStreamSource(stream);
			const node = new AudioWorkletNode(ctx, MIC_CAPTURE_PROCESSOR);
			// Pulled through a silent output, so the mic is never heard.
			const sink = ctx.createGain();
			sink.gain.value = 0;
			source.connect(node);
			node.connect(sink);
			sink.connect(ctx.destination);
			const chunks: MicChunk[] = [];
			node.port.onmessage = (e: MessageEvent) => {
				if (e.data !== "done") chunks.push(e.data as MicChunk);
			};
			session = {
				laneId,
				ctx,
				stream,
				source,
				node,
				sink,
				chunks,
				clock: { time: 0, ctx: 0 },
				stopWatch: () => {},
			};
		} catch (e) {
			console.error("Mic take failed to start:", e);
			stopStream(stream);
			this.arming = null;
			this.#onError(
				e instanceof MicError
					? e.message
					: "Couldn't record from the microphone.",
			);
			return;
		}
		if (this.#cancelled) {
			this.arming = null;
			this.#teardown(session);
			return;
		}

		if (mixer.playing) mixer.pause();
		mixer.seek(from);
		mixer.straight = true;
		mixer.play();
		this.arming = null;
		if (!mixer.playing) {
			mixer.straight = false;
			this.#teardown(session);
			return;
		}
		session.clock = mixer.clock;
		const run = mixer.run;
		// A pause, a seek or the end of the span ends the take where it got to.
		session.stopWatch = onFrame("read", () => {
			if (!mixer.playing || mixer.run !== run) void this.#finish();
		});
		this.#session = session;
		this.take = { laneId, start: session.clock.time };
	}

	stop(): void {
		if (this.arming) this.#cancelled = true;
		if (!this.#session) return;
		this.#mixer.pause();
		void this.#finish();
	}

	async #finish(): Promise<void> {
		const session = this.#session;
		if (!session) return;
		this.#session = null;
		this.take = null;
		this.#mixer.straight = false;
		const { ctx, node, chunks, clock, stream, laneId } = session;
		const endFrame = Math.round(ctx.currentTime * ctx.sampleRate);
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS);
			node.port.addEventListener("message", (e: MessageEvent) => {
				if (e.data !== "done") return;
				clearTimeout(timer);
				resolve();
			});
			node.port.postMessage("stop");
		});
		const latency = roundTripLatency(ctx, stream);
		this.#teardown(session);

		const assembled = assembleChunks(chunks);
		if (!assembled) {
			this.#onError("The microphone sent no sound.");
			return;
		}
		const { start, skip } = placeTake(
			assembled.firstFrame,
			assembled.samples.length,
			ctx.sampleRate,
			clock,
			latency,
		);
		const samples = assembled.samples.subarray(
			skip,
			Math.max(skip, endFrame - assembled.firstFrame),
		);
		const length = samples.length / ctx.sampleRate;
		if (length < MIN_CLIP_LENGTH) return;
		const file = new File([encodeWav(samples, ctx.sampleRate)], takeName(), {
			type: "audio/wav",
		});
		this.#onTake({ laneId, file, start, length });
	}

	#teardown(session: Session) {
		session.stopWatch();
		session.source.disconnect();
		session.node.disconnect();
		session.sink.disconnect();
		session.node.port.close();
		stopStream(session.stream);
	}

	/** Drops a take in progress without a file. */
	dispose(): void {
		const session = this.#session;
		if (!session) return;
		this.#session = null;
		this.#mixer.straight = false;
		this.#teardown(session);
	}
}
