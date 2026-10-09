import { describe, expect, it } from "bun:test";
import { createDecoderModule, createEncoderModule } from "draco3d";
import { MeshoptDecoder } from "meshoptimizer/decoder";
import { MeshoptEncoder } from "meshoptimizer/encoder";
import { parseGltf, readGlb } from "./glb";
import { packGlb } from "./glb-fixtures";
import { unpackGltf, type Decoders } from "./glb-unpack";

const decoders: Decoders = {
	meshopt: async () => {
		await MeshoptDecoder.ready;
		return MeshoptDecoder;
	},
	draco: () => createDecoderModule({}),
};

/** A unit quad, red on one corner. */
const QUAD = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
const COLORS = new Uint8Array([255, 0, 0, 255, ...new Array(12).fill(255)]);
const FACES = new Uint32Array([0, 1, 2, 0, 2, 3]);

function concat(parts: Uint8Array[]): { bin: ArrayBuffer; at: number[] } {
	const at: number[] = [];
	let length = 0;
	for (const p of parts) {
		at.push(length);
		length += Math.ceil(p.length / 4) * 4;
	}
	const out = new Uint8Array(length);
	parts.forEach((p, i) => out.set(p, at[i]));
	return { bin: out.buffer, at };
}

async function dracoQuad(): Promise<Uint8Array> {
	const draco = await createEncoderModule({});
	const builder = new draco.MeshBuilder();
	const mesh = new draco.Mesh();
	builder.AddFacesToMesh(mesh, 2, FACES);
	const position = builder.AddFloatAttribute(mesh, draco.POSITION, 4, 3, QUAD);
	const color = builder.AddUInt8Attribute(mesh, draco.COLOR, 4, 4, COLORS);
	const encoder = new draco.Encoder();
	const out = new draco.DracoInt8Array();
	const length = encoder.EncodeMeshToDracoBuffer(mesh, out);
	const bytes = new Uint8Array(length);
	for (let i = 0; i < length; i++) bytes[i] = out.GetValue(i);
	[out, encoder, mesh, builder].forEach((o) => draco.destroy(o));
	return packGlb(
		{
			asset: { version: "2.0" },
			extensionsUsed: ["KHR_draco_mesh_compression"],
			scene: 0,
			scenes: [{ nodes: [0] }],
			nodes: [{ mesh: 0 }],
			meshes: [
				{
					primitives: [
						{
							attributes: { POSITION: 0, COLOR_0: 1 },
							indices: 2,
							extensions: {
								KHR_draco_mesh_compression: {
									bufferView: 0,
									attributes: { POSITION: position, COLOR_0: color },
								},
							},
						},
					],
				},
			],
			accessors: [
				{ componentType: 5126, count: 4, type: "VEC3" },
				{ componentType: 5121, normalized: true, count: 4, type: "VEC4" },
				{ componentType: 5123, count: 6, type: "SCALAR" },
			],
			bufferViews: [{ byteOffset: 0, byteLength: length }],
		},
		concat([bytes]).bin,
	);
}

async function meshoptQuad(): Promise<Uint8Array> {
	await MeshoptEncoder.ready;
	const indices = new Uint16Array(FACES);
	const vertices = MeshoptEncoder.encodeGltfBuffer(
		new Uint8Array(QUAD.buffer),
		4,
		12,
		"ATTRIBUTES",
	);
	const faces = MeshoptEncoder.encodeGltfBuffer(
		new Uint8Array(indices.buffer),
		6,
		2,
		"TRIANGLES",
	);
	const { bin, at } = concat([vertices, faces]);
	const view = (
		i: number,
		data: Uint8Array,
		stride: number,
		count: number,
		mode: string,
	) => ({
		buffer: 1,
		byteLength: stride * count,
		...(mode === "ATTRIBUTES" ? { byteStride: stride } : {}),
		extensions: {
			EXT_meshopt_compression: {
				buffer: 0,
				byteOffset: at[i],
				byteLength: data.length,
				byteStride: stride,
				count,
				mode,
			},
		},
	});
	return packGlb(
		{
			asset: { version: "2.0" },
			extensionsUsed: ["EXT_meshopt_compression"],
			buffers: [
				{ byteLength: bin.byteLength },
				{
					byteLength: 60,
					extensions: { EXT_meshopt_compression: { fallback: true } },
				},
			],
			scene: 0,
			scenes: [{ nodes: [0] }],
			nodes: [{ mesh: 0 }],
			meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
			accessors: [
				{ bufferView: 0, componentType: 5126, count: 4, type: "VEC3" },
				{ bufferView: 1, componentType: 5123, count: 6, type: "SCALAR" },
			],
			bufferViews: [
				view(0, vertices, 12, 4, "ATTRIBUTES"),
				view(1, faces, 2, 6, "TRIANGLES"),
			],
		},
		bin,
	);
}

async function parse(bytes: Uint8Array) {
	const { json, bin } = readGlb(bytes)!;
	return parseGltf(json, bin, await unpackGltf(json, bin, decoders));
}

describe("unpackGltf", () => {
	it("decodes a Draco primitive with its colours", async () => {
		const mesh = (await parse(await dracoQuad()))!;
		expect(mesh.triangles).toBe(2);
		const reds = Array.from({ length: 6 }, (_, v) => mesh.colors![v * 3 + 1]);
		expect(reds.filter((g) => g === 0)).toHaveLength(2);
	});

	it("decompresses meshopt views", async () => {
		const mesh = (await parse(await meshoptQuad()))!;
		expect(mesh.triangles).toBe(2);
		// The fitted quad's corners sit on the unit circle.
		const r = Math.hypot(mesh.positions[0], mesh.positions[1]);
		expect(r).toBeCloseTo(1);
	});
});
