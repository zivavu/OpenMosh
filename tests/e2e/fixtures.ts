import { deflateSync } from "node:zlib";

/**
 * Media the specs feed the app, built here rather than committed.
 *
 * Binary fixtures in a repo rot quietly: nobody can diff them, and nobody can
 * tell what a spec depends on without opening one in a player. These are a few
 * dozen lines of encoder instead, so a source's colour or a track's length is
 * something a test can state outright.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Buffer): number {
	let c = 0xffffffff;
	for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

/**
 * A solid-colour PNG. Flat on purpose: a source the specs can recognise on the
 * preview by its colour alone, with no detail for an effect to smear into
 * something ambiguous.
 */
export function pngBytes(color: Rgb, size = 64): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // truecolour
	const raw = Buffer.alloc(size * (size * 3 + 1));
	for (let y = 0; y < size; y++) {
		const row = y * (size * 3 + 1);
		raw[row] = 0; // no filter
		for (let x = 0; x < size; x++) {
			const px = row + 1 + x * 3;
			raw[px] = color.r;
			raw[px + 1] = color.g;
			raw[px + 2] = color.b;
		}
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

/**
 * The source image the renderer specs draw through.
 *
 * A flat colour is useless here: an effect that only displaces pixels has
 * nothing to move, and one that only shifts colour has nothing to shift. This
 * carries a full ramp in both axes for the colour effects and hard checker
 * edges for the spatial ones, so "the frame changed" means something whatever
 * an effect does.
 */
export function patternPngBytes(size = 128): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const raw = Buffer.alloc(size * (size * 3 + 1));
	for (let y = 0; y < size; y++) {
		const row = y * (size * 3 + 1);
		raw[row] = 0;
		for (let x = 0; x < size; x++) {
			const px = row + 1 + x * 3;
			const checker = Math.floor(x / 8) % 2 === Math.floor(y / 8) % 2 ? 255 : 0;
			if (checker) {
				raw[px] = 255;
				raw[px + 1] = 255;
				raw[px + 2] = 255;
			} else {
				raw[px] = Math.round((x / (size - 1)) * 255);
				raw[px + 1] = Math.round((y / (size - 1)) * 255);
				raw[px + 2] = 255 - Math.round(((x + y) / (2 * (size - 1))) * 255);
			}
		}
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw)),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

/** The same image as base64, for handing to `page.evaluate`. */
export function patternPngBase64(size = 128): string {
	return patternPngBytes(size).toString("base64");
}

export interface WavOptions {
	seconds?: number;
	/** Clicks per minute. Gives the track a tempo something can lock onto. */
	bpm?: number;
	sampleRate?: number;
}

/**
 * A mono 16-bit WAV: a quiet tone with a sharp click on every beat.
 *
 * The clicks matter — a flat tone has no tempo, and anything reading levels
 * off this track would see one unbroken value. The beat grid here is exact, so
 * a spec can say where a downbeat falls.
 */
export function wavBytes({
	seconds = 8,
	bpm = 120,
	sampleRate = 44100,
}: WavOptions = {}): Buffer {
	const frames = Math.floor(seconds * sampleRate);
	const samplesPerBeat = (60 / bpm) * sampleRate;
	const data = Buffer.alloc(frames * 2);
	for (let i = 0; i < frames; i++) {
		const tone = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.15;
		// A short decaying burst at each beat, well above the tone.
		const sinceBeat = i % samplesPerBeat;
		const click =
			sinceBeat < sampleRate * 0.02
				? Math.sin((2 * Math.PI * 1800 * i) / sampleRate) *
					0.8 *
					(1 - sinceBeat / (sampleRate * 0.02))
				: 0;
		const value = Math.max(-1, Math.min(1, tone + click));
		data.writeInt16LE(Math.round(value * 32767), i * 2);
	}

	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + data.length, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16); // PCM chunk size
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28); // byte rate
	header.writeUInt16LE(2, 32); // block align
	header.writeUInt16LE(16, 34); // bits per sample
	header.write("data", 36, "ascii");
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

export const RED: Rgb = { r: 220, g: 30, b: 30 };
export const GREEN: Rgb = { r: 30, g: 200, b: 60 };
export const BLUE: Rgb = { r: 40, g: 70, b: 230 };

/** What `setInputFiles` wants, for a source of the given colour. */
export function imageFile(name: string, color: Rgb, size = 64) {
	return { name, mimeType: "image/png", buffer: pngBytes(color, size) };
}

/** The detailed pattern as an upload, for specs that assert the frame changed. */
export function patternImageFile(name: string, size = 128) {
	return { name, mimeType: "image/png", buffer: patternPngBytes(size) };
}

export function trackFile(name = "track.wav", options: WavOptions = {}) {
	return { name, mimeType: "audio/wav", buffer: wavBytes(options) };
}
