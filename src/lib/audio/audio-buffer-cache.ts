import { decodeAudioFile } from "./offline-audio";

/**
 * Simple shared cache for decoded AudioBuffers. Loudness, BPM detection, and
 * export all decode the same user-provided audio file; this prevents the same
 * file from being decoded 2–4 times per session.
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

export function clearDecodedAudioBufferCache(): void {
	cache.clear();
}
