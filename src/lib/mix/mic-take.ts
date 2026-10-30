/** A microphone take, from captured blocks to the WAV file that lands on a lane. */

/** Samples the capture worklet posted, starting at context frame `frame`. */
export interface MicChunk {
	frame: number;
	samples: Float32Array;
}

/** The chunks laid end to end by their frames; a gap the worklet skipped is silence. */
export function assembleChunks(
	chunks: MicChunk[],
): { firstFrame: number; samples: Float32Array } | null {
	if (chunks.length === 0) return null;
	const firstFrame = Math.min(...chunks.map((c) => c.frame));
	const end = Math.max(...chunks.map((c) => c.frame + c.samples.length));
	const samples = new Float32Array(end - firstFrame);
	for (const c of chunks) samples.set(c.samples, c.frame - firstFrame);
	return { firstFrame, samples };
}

export interface TakeClock {
	/** Timeline time that sounds at context time `ctx`. */
	time: number;
	ctx: number;
}

/** Where the take sits on the timeline. What the mic heard at context time `c` was
 * played along to timeline time `clock.time + (c - latency - clock.ctx)`; anything
 * captured before playback started is dropped. */
export function placeTake(
	firstFrame: number,
	length: number,
	sampleRate: number,
	clock: TakeClock,
	latency: number,
): { start: number; skip: number } {
	const heardFrom = Math.round((clock.ctx + latency) * sampleRate);
	const skip = Math.min(length, Math.max(0, heardFrom - firstFrame));
	const start = clock.time + Math.max(0, firstFrame - heardFrom) / sampleRate;
	return { start, skip };
}

/** Mono 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
	const bytes = 44 + samples.length * 2;
	const view = new DataView(new ArrayBuffer(bytes));
	const ascii = (at: number, s: string) => {
		for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
	};
	ascii(0, "RIFF");
	view.setUint32(4, bytes - 8, true);
	ascii(8, "WAVE");
	ascii(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	ascii(36, "data");
	view.setUint32(40, samples.length * 2, true);
	for (let i = 0; i < samples.length; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
	return new Blob([view.buffer], { type: "audio/wav" });
}

/** Runs on the audio thread: downmixes the mic to mono and posts it in chunks, each
 * stamped with the context frame it began on. */
export const MIC_CAPTURE_PROCESSOR = "openmosh-mic-capture";

export const MIC_CAPTURE_WORKLET = `
class MicCapture extends AudioWorkletProcessor {
	constructor() {
		super();
		this.chunk = new Float32Array(4096);
		this.filled = 0;
		this.chunkFrame = 0;
		this.on = true;
		this.port.onmessage = () => {
			this.flush();
			this.on = false;
			this.port.postMessage("done");
		};
	}
	flush() {
		if (this.filled === 0) return;
		this.port.postMessage({ frame: this.chunkFrame, samples: this.chunk.slice(0, this.filled) });
		this.filled = 0;
	}
	process(inputs) {
		if (!this.on) return false;
		const channels = inputs[0];
		if (!channels || channels.length === 0) return true;
		const n = channels[0].length;
		for (let i = 0; i < n; i++) {
			if (this.filled === 0) this.chunkFrame = currentFrame + i;
			let sum = 0;
			for (const ch of channels) sum += ch[i];
			this.chunk[this.filled++] = sum / channels.length;
			if (this.filled === this.chunk.length) this.flush();
		}
		return true;
	}
}
registerProcessor("${MIC_CAPTURE_PROCESSOR}", MicCapture);
`;
