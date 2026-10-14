import { deflateSync } from "node:zlib";

/** Media the specs feed the app, built here rather than committed. Binary fixtures rot
 * quietly: nobody can diff them, so a source's colour or a track's length is stated outright. */

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

/** A solid-colour PNG. Flat on purpose: a source the specs recognise on the preview by
 * its colour alone, with no detail for an effect to smear into something ambiguous. */
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

/** The source image the renderer specs draw through. A flat colour is useless: an effect
 * that displaces pixels has nothing to move, and one that shifts colour nothing to shift. */
function patternPngBytes(size = 128): Buffer {
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

/** A mono 16-bit WAV: a quiet tone with a sharp click on every beat. The clicks matter:
 * a flat tone has no tempo, and anything reading levels would see one unbroken value. */
function wavBytes({
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

/** A cube whose every vertex carries `color`, so a drawn model is told apart by hue. */
export function objCubeFile(name: string, color: Rgb) {
	const c = `${color.r / 255} ${color.g / 255} ${color.b / 255}`;
	const corners = [
		[-1, -1, -1],
		[1, -1, -1],
		[1, 1, -1],
		[-1, 1, -1],
		[-1, -1, 1],
		[1, -1, 1],
		[1, 1, 1],
		[-1, 1, 1],
	];
	const faces = [
		[1, 2, 3, 4],
		[5, 8, 7, 6],
		[1, 5, 6, 2],
		[2, 6, 7, 3],
		[3, 7, 8, 4],
		[5, 1, 4, 8],
	];
	const text = [
		...corners.map((v) => `v ${v.join(" ")} ${c}`),
		...faces.map((f) => `f ${f.join(" ")}`),
	].join("\n");
	return { name, mimeType: "", buffer: Buffer.from(text) };
}

/** A GLB holding one triangle skinned to one bone that slides along x over a
 * second: the smallest model that takes the animated (skinned) draw path. */
export function skinnedGlbFile(name: string) {
	const bin = new ArrayBuffer(36 + 12 + 48 + 8 + 24);
	const view = new DataView(bin);
	let at = 0;
	for (const v of [-1, -1, 0, 1, -1, 0, 0, 1, 0]) {
		view.setFloat32(at, v, true);
		at += 4;
	}
	// Joint 0 for every vertex, at full weight.
	at += 12;
	for (let i = 0; i < 3; i++) view.setFloat32(at + i * 16, 1, true);
	at += 48;
	for (const t of [0, 1]) {
		view.setFloat32(at, t, true);
		at += 4;
	}
	for (const v of [0, 0, 0, 0.5, 0, 0]) {
		view.setFloat32(at, v, true);
		at += 4;
	}
	const json = {
		asset: { version: "2.0" },
		scene: 0,
		scenes: [{ nodes: [0, 1] }],
		nodes: [{ name: "bone" }, { mesh: 0, skin: 0 }],
		meshes: [
			{
				primitives: [
					{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 } },
				],
			},
		],
		skins: [{ joints: [0] }],
		animations: [
			{
				channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
				samplers: [{ input: 3, output: 4 }],
			},
		],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
			{ bufferView: 1, componentType: 5121, count: 3, type: "VEC4" },
			{ bufferView: 2, componentType: 5126, count: 3, type: "VEC4" },
			{ bufferView: 3, componentType: 5126, count: 2, type: "SCALAR" },
			{ bufferView: 4, componentType: 5126, count: 2, type: "VEC3" },
		],
		bufferViews: [
			{ byteOffset: 0, byteLength: 36 },
			{ byteOffset: 36, byteLength: 12 },
			{ byteOffset: 48, byteLength: 48 },
			{ byteOffset: 96, byteLength: 8 },
			{ byteOffset: 104, byteLength: 24 },
		],
	};
	return { name, mimeType: "", buffer: packGlb(json, Buffer.from(bin)) };
}

/** A square facing the camera, textured with a solid `color` PNG and nothing
 * else: told apart on the canvas only if the texture reaches it. */
export function texturedGlbFile(name: string, color: Rgb) {
	const png = pngBytes(color, 256);
	const geometry = Buffer.alloc(48 + 12 + 32);
	[-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0].forEach((v, i) =>
		geometry.writeFloatLE(v, i * 4),
	);
	[0, 1, 2, 0, 2, 3].forEach((v, i) => geometry.writeUInt16LE(v, 48 + i * 2));
	[0, 1, 1, 1, 1, 0, 0, 0].forEach((v, i) =>
		geometry.writeFloatLE(v, 60 + i * 4),
	);
	const json = {
		asset: { version: "2.0" },
		scene: 0,
		scenes: [{ nodes: [0] }],
		nodes: [{ mesh: 0 }],
		meshes: [
			{
				primitives: [
					{
						attributes: { POSITION: 0, TEXCOORD_0: 2 },
						indices: 1,
						material: 0,
					},
				],
			},
		],
		materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
		textures: [{ source: 0 }],
		images: [{ bufferView: 3, mimeType: "image/png" }],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
			{ bufferView: 1, componentType: 5123, count: 6, type: "SCALAR" },
			{ bufferView: 2, componentType: 5126, count: 4, type: "VEC2" },
		],
		bufferViews: [
			{ byteOffset: 0, byteLength: 48 },
			{ byteOffset: 48, byteLength: 12 },
			{ byteOffset: 60, byteLength: 32 },
			{ byteOffset: 92, byteLength: png.length },
		],
	};
	return {
		name,
		mimeType: "",
		buffer: packGlb(json, Buffer.concat([geometry, png])),
	};
}

