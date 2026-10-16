/** Animated GIF intake: a GIF is re-encoded to an MP4 once, on the way in, and
 * takes the video path everywhere after that. Browsers can animate a GIF in an
 * <img> but can't seek one, and Firefox has no ImageDecoder. */
import { withMediaType } from "./file-type";

export interface GifFrame {
	/** Full-canvas RGBA, disposal already applied. */
	pixels: Uint8ClampedArray<ArrayBuffer>;
	delayMs: number;
}

export interface DecodedGif {
	width: number;
	height: number;
	frames: GifFrame[];
}

/** Delays this short are shown at 100ms by every browser; match them. */
const MIN_DELAY_MS = 20;
const DEFAULT_DELAY_MS = 100;

/** Re-encodes an animated GIF as an MP4 `File` with the same name and timestamp,
 * so it lands in the pool as a video. Anything else comes back as it was, typed
 * from its name when the browser left it untyped. MP4 rather than WebM: Matroska
 * has no duration on the last block. */
export async function gifToVideo(untyped: File): Promise<File> {
	const file = withMediaType(untyped);
	if (file.type !== "image/gif") return file;
	try {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const gif = gifScreen(bytes);
		// Pulled one at a time and encoded as they come: holding every frame of a long,
		// large GIF at full size runs to gigabytes.
		const frames = decodeGifFrames(bytes);
		const first = frames.next();
		const second = frames.next();
		if (first.done || second.done) return file;
		// Deferred like every other mediabunny user: a static import would pull in the library.
		const {
			BufferTarget,
			CanvasSource,
			getFirstEncodableVideoCodec,
			Mp4OutputFormat,
			Output,
			QUALITY_VERY_HIGH,
		} = await import("mediabunny");
		const codec = await getFirstEncodableVideoCodec(["vp9", "vp8", "av1"], {
			width: gif.width,
			height: gif.height,
		});
		if (!codec) return file;

		const canvas = new OffscreenCanvas(gif.width, gif.height);
		const ctx = canvas.getContext("2d");
		if (!ctx) return file;
		const target = new BufferTarget();
		const output = new Output({ format: new Mp4OutputFormat(), target });
		const source = new CanvasSource(canvas, {
			codec,
			bitrate: QUALITY_VERY_HIGH,
		});
		output.addVideoTrack(source);
		await output.start();
		let t = 0;
		const add = async (frame: GifFrame) => {
			ctx.putImageData(
				new ImageData(frame.pixels, gif.width, gif.height),
				0,
				0,
			);
			await source.add(t, frame.delayMs / 1000);
			t += frame.delayMs / 1000;
		};
		await add(first.value);
		await add(second.value);
		for (const frame of frames) await add(frame);
		await output.finalize();
		if (!target.buffer) return file;
		return new File([target.buffer], file.name, {
			type: "video/mp4",
			lastModified: file.lastModified,
		});
	} catch {
		return file;
	}
}

export function gifsToVideo(files: File[]): Promise<File[]> {
	return Promise.all(files.map(gifToVideo));
}

/** Decodes every frame of a GIF, composited onto the logical screen. A file cut
 * off partway gives back the frames before the cut. */
export function decodeGif(bytes: Uint8Array): DecodedGif {
	return { ...gifScreen(bytes), frames: [...decodeGifFrames(bytes)] };
}

/** The logical screen's size; throws on anything that isn't a GIF. */
function gifScreen(bytes: Uint8Array): { width: number; height: number } {
	const sig = String.fromCharCode(...bytes.subarray(0, 6));
	if (sig !== "GIF87a" && sig !== "GIF89a") throw new Error("not a GIF");
	return {
		width: bytes[6] | (bytes[7] << 8),
		height: bytes[8] | (bytes[9] << 8),
	};
}

