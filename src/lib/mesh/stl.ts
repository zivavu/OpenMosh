import { MeshBuilder, type Mesh } from "./mesh";

const HEADER = 80;
const RECORD = 50;

/** STL, binary or ASCII. Stored normals are ignored: exporters often zero them. */
export function parseStl(bytes: Uint8Array): Mesh | null {
	return isBinaryStl(bytes)
		? parseBinary(bytes)
		: parseAscii(new TextDecoder().decode(bytes));
}

/** By size, not by the "solid" prefix: plenty of binary files start with it too. */
function isBinaryStl(bytes: Uint8Array): boolean {
	if (bytes.length < HEADER + 4) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint32(HEADER, true);
	return bytes.length === HEADER + 4 + count * RECORD;
}

function parseBinary(bytes: Uint8Array): Mesh | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const count = view.getUint32(HEADER, true);
	const builder = new MeshBuilder();
	const read = (at: number) => [
		view.getFloat32(at, true),
		view.getFloat32(at + 4, true),
		view.getFloat32(at + 8, true),
	];
	for (let i = 0; i < count; i++) {
		// Each record: normal, three vertices, a two-byte attribute.
		const at = HEADER + 4 + i * RECORD + 12;
		builder.triangle(read(at), read(at + 12), read(at + 24), null, null);
	}
	return builder.build();
}

function parseAscii(text: string): Mesh | null {
	const builder = new MeshBuilder();
	let corners: number[][] = [];
	for (const raw of text.split("\n")) {
		const parts = raw.trim().split(/\s+/);
		if (parts[0] === "vertex") {
			corners.push(parts.slice(1, 4).map(Number));
		} else if (parts[0] === "endfacet") {
			for (let i = 1; i + 1 < corners.length; i++) {
				builder.triangle(corners[0], corners[i], corners[i + 1], null, null);
			}
			corners = [];
		}
	}
	return builder.build();
}
