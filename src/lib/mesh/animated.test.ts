import { describe, expect, it } from "bun:test";
import { parseGlb, parseGltf, readGlb } from "./glb";
import { packGlb } from "./glb-fixtures";
import { compose, invert, multiply, slerp } from "./mat4";

/** One triangle skinned to one bone that slides along x over a second; a second
 * animation, "Hold", keeps it still. */
function slidingTriangle(): Uint8Array {
	const bin = new ArrayBuffer(36 + 12 + 48 + 8 + 24 + 24);
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
				name: "Slide",
				channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
				samplers: [{ input: 3, output: 4 }],
			},
			{
				name: "Hold",
				channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
				samplers: [{ input: 3, output: 5 }],
			},
		],
		accessors: [
			{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
			{ bufferView: 1, componentType: 5121, count: 3, type: "VEC4" },
			{ bufferView: 2, componentType: 5126, count: 3, type: "VEC4" },
			{ bufferView: 3, componentType: 5126, count: 2, type: "SCALAR" },
			{ bufferView: 4, componentType: 5126, count: 2, type: "VEC3" },
			{ bufferView: 5, componentType: 5126, count: 2, type: "VEC3" },
		],
		bufferViews: [
			{ byteOffset: 0, byteLength: 36 },
			{ byteOffset: 36, byteLength: 12 },
			{ byteOffset: 48, byteLength: 48 },
			{ byteOffset: 96, byteLength: 8 },
			{ byteOffset: 104, byteLength: 24 },
			{ byteOffset: 128, byteLength: 24 },
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

/** Four vertices, drawn as `mode` (0 points, 5 strip, 6 fan), coloured per vertex. */
function fourVertices(mode: number): Uint8Array {
	const bin = new ArrayBuffer(48 + 48);
	const view = new DataView(bin);
	[0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0].forEach((v, i) =>
		view.setFloat32(i * 4, v, true),
	);
	[1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1].forEach((v, i) =>
		view.setFloat32(48 + i * 4, v, true),
	);
	return packGlb(
		{
			asset: { version: "2.0" },
			scene: 0,
			scenes: [{ nodes: [0] }],
			nodes: [{ mesh: 0 }],
			meshes: [
				{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 }, mode }] },
			],
			accessors: [
				{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
				{ bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
			],
			bufferViews: [
				{ byteOffset: 0, byteLength: 48 },
				{ byteOffset: 48, byteLength: 48 },
			],
		},
		bin,
	);
}

/** Two triangles, each in its own material with its own embedded image. */
function twoTextures(): Uint8Array {
	const bin = new ArrayBuffer(72 + 48 + 8);
	const view = new DataView(bin);
	[0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1].forEach((v, i) =>
		view.setFloat32(i * 4, v, true),
	);
	[0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((v, i) =>
		view.setFloat32(72 + i * 4, v, true),
	);
	new Uint8Array(bin, 120, 8).set([1, 2, 3, 4, 5, 6, 7, 8]);
	const material = (texture: number) => ({
		pbrMetallicRoughness: { baseColorTexture: { index: texture } },
	});
	return packGlb(
		{
			asset: { version: "2.0" },
			scene: 0,
			scenes: [{ nodes: [0] }],
			nodes: [{ mesh: 0 }],
			meshes: [
				{
					primitives: [0, 1].map((k) => ({
						attributes: { POSITION: k, TEXCOORD_0: 2 + k },
						material: k,
					})),
				},
			],
			materials: [material(0), material(1)],
			textures: [{ source: 1 }, { source: 0 }],
			images: [
				{ bufferView: 2, mimeType: "image/png" },
				{ bufferView: 3, mimeType: "image/jpeg" },
			],
			accessors: [
				{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
				{
					bufferView: 0,
					byteOffset: 36,
					componentType: 5126,
					count: 3,
					type: "VEC3",
				},
				{ bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
				{
					bufferView: 1,
					byteOffset: 24,
					componentType: 5126,
					count: 3,
					type: "VEC2",
				},
			],
			bufferViews: [
				{ byteOffset: 0, byteLength: 72 },
				{ byteOffset: 72, byteLength: 48 },
				{ byteOffset: 120, byteLength: 4 },
				{ byteOffset: 124, byteLength: 4 },
			],
		},
		bin,
	);
}

/** A triangle with one morph target lifting its top corner, at 0.25 by default,
 * and an animation taking the weight from 0 to 1 over two seconds. */
function morphingTriangle(): Uint8Array {
	const bin = new ArrayBuffer(36 + 36 + 8 + 8);
	const view = new DataView(bin);
	[0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) =>
		view.setFloat32(i * 4, v, true),
	);
	[0, 0, 0, 0, 0, 0, 0, 2, 0].forEach((v, i) =>
		view.setFloat32(36 + i * 4, v, true),
	);
	[0, 2, 0, 1].forEach((v, i) => view.setFloat32(72 + i * 4, v, true));
	return packGlb(
		{
			asset: { version: "2.0" },
			scene: 0,
			scenes: [{ nodes: [0] }],
			nodes: [{ mesh: 0 }],
			meshes: [
				{
					weights: [0.25],
					primitives: [
						{ attributes: { POSITION: 0 }, targets: [{ POSITION: 1 }] },
					],
				},
			],
			animations: [
				{
					channels: [{ sampler: 0, target: { node: 0, path: "weights" } }],
					samplers: [{ input: 2, output: 3 }],
				},
			],
			accessors: [
				{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
				{ bufferView: 1, componentType: 5126, count: 3, type: "VEC3" },
				{ bufferView: 2, componentType: 5126, count: 2, type: "SCALAR" },
				{ bufferView: 3, componentType: 5126, count: 2, type: "SCALAR" },
			],
			bufferViews: [
				{ byteOffset: 0, byteLength: 36 },
				{ byteOffset: 36, byteLength: 36 },
				{ byteOffset: 72, byteLength: 8 },
				{ byteOffset: 80, byteLength: 8 },
			],
		},
		bin,
	);
}

describe("parseGlb", () => {
	it("reads morph targets and animates their weights", () => {
		const mesh = parseGlb(morphingTriangle())!;
		const morph = mesh.morph!;
		expect(morph.slots).toBe(1);
		// Delta starts at entry 0, weight slot 0, one target, three corners.
		expect(Array.from(morph.layout.subarray(0, 4))).toEqual([0, 0, 1, 3]);
		expect(Array.from(morph.deltas)).toEqual([0, 0, 0, 0, 0, 0, 0, 2, 0]);
		expect(mesh.skin!.animations[0].duration).toBe(2);
		const w = new Float32Array(1);
		morph.weights(1, w);
		expect(w[0]).toBeCloseTo(0.5);
	});

	it("holds a still model's morphs at their default weights", () => {
		const bytes = morphingTriangle();
		const glb = readGlb(bytes)!;
		glb.json.animations = [];
		const mesh = parseGltf(glb.json, glb.bin)!;
		const w = new Float32Array(1);
		mesh.morph!.weights(3, w);
		expect(w[0]).toBe(0.25);
	});

	it("reads a point cloud as one dot per vertex", () => {
		const mesh = parseGlb(fourVertices(0))!;
		expect(mesh.points).toBe(true);
		expect(mesh.triangles).toBe(0);
		expect(mesh.positions.length).toBe(12);
		expect(Array.from(mesh.colors!.subarray(3, 6))).toEqual([0, 1, 0]);
	});

	it("keeps every material's texture, each on its own layer", () => {
		const mesh = parseGlb(twoTextures())!;
		expect(mesh.images.map((i) => i.mime)).toEqual(["image/jpeg", "image/png"]);
		expect(Array.from(mesh.images[0].bytes)).toEqual([5, 6, 7, 8]);
		expect(mesh.uvs![2]).toBe(1);
		expect(mesh.uvs![9 + 2]).toBe(2);
	});

	it("moves a texture's coordinates as its transform says", () => {
		const { json, bin } = readGlb(twoTextures())!;
		json.materials![0].pbrMetallicRoughness!.baseColorTexture!.extensions = {
			KHR_texture_transform: {
				offset: [0.5, 0],
				rotation: Math.PI / 2,
				scale: [2, 1],
			},
		};
		const uvs = parseGltf(json, bin)!.uvs!;
		// (1, 0): scaled to (2, 0), turned to (0, -2), moved to (0.5, -2).
		expect(uvs[3]).toBeCloseTo(0.5);
		expect(uvs[4]).toBeCloseTo(-2);
		// The other material keeps its own.
		expect(uvs[9 + 3]).toBeCloseTo(1);
	});

	it("unrolls strips and fans into triangles", () => {
		for (const mode of [5, 6]) {
			const mesh = parseGlb(fourVertices(mode))!;
			expect(mesh.points).toBe(false);
			expect(mesh.triangles).toBe(2);
		}
	});

	it("reads a skinned triangle and its animation", () => {
		const mesh = parseGlb(slidingTriangle())!;
		expect(mesh.triangles).toBe(1);
		expect(mesh.skin?.bones).toBe(1);
		expect(mesh.skin?.animations).toEqual([
			{ name: "Slide", duration: 1 },
			{ name: "Hold", duration: 1 },
		]);
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

	it("poses the animation it's asked for", () => {
		const skin = parseGlb(slidingTriangle())!.skin!;
		const at = (t: number, animation: number) => {
			const out = new Float32Array(16);
			skin.pose(t, out, animation);
			return out[12];
		};
		expect(at(0.5, 1)).toBeCloseTo(at(0, 1), 5);
		expect(at(0.5, 0)).not.toBeCloseTo(at(0, 0), 2);
		// One it doesn't have falls back to the first.
		expect(at(0.5, 7)).toBeCloseTo(at(0.5, 0), 5);
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