/** Each frame in turn, as decodeGif reads them. */
function* decodeGifFrames(bytes: Uint8Array): Generator<GifFrame> {
	const { width, height } = gifScreen(bytes);
	let pos = 13;
	let globalPalette: Uint8Array | null = null;
	if (bytes[10] & 0x80) {
		const size = 3 * (1 << ((bytes[10] & 7) + 1));
		globalPalette = bytes.subarray(pos, pos + size);
		pos += size;
	}

	const canvas = new Uint8ClampedArray(new ArrayBuffer(width * height * 4));
	const snapshot = () => new Uint8ClampedArray(canvas.slice().buffer);
	// Graphic control state for the next image descriptor.
	let delayMs = DEFAULT_DELAY_MS;
	let disposal = 0;
	let transparent = -1;

	// Bounded: a file cut off mid-block would otherwise walk past the end forever.
	const skipSubBlocks = () => {
		while (pos < bytes.length && bytes[pos] !== 0) pos += bytes[pos] + 1;
		pos++;
	};

	while (pos < bytes.length) {
		const block = bytes[pos++];
		if (block === 0x3b) break;
		if (block === 0x21) {
			const label = bytes[pos++];
			if (label === 0xf9) {
				const packed = bytes[pos + 1];
				disposal = (packed >> 2) & 7;
				const delay = (bytes[pos + 2] | (bytes[pos + 3] << 8)) * 10;
				delayMs = delay < MIN_DELAY_MS ? DEFAULT_DELAY_MS : delay;
				transparent = packed & 1 ? bytes[pos + 4] : -1;
				pos += 5;
			}
			skipSubBlocks();
			continue;
		}
		if (block !== 0x2c)
			throw new Error(`unknown GIF block 0x${block.toString(16)}`);

		const left = bytes[pos] | (bytes[pos + 1] << 8);
		const top = bytes[pos + 2] | (bytes[pos + 3] << 8);
		const w = bytes[pos + 4] | (bytes[pos + 5] << 8);
		const h = bytes[pos + 6] | (bytes[pos + 7] << 8);
		const packed = bytes[pos + 8];
		pos += 9;
		let palette = globalPalette;
		if (packed & 0x80) {
			const size = 3 * (1 << ((packed & 7) + 1));
			palette = bytes.subarray(pos, pos + size);
			pos += size;
		}
		const interlaced = (packed & 0x40) !== 0;
		const minCodeSize = bytes[pos++];
		const dataStart = pos;
		skipSubBlocks();
		const indices = lzwDecode(bytes, dataStart, minCodeSize, w * h);

		const previous = disposal === 3 ? canvas.slice() : null;
		for (let row = 0; row < h; row++) {
			const y = top + (interlaced ? interlacedRow(row, h) : row);
			if (y >= height) continue;
			for (let col = 0; col < w; col++) {
				const x = left + col;
				if (x >= width) continue;
				const idx = indices[row * w + col];
				if (idx === transparent || !palette) continue;
				const o = (y * width + x) * 4;
				canvas[o] = palette[idx * 3];
				canvas[o + 1] = palette[idx * 3 + 1];
				canvas[o + 2] = palette[idx * 3 + 2];
				canvas[o + 3] = 255;
			}
		}
		yield { pixels: snapshot(), delayMs };

		if (disposal === 2) {
			for (let y = top; y < Math.min(top + h, height); y++) {
				canvas.fill(
					0,
					(y * width + left) * 4,
					(y * width + Math.min(left + w, width)) * 4,
				);
			}
		} else if (disposal === 3 && previous) {
			canvas.set(previous);
		}
		delayMs = DEFAULT_DELAY_MS;
		disposal = 0;
		transparent = -1;
	}
}

function interlacedRow(row: number, h: number): number {
	const pass = [
		[0, 8],
		[4, 8],
		[2, 4],
		[1, 2],
	];
	for (const [start, step] of pass) {
		const count = Math.ceil(Math.max(0, h - start) / step);
		if (row < count) return start + row * step;
		row -= count;
	}
	return row;
}

/** GIF-flavoured LZW over the data sub-blocks starting at `pos`. */
function lzwDecode(
	bytes: Uint8Array,
	pos: number,
	minCodeSize: number,
	pixelCount: number,
): Uint8Array {
	const out = new Uint8Array(pixelCount);
	let outPos = 0;
	const clear = 1 << minCodeSize;
	const eoi = clear + 1;
	let codeSize = minCodeSize + 1;
	let next = eoi + 1;
	// Dictionary as prefix links: each code stores its prefix code, last byte and length.
	const prefix = new Int32Array(4096);
	const suffix = new Uint8Array(4096);
	const length = new Uint16Array(4096);
	for (let i = 0; i < clear; i++) {
		prefix[i] = -1;
		suffix[i] = i;
		length[i] = 1;
	}

	let bitBuf = 0;
	let bitCount = 0;
	let blockLeft = 0;
	const readCode = (): number => {
		while (bitCount < codeSize) {
			if (blockLeft === 0) {
				blockLeft = bytes[pos++];
				if (blockLeft === 0 || pos >= bytes.length) return eoi;
			}
			bitBuf |= bytes[pos++] << bitCount;
			bitCount += 8;
			blockLeft--;
		}
		const code = bitBuf & ((1 << codeSize) - 1);
		bitBuf >>>= codeSize;
		bitCount -= codeSize;
		return code;
	};
	// Both walks are bounded by the entry's length: a crafted stream can point an
	// entry at itself, and an unbounded walk would never end.
	const emit = (code: number) => {
		const len = length[code];
		let p = outPos + len - 1;
		outPos += len;
		let c = code;
		for (let n = 0; n < len && c >= 0; n++, c = prefix[c]) {
			if (p < out.length) out[p] = suffix[c];
			p--;
		}
		// Past the end: keep the cursor clamped so a corrupt stream can't overrun.
		if (outPos > out.length) outPos = out.length;
	};
	const firstByte = (code: number): number => {
		for (let n = length[code]; n > 1 && prefix[code] >= 0; n--)
			code = prefix[code];
		return suffix[code];
	};

	let prev = -1;
	while (outPos < pixelCount) {
		const code = readCode();
		if (code === eoi) break;
		if (code === clear) {
			codeSize = minCodeSize + 1;
			next = eoi + 1;
			prev = -1;
			continue;
		}
		// Past the dictionary: the stream is corrupt from here on.
		if (code > next || (prev === -1 && code >= next)) break;
		if (prev === -1) {
			emit(code);
			prev = code;
			continue;
		}
		let first: number;
		if (code < next) {
			emit(code);
			first = firstByte(code);
		} else {
			// KwKwK case: the code being defined right now.
			first = firstByte(prev);
			emit(prev);
			if (outPos < out.length) out[outPos] = first;
			outPos = Math.min(outPos + 1, out.length);
		}
		if (next < 4096) {
			prefix[next] = prev;
			suffix[next] = first;
			length[next] = length[prev] + 1;
			next++;
			if (next === 1 << codeSize && codeSize < 12) codeSize++;
		}
		prev = code;
	}
	return out;
}
