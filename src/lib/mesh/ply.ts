import { MeshBuilder, type Mesh } from "./mesh";

interface Property {
	name: string;
	type: string;
	/** Type of a list's count; absent for a scalar. */
	countType?: string;
}

interface Element {
	name: string;
	count: number;
	props: Property[];
}

const WIDTH: Record<string, number> = {
	char: 1,
	int8: 1,
	uchar: 1,
	uint8: 1,
	short: 2,
	int16: 2,
	ushort: 2,
	uint16: 2,
	int: 4,
	int32: 4,
	uint: 4,
	uint32: 4,
	float: 4,
	float32: 4,
	double: 8,
	float64: 8,
};

/** Integer colours are 0-255, float ones 0-1. */
const COLOR_SCALE: Record<string, number> = {
	char: 1 / 127,
	int8: 1 / 127,
	uchar: 1 / 255,
	uint8: 1 / 255,
	short: 1 / 32767,
	int16: 1 / 32767,
	ushort: 1 / 65535,
	uint16: 1 / 65535,
};

/** Vertex properties kept; a splat file carries some sixty per point. */
const USED = new Set([
	..."x y z nx ny nz red green blue r g b opacity".split(" "),
	..."diffuse_red diffuse_green diffuse_blue f_dc_0 f_dc_1 f_dc_2".split(" "),
]);

/** Spherical-harmonic DC term to colour, for Gaussian-splat files. */
const SH_C0 = 0.28209479177387814;
/** Splats fainter than this are mostly haze around the scene. */
const MIN_SPLAT_OPACITY = 0.1;

/** PLY, ASCII or binary: faces become triangles, a file without them a point
 * cloud. Gaussian splats are drawn as their centres in their base colour. */
export function parsePly(bytes: Uint8Array): Mesh | null {
	const head = readHeader(bytes);
	if (!head) return null;
	const { format, elements, bodyAt } = head;
	const read =
		format === "ascii"
			? asciiReader(new TextDecoder().decode(bytes.subarray(bodyAt)))
			: binaryReader(bytes, bodyAt, format === "binary_little_endian");

	let vertices: Record<string, Float64Array> = {};
	let vertexCount = 0;
	const faces: number[][] = [];
	// Elements after these (edges, materials) aren't needed, so a broken tail is fine.
	const last = Math.max(
		...elements.map((e, i) =>
			e.name === "vertex" || e.name === "face" ? i : -1,
		),
	);
	for (const el of elements.slice(0, last + 1)) {
		if (el.name === "vertex") {
			vertexCount = el.count;
			vertices = Object.fromEntries(
				el.props
					.filter((p) => !p.countType && USED.has(p.name))
					.map((p) => [p.name, new Float64Array(el.count)]),
			);
		}
		for (let i = 0; i < el.count; i++) {
			for (const p of el.props) {
				if (p.countType) {
					const n = read(p.countType);
					const list = Array.from({ length: n }, () => read(p.type));
					if (
						el.name === "face" &&
						(p.name === "vertex_indices" || p.name === "vertex_index")
					) {
						faces.push(list);
					}
				} else {
					const v = read(p.type);
					const column = el.name === "vertex" ? vertices[p.name] : undefined;
					if (column) column[i] = v;
				}
			}
		}
	}
	if (!vertices.x || !vertices.y || !vertices.z) return null;

	const vertexProp = (name: string) =>
		elements
			.find((e) => e.name === "vertex")
			?.props.find((p) => p.name === name);
	const color = colorReader(vertices, vertexProp);
	const pos = (i: number) => [vertices.x[i], vertices.y[i], vertices.z[i]];
	const nrm =
		vertices.nx && vertices.ny && vertices.nz
			? (i: number) => [vertices.nx[i], vertices.ny[i], vertices.nz[i]]
			: null;

	const builder = new MeshBuilder();
	for (const f of faces) {
		for (let k = 1; k + 1 < f.length; k++) {
			const c = [f[0], f[k], f[k + 1]];
			if (c.some((i) => i < 0 || i >= vertexCount)) continue;
			builder.triangle(
				pos(c[0]),
				pos(c[1]),
				pos(c[2]),
				nrm ? [nrm(c[0]), nrm(c[1]), nrm(c[2])] : null,
				color ? [color(c[0]), color(c[1]), color(c[2])] : null,
			);
		}
	}
	if (faces.length === 0) {
		const opacity = vertices.opacity;
		for (let i = 0; i < vertexCount; i++) {
			if (opacity && sigmoid(opacity[i]) < MIN_SPLAT_OPACITY) continue;
			builder.point(pos(i), color ? color(i) : null);
		}
	}
	return builder.build();
}

