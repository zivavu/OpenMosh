import { describe, expect, it } from "bun:test";
import { parseGlb } from "./glb";
import { compose, invert, multiply, slerp } from "./mat4";

/** One triangle skinned to one bone that slides along x over a second. */
function slidingTriangle(): Uint8Array {
	const bin = new ArrayBuffer(36 + 12 + 48 + 8 + 24);
	const view = new DataView(bin);
	let at = 0;
	for (const v of [0, 0, 0, 1, 0, 0, 0, 1, 0]) {
		view.setFloat32(at, v, true);
		at += 4;
	}
	for (let i = 0; i < 3; i++) view.setUint8(at + i * 4, 0);
	at += 12;
	for (let i = 0; i < 3; i++) view.setFloat32(at + i * 16, 1, true);
	at += 48;
	for (const t of [0, 1]) {
		view.setFloat32(at, t, true);
		at += 4;
	}
	for (const v of [0, 0, 0, 2, 0, 0]) {
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
	return packGlb(json, bin);
}

/** A triangle coloured per vertex (normalised bytes), tinted by its material. */
function vertexColouredTriangle(): Uint8Array {
	const bin = new ArrayBuffer(36 + 12);
	const view = new DataView(bin);
	[0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) =>
		view.setFloat32(i * 4, v, true),
	);
	[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255].forEach((v, i) =>
		view.setUint8(36 + i, v),
	);
	return packGlb(
		{
			asset: { version: "2.0" },
			scene: 0,
			scenes: [{ nodes: [0] }],
			nodes: [{ mesh: 0 }],
			meshes: [
				{
					primitives: [
						{ attributes: { POSITION: 0, COLOR_0: 1 }, material: 0 },
					],
				},
			],
			materials: [
				{ pbrMetallicRoughness: { baseColorFactor: [0.5, 1, 1, 1] } },
			],
			accessors: [
				{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
				{
					bufferView: 1,
					componentType: 5121,
					normalized: true,
					count: 3,
					type: "VEC4",
				},
			],
			bufferViews: [
				{ byteOffset: 0, byteLength: 36 },
				{ byteOffset: 36, byteLength: 12 },
			],
		},
		bin,
	);
}

function packGlb(json: object, bin: ArrayBuffer): Uint8Array {
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

describe("parseGlb", () => {
	it("reads a skinned triangle and its animation", () => {
		const mesh = parseGlb(slidingTriangle())!;
		expect(mesh.triangles).toBe(1);
		expect(mesh.skin?.bones).toBe(1);
		expect(mesh.skin?.duration).toBe(1);
		expect(mesh.uvs).toBeNull();
	});

	it("moves the bone along the clip and loops it", () => {
		const skin = parseGlb(slidingTriangle())!.skin!;
		const at = (t: number) => {
			const out = new Float32Array(16);
			skin.pose(t, out);
			return out[12];
		};
		const travel = at(0.999) - at(0);
		expect(travel).toBeGreaterThan(0);
		expect(at(0.5) - at(0)).toBeCloseTo(travel / 2, 2);
		expect(at(1.5)).toBeCloseTo(at(0.5), 5);
	});

	it("keeps the whole dance inside the unit sphere", () => {
		const mesh = parseGlb(slidingTriangle())!;
		const skin = mesh.skin!;
		const mats = new Float32Array(16);
		for (const t of [0, 0.25, 0.5, 0.75, 0.999]) {
			skin.pose(t, mats);
			for (let v = 0; v < 3; v++) {
				const x = skin.bindPositions[v * 3];
				const y = skin.bindPositions[v * 3 + 1];
				const z = skin.bindPositions[v * 3 + 2];
				const p = [
					mats[0] * x + mats[4] * y + mats[8] * z + mats[12],
					mats[1] * x + mats[5] * y + mats[9] * z + mats[13],
					mats[2] * x + mats[6] * y + mats[10] * z + mats[14],
				];
				expect(Math.hypot(...p)).toBeLessThan(1.05);
			}
		}
	});

	it("rejects anything that isn't a GLB", () => {
		expect(parseGlb(new Uint8Array(64))).toBeNull();
	});

	it("colours each corner from COLOR_0, tinted by the material", () => {
		const colors = Array.from(parseGlb(vertexColouredTriangle())!.colors!);
		const corners = [0, 1, 2].map((k) => colors.slice(k * 3, k * 3 + 3));
		expect(corners).toContainEqual([0.5, 0, 0]);
		expect(corners).toContainEqual([0, 1, 0]);
		expect(corners).toContainEqual([0, 0, 1]);
	});
});

describe("mat4", () => {
	it("inverts what compose builds", () => {
		const m = compose([1, 2, 3], [0, 0.7071068, 0, 0.7071068], [2, 2, 2]);
		const id = multiply(m, invert(m));
		id.forEach((v, i) => expect(v).toBeCloseTo(i % 5 === 0 ? 1 : 0, 6));
	});

	it("slerps halfway between two rotations", () => {
		const q = slerp([0, 0, 0, 1], [0, 1, 0, 0], 0.5);
		expect(q[1]).toBeCloseTo(Math.SQRT1_2, 6);
		expect(q[3]).toBeCloseTo(Math.SQRT1_2, 6);
	});
});
