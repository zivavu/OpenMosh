import { getDecodedAudioBuffer } from "../audio/audio-buffer-cache";
import type { BpmWorkerResponse } from "./bpm-detector.worker";

export interface BpmResult {
  bpm: number;
  /** Seconds offset to the first beat. */
  offset: number;
}

const TARGET_SAMPLE_RATE = 44100;

let worker: Worker | null = null;
let nextRequestId = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("./bpm-detector.worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return worker;
}

async function getMonoSamples(audioFile: File): Promise<Float32Array> {
  const audioBuffer = await getDecodedAudioBuffer(audioFile);
  if (
    audioBuffer.sampleRate === TARGET_SAMPLE_RATE &&
    audioBuffer.numberOfChannels === 1
  ) {
    return audioBuffer.getChannelData(0).slice();
  }
  // Resample + downmix to mono 44 100 Hz via OfflineAudioContext
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE),
    TARGET_SAMPLE_RATE,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0).slice();
}

export async function detectBpm(
  audioFile: File,
  signal?: AbortSignal,
): Promise<BpmResult> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Audio decoding stays on the main thread; the decoded buffer is usually
  // cached from an earlier loudness/export pass.
  const samples = await getMonoSamples(audioFile);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Hand off the heavy WASM computation to a persistent worker so repeated
  // detections don't re-pay the essentia WASM instantiation cost.
  const id = nextRequestId++;
  const w = getWorker();
  return new Promise<BpmResult>((resolve, reject) => {
    const onAbort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const onMessage = (e: MessageEvent<BpmWorkerResponse>) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      if (e.data.ok) {
        resolve({ bpm: Math.round(e.data.bpm), offset: e.data.offset });
      } else {
        reject(new Error(e.data.error));
      }
    };

    const onError = (err: ErrorEvent) => {
      w.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      reject(err.error ?? new Error(String(err.message)));
    };

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError, { once: true });

    // Transfer the buffer so no copy is needed.
    w.postMessage({ id, samples }, [samples.buffer]);
  });
}
