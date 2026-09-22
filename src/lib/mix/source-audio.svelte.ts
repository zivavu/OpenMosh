/** Decoded sound per source, shared by the live mixer, the export and the waveforms. */

import { getDecodedAudioBuffer } from "../audio/audio-buffer-cache";
import { decodeAudioTrackToBuffer, openAudioTrack } from "../video/decode";

/** Waveform resolution: loudest sample per this slice of a second. */
export const PEAKS_PER_SEC = 100;
/** Decodes run this many at a time; each holds a whole file's PCM. */
const CONCURRENCY = 2;

type Entry =
	| { state: "pending"; done: Promise<void> }
	| { state: "ready"; buffer: AudioBuffer; peaks: Float32Array }
	| { state: "none" };

/** Audio files go through the shared decode cache (BPM and loudness read it too);
 * containers the browser can't decode whole, like OBS's MKV, go through mediabunny. */
async function decodeSourceAudio(file: File): Promise<AudioBuffer | null> {
	const viaMediabunny = async () => {
		const opened = await openAudioTrack(file);
		if (!opened) return null;
		try {
			return await decodeAudioTrackToBuffer(opened.track);
		} finally {
			opened.input.dispose();
		}
	};
	const viaBrowser = () => getDecodedAudioBuffer(file).catch(() => null);
	if (file.type.startsWith("audio/")) {
		return (await viaBrowser()) ?? (await viaMediabunny().catch(() => null));
	}
	return (await viaMediabunny().catch(() => null)) ?? (await viaBrowser());
}

function computePeaks(buffer: AudioBuffer): Float32Array {
	const step = Math.max(1, Math.round(buffer.sampleRate / PEAKS_PER_SEC));
	const peaks = new Float32Array(Math.ceil(buffer.length / step));
	for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
		const data = buffer.getChannelData(ch);
		for (let i = 0; i < peaks.length; i++) {
			const end = Math.min(data.length, (i + 1) * step);
			let max = peaks[i];
			for (let j = i * step; j < end; j++) {
				const v = Math.abs(data[j]);
				if (v > max) max = v;
			}
			peaks[i] = max;
		}
	}
	return peaks;
}

export class SourceAudioBank {
	/** Bumped as decodes land, so whatever reads the bank redraws. */
	version = $state(0);

	#entries = new Map<string, Entry>();
	#resolve: (sourceId: string) => Promise<File | null> | File | null;
	#running = 0;
	#queue: (() => void)[] = [];
	#disposed = false;

	constructor(
		resolve: (sourceId: string) => Promise<File | null> | File | null,
	) {
		this.#resolve = resolve;
	}

	/** Start decoding whatever of these isn't known yet. */
	ensure(ids: Iterable<string>): void {
		for (const id of ids) {
			if (this.#entries.has(id)) continue;
			const done = this.#slot().then(() => this.#decode(id));
			this.#entries.set(id, { state: "pending", done });
		}
	}

	/** Resolves once every one of these has decoded or turned out silent. */
	async settle(ids: Iterable<string>): Promise<void> {
		const list = [...ids];
		this.ensure(list);
		await Promise.all(
			list.map((id) => {
				const e = this.#entries.get(id);
				return e?.state === "pending" ? e.done : undefined;
			}),
		);
	}

	buffer(id: string): AudioBuffer | null {
		const e = this.#entries.get(id);
		return e?.state === "ready" ? e.buffer : null;
	}

	peaks(id: string): Float32Array | null {
		const e = this.#entries.get(id);
		return e?.state === "ready" ? e.peaks : null;
	}

	/** Known to have sound; false while still decoding. */
	hasAudio(id: string): boolean {
		return this.#entries.get(id)?.state === "ready";
	}

	/** Known to have none, so there's nothing to wait for. */
	isSilent(id: string): boolean {
		return this.#entries.get(id)?.state === "none";
	}

	/** Decode again next time it's asked for, e.g. after its file came back from storage. */
	forget(id: string): void {
		if (this.#entries.get(id)?.state === "pending") return;
		if (this.#entries.delete(id)) this.version++;
	}

	dispose(): void {
		this.#disposed = true;
		this.#entries.clear();
		this.#queue = [];
	}

	#slot(): Promise<void> {
		if (this.#running < CONCURRENCY) {
			this.#running++;
			return Promise.resolve();
		}
		return new Promise((resolve) => this.#queue.push(resolve));
	}

	#release() {
		const next = this.#queue.shift();
		if (next) next();
		else this.#running--;
	}

	async #decode(id: string): Promise<void> {
		let entry: Entry | null = { state: "none" };
		try {
			const file = await this.#resolve(id);
			// Not there yet (still coming back from storage): asked again later.
			if (!file) entry = null;
			const buffer = file ? await decodeSourceAudio(file) : null;
			if (buffer && buffer.length > 0) {
				entry = { state: "ready", buffer, peaks: computePeaks(buffer) };
			}
		} catch {
			// Undecodable is the same as silent here.
		} finally {
			this.#release();
		}
		if (this.#disposed) return;
		if (!entry) {
			this.#entries.delete(id);
			return;
		}
		this.#entries.set(id, entry);
		this.version++;
	}
}
