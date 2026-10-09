/** Builds a GLB from its JSON and binary chunk, for tests. */
export function packGlb(json: object, bin: ArrayBuffer): Uint8Array {
	const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
	const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
	const jsonLength = jsonBytes.length + jsonPad;
	const total = 12 + 8 + jsonLength + 8 + bin.byteLength;
	const out = new Uint8Array(total);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, 0x46546c67, true);
	dv.setUint32(4, 2, true);
	dv.setUint32(8, total, true);
	dv.setUint32(12, jsonLength, true);
	dv.setUint32(16, 0x4e4f534a, true);
	out.set(jsonBytes, 20);
	out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
	const binAt = 20 + jsonLength;
	dv.setUint32(binAt, bin.byteLength, true);
	dv.setUint32(binAt + 4, 0x004e4942, true);
	out.set(new Uint8Array(bin), binAt + 8);
	return out;
}