/** The GLB container: a JSON chunk padded with spaces, then the binary one. */
function packGlb(json: object, bin: Buffer): Buffer {
	const jsonBytes = Buffer.from(JSON.stringify(json));
	const jsonLength = jsonBytes.length + ((4 - (jsonBytes.length % 4)) % 4);
	const binLength = bin.length + ((4 - (bin.length % 4)) % 4);
	const total = 12 + 8 + jsonLength + 8 + binLength;
	const out = Buffer.alloc(total);
	out.writeUInt32LE(0x46546c67, 0);
	out.writeUInt32LE(2, 4);
	out.writeUInt32LE(total, 8);
	out.writeUInt32LE(jsonLength, 12);
	out.writeUInt32LE(0x4e4f534a, 16);
	jsonBytes.copy(out, 20);
	out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
	const binAt = 20 + jsonLength;
	out.writeUInt32LE(binLength, binAt);
	out.writeUInt32LE(0x004e4942, binAt + 4);
	bin.copy(out, binAt + 8);
	return out;
}

/** An animated GIF: one solid frame per colour, `delayMs` each. */
export function gifFile(name: string, colors: Rgb[], size = 64, delayMs = 200) {
	const palette = colors.flatMap((c) => [c.r, c.g, c.b]);
	// The global table holds a power of two entries; pad it with black.
	const bits = Math.max(1, Math.ceil(Math.log2(colors.length)));
	while (palette.length < 3 << bits) palette.push(0);
	const frames = colors.flatMap((_, index) => [
		// Graphic control: no disposal, delay in hundredths.
		...[0x21, 0xf9, 4, 0, (delayMs / 10) & 0xff, (delayMs / 10) >> 8, 0, 0],
		...[0x2c, 0, 0, 0, 0, size & 0xff, size >> 8, size & 0xff, size >> 8, 0],
		...lzw(new Array(size * size).fill(index), Math.max(2, bits)),
	]);
	const bytes = [
		...Buffer.from("GIF89a"),
		size & 0xff,
		size >> 8,
		size & 0xff,
		size >> 8,
		0x80 | (bits - 1),
		0,
		0,
		...palette,
		// Loop forever.
		...[0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 0, 0, 0],
		...frames,
		0x3b,
	];
	return { name, mimeType: "image/gif", buffer: Buffer.from(bytes) };
}

/** GIF-flavoured LZW, the textbook encoder, packed into sub-blocks. */
function lzw(indices: number[], minCodeSize: number): number[] {
	const clear = 1 << minCodeSize;
	const eoi = clear + 1;
	let codeSize = minCodeSize + 1;
	let next = eoi + 1;
	let dict = new Map<string, number>();
	const out: number[] = [];
	let acc = 0;
	let held = 0;
	const write = (code: number) => {
		acc |= code << held;
		held += codeSize;
		while (held >= 8) {
			out.push(acc & 0xff);
			acc >>= 8;
			held -= 8;
		}
	};
	const codeOf = (run: string) =>
		run.includes(",") ? dict.get(run)! : Number(run);
	write(clear);
	let run = String(indices[0]);
	for (const index of indices.slice(1)) {
		const grown = `${run},${index}`;
		if (dict.has(grown)) {
			run = grown;
			continue;
		}
		write(codeOf(run));
		if (next < 4096) {
			dict.set(grown, next++);
			if (next > 1 << codeSize && codeSize < 12) codeSize++;
		} else {
			write(clear);
			dict = new Map();
			codeSize = minCodeSize + 1;
			next = eoi + 1;
		}
		run = String(index);
	}
	write(codeOf(run));
	write(eoi);
	if (held > 0) out.push(acc & 0xff);
	const blocks: number[] = [];
	for (let i = 0; i < out.length; i += 255) {
		const chunk = out.slice(i, i + 255);
		blocks.push(chunk.length, ...chunk);
	}
	return [minCodeSize, ...blocks, 0];
}
