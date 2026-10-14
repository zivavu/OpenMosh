import { getDecodedAudioBuffer } from "../audio/audio-buffer-cache";
import type { BpmWorkerResponse } from "./bpm-detector.worker";

export interface BpmResult {
	bpm: number;
	/** Seconds offset to the first beat. */
	offset: number;
}

let worker: Worker | null = null;
let nextRequestId = 1;

function getWorker(): Worker {
	if (!worker) {
		worker = new Worker(new URL("./bpm-detector.worker.ts", import.meta.url), {
			type: "module",
		});
	}
	return worker;
}

/** Channels averaged down to one; the detector runs at the file's own rate. */
function getMonoSamples(audioBuffer: AudioBuffer): Float32Array {
	const mono = audioBuffer.getChannelData(0).slice();
	const channels = audioBuffer.numberOfChannels;
	for (let c = 1; c < channels; c++) {
		const data = audioBuffer.getChannelData(c);
		for (let i = 0; i < mono.length; i++) mono[i] += data[i];
	}
	if (channels > 1) for (let i = 0; i < mono.length; i++) mono[i] /= channels;
	return mono;
}

export async function detectBpm(
	audio: File | AudioBuffer,
	signal?: AbortSignal,
): Promise<BpmResult> {
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

	// Audio decoding stays on the main thread; the decoded buffer is usually
	// cached from an earlier loudness/export pass.
	const audioBuffer =
		audio instanceof File ? await getDecodedAudioBuffer(audio) : audio;
	const samples = getMonoSamples(audioBuffer);
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

	// Off the main thread: a full song takes about a second.
	const id = nextRequestId++;
	const w = getWorker();
	return new Promise<BpmResult>((resolve, reject) => {
		// Every way out detaches all three, or each call leaves a listener behind.
		const detach = () => {
			w.removeEventListener("message", onMessage);
			w.removeEventListener("error", onError);
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			detach();
			reject(new DOMException("Aborted", "AbortError"));
		};
		const onMessage = (e: MessageEvent<BpmWorkerResponse>) => {
			if (e.data.id !== id) return;
			detach();
			if (e.data.ok) {
				resolve({ bpm: Math.round(e.data.bpm), offset: e.data.offset });
			} else {
				reject(new Error(e.data.error));
			}
		};
		const onError = (err: ErrorEvent) => {
			detach();
			reject(err.error ?? new Error(String(err.message)));
		};

		signal?.addEventListener("abort", onAbort, { once: true });
		w.addEventListener("message", onMessage);
		w.addEventListener("error", onError);

		// Transfer the buffer so no copy is needed.
		w.postMessage({ id, samples, sampleRate: audioBuffer.sampleRate }, [
			samples.buffer,
		]);
	});
}
