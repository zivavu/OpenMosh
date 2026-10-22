/** Several font files kept as one: Google Fonts splits a face into a file per script,
 * each serving its own unicode-range. Stored and carried in project files and backups
 * as one blob, like any other font's bytes. */

export interface FontSlice {
	data: ArrayBuffer;
	/** Empty when the slice covers everything. */
	unicodeRange: string;
}

const MAGIC = "OMFONTS1";
/** Magic, then the index's length. */
const HEADER = MAGIC.length + 4;

export function packFontSlices(slices: FontSlice[]): ArrayBuffer {
	const index = new TextEncoder().encode(
		JSON.stringify(
			slices.map((s) => ({ range: s.unicodeRange, length: s.data.byteLength })),
		),
	);
	const total =
		HEADER + index.length + slices.reduce((n, s) => n + s.data.byteLength, 0);
	const out = new Uint8Array(total);
	out.set(new TextEncoder().encode(MAGIC), 0);
	new DataView(out.buffer).setUint32(MAGIC.length, index.length);
	out.set(index, HEADER);
	let at = HEADER + index.length;
	for (const slice of slices) {
		out.set(new Uint8Array(slice.data), at);
		at += slice.data.byteLength;
	}
	return out.buffer;
}

/** The slices of a packed font; null for a plain font file or a pack that doesn't
 * add up. The bytes come from files people send, so nothing is trusted past them. */
export function unpackFontSlices(data: ArrayBuffer): FontSlice[] | null {
	if (data.byteLength < HEADER) return null;
	const bytes = new Uint8Array(data);
	if (new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) {
		return null;
	}
	const indexLength = new DataView(data).getUint32(MAGIC.length);
	if (indexLength > data.byteLength - HEADER) return null;
	let index: unknown;
	try {
		index = JSON.parse(
			new TextDecoder().decode(bytes.subarray(HEADER, HEADER + indexLength)),
		);
	} catch {
		return null;
	}
	if (!Array.isArray(index) || index.length === 0) return null;
	const slices: FontSlice[] = [];
	let at = HEADER + indexLength;
	for (const entry of index) {
		const length = (entry as { length?: unknown } | null)?.length;
		const range = (entry as { range?: unknown } | null)?.range;
		if (
			typeof length !== "number" ||
			!Number.isInteger(length) ||
			length <= 0 ||
			length > data.byteLength - at ||
			typeof range !== "string"
		) {
			return null;
		}
		slices.push({ data: data.slice(at, at + length), unicodeRange: range });
		at += length;
	}
	return slices;
}
