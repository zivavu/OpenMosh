import { decodeAudioFile } from "./offline-audio";

/**
 * Shared cache for decoded AudioBuffers. Loudness, BPM detection, and export
 * all decode the same file; this keeps it from being decoded 2-4 times.
 */
const cache = new Map<string, Promise<AudioBuffer>>();

function keyFor(file: File): string {
	return `${file.name}|${file.size}|${file.lastModified}`;
}

export function getDecodedAudioBuffer(file: File): Promise<AudioBuffer> {
	const key = keyFor(file);
	let promise = cache.get(key);
	if (!promise) {
		promise = decodeAudioFile(file);
		cache.set(key, promise);
	}
	return promise;
}