function colorReader(
	v: Record<string, Float64Array>,
	prop: (name: string) => Property | undefined,
): ((i: number) => number[]) | null {
	if (v.f_dc_0 && v.f_dc_1 && v.f_dc_2) {
		return (i) =>
			[v.f_dc_0[i], v.f_dc_1[i], v.f_dc_2[i]].map((c) =>
				Math.min(1, Math.max(0, 0.5 + SH_C0 * c)),
			);
	}
	for (const [r, g, b] of [
		["red", "green", "blue"],
		["diffuse_red", "diffuse_green", "diffuse_blue"],
		["r", "g", "b"],
	]) {
		if (!v[r] || !v[g] || !v[b]) continue;
		const scale = COLOR_SCALE[prop(r)!.type] ?? 1;
		return (i) => [v[r][i] * scale, v[g][i] * scale, v[b][i] * scale];
	}
	return null;
}

function sigmoid(x: number): number {
	return 1 / (1 + Math.exp(-x));
}

function readHeader(bytes: Uint8Array): {
	format: string;
	elements: Element[];
	bodyAt: number;
} | null {
	// The header is ASCII and short; find its end in the raw bytes.
	const scan = new TextDecoder("latin1").decode(
		bytes.subarray(0, Math.min(bytes.length, 64 * 1024)),
	);
	const end = scan.match(/end_header[ \t]*\r?\n/);
	if (!scan.startsWith("ply") || !end || end.index === undefined) return null;
	const bodyAt = end.index + end[0].length;
	let format = "";
	const elements: Element[] = [];
	for (const line of scan.slice(0, end.index).split(/\r?\n/)) {
		const parts = line.trim().split(/\s+/);
		if (parts[0] === "format") format = parts[1];
		else if (parts[0] === "element") {
			elements.push({ name: parts[1], count: Number(parts[2]), props: [] });
		} else if (parts[0] === "property" && elements.length) {
			const props = elements[elements.length - 1].props;
			if (parts[1] === "list") {
				props.push({ name: parts[4], type: parts[3], countType: parts[2] });
			} else props.push({ name: parts[2], type: parts[1] });
		}
	}
	const known = ["ascii", "binary_little_endian", "binary_big_endian"];
	if (!known.includes(format)) return null;
	const types = elements.flatMap((e) =>
		e.props.flatMap((p) => (p.countType ? [p.type, p.countType] : [p.type])),
	);
	if (!types.every((t) => t in WIDTH)) return null;
	return { format, elements, bodyAt };
}

function asciiReader(text: string): (type: string) => number {
	const tokens = text.split(/\s+/).filter(Boolean);
	let at = 0;
	return () => Number(tokens[at++] ?? NaN);
}

function binaryReader(
	bytes: Uint8Array,
	start: number,
	little: boolean,
): (type: string) => number {
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = start;
	return (type) => {
		const width = WIDTH[type];
		if (at + width > bytes.length) throw new Error("PLY ends early");
		let v: number;
		switch (type) {
			case "char":
			case "int8":
				v = dv.getInt8(at);
				break;
			case "uchar":
			case "uint8":
				v = dv.getUint8(at);
				break;
			case "short":
			case "int16":
				v = dv.getInt16(at, little);
				break;
			case "ushort":
			case "uint16":
				v = dv.getUint16(at, little);
				break;
			case "int":
			case "int32":
				v = dv.getInt32(at, little);
				break;
			case "uint":
			case "uint32":
				v = dv.getUint32(at, little);
				break;
			case "float":
			case "float32":
				v = dv.getFloat32(at, little);
				break;
			default:
				v = dv.getFloat64(at, little);
		}
		at += width;
		return v;
	};
}
