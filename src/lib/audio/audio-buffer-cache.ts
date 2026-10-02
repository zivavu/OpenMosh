import { decodeAudioFile } from "./offline-audio";

/**
 * Shared cache for decoded AudioBuffers. Loudness, BPM detection, the mixer and
 * export all decode the same file; this keeps it from being decoded 2-4 times.
 * A decoded song is tens of MB, so only the few most recent are held.
 */
const MAX_ENTRIES = 3;
const cache = new Map<string, Promise<AudioBuffer>>();

function keyFor(file: File): string {
	return `${file.name}|${file.size}|${file.lastModified}`;
}

export function getDecodedAudioBuffer(file: File): Promise<AudioBuffer> {
	const key = keyFor(file);
	let promise = cache.get(key);
	if (promise) {
		// Re-inserted, so the Map's order stays least recently used first.
		cache.delete(key);
	} else {
		promise = decodeAudioFile(file);
		// A failed decode isn't kept, so the next ask tries again.
		promise.catch(() => {
			if (cache.get(key) === promise) cache.delete(key);
		});
	}
	cache.set(key, promise);
	while (cache.size > MAX_ENTRIES) {
		cache.delete(cache.keys().next().value!);
	}
	return promise;
}
