/** The spec travels inside the PNG as a tEXt chunk, right after IHDR. */

import { isFieldSpec } from "./field/spec";
import { isGradientSpec } from "./gradient/spec";
import { SPEC_KEYWORD, type GeneratedSpec } from "./types";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++)
		c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function textChunk(keyword: string, text: string): Uint8Array<ArrayBuffer> {
	const body = new TextEncoder().encode(`${keyword}\0${text}`);
	const out = new Uint8Array(new ArrayBuffer(12 + body.length));
	const view = new DataView(out.buffer);
	view.setUint32(0, body.length);
	out.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
	out.set(body, 8);
	view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
	return out;
}

/** Insert the spec after IHDR. The blob must be a PNG. */
export async function embedSpec(png: Blob, spec: GeneratedSpec): Promise<Blob> {
	const head = new Uint8Array(
		await png.slice(0, 33).arrayBuffer(),
	) as Uint8Array<ArrayBuffer>;
	if (!SIGNATURE.every((b, i) => head[i] === b)) return png;
	// signature (8) + IHDR chunk (4 len + 4 type + 13 data + 4 crc) = 33
	const chunk = textChunk(SPEC_KEYWORD, JSON.stringify(spec));
	return new Blob([head, chunk, png.slice(33)], {
		type: "image/png",
	});
}

/** A generated file's recipe and the size it was rendered at. */
export interface GeneratedInfo {
	spec: GeneratedSpec;
	width: number;
	height: number;
}

/** Cache so a file is only ever parsed once; misses are remembered too. */
const infos = new WeakMap<File, GeneratedInfo | null>();

/** Attach the recipe to a file the app just produced, skipping the parse later. */
export function rememberGenerated(file: File, info: GeneratedInfo) {
	infos.set(file, info);
}

/** What a file was rendered from, or null for ordinary media. */
export async function readGenerated(file: File): Promise<GeneratedInfo | null> {
	const cached = infos.get(file);
	if (cached !== undefined) return cached;
	const info = await parseGenerated(file).catch(() => null);
	infos.set(file, info);
	return info;
}

async function parseGenerated(file: File): Promise<GeneratedInfo | null> {
	if (file.type !== "image/png") return null;
	// Our chunk sits right after IHDR, so a small slice covers it.
	const bytes = new Uint8Array(await file.slice(0, 16384).arrayBuffer());
	if (!SIGNATURE.every((b, i) => bytes[i] === b)) return null;
	const view = new DataView(bytes.buffer);
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	let at = 8;
	while (at + 8 <= bytes.length) {
		const len = view.getUint32(at);
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
		if (type === "IDAT" || type === "IEND") return null;
		if (type === "tEXt" && at + 8 + len <= bytes.length) {
			const body = bytes.subarray(at + 8, at + 8 + len);
			const nul = body.indexOf(0);
			if (nul > 0) {
				const keyword = new TextDecoder().decode(body.subarray(0, nul));
				if (keyword === SPEC_KEYWORD) {
					const parsed = JSON.parse(
						new TextDecoder().decode(body.subarray(nul + 1)),
					);
					return isGradientSpec(parsed) || isFieldSpec(parsed)
						? { spec: parsed, width, height }
						: null;
				}
			}
		}
		at += 12 + len;
	}
	return null;
}
