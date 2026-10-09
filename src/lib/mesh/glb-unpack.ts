import type { DecoderModule, Mesh as DracoMesh } from "draco3d";
import type { MeshoptDecoder as Meshopt } from "meshoptimizer/decoder";
import { viewBytes, type Gltf, type UnpackedViews } from "./glb";

const DRACO = "KHR_draco_mesh_compression";
const MESHOPT = "EXT_meshopt_compression";

export interface Decoders {
	meshopt(): Promise<typeof Meshopt>;
	draco(): Promise<DecoderModule>;
}

/** Each loads only when a file needs it, and once. */
const browserDecoders: Decoders = {
	meshopt: once(async () => {
		const { MeshoptDecoder } = await import("meshoptimizer/decoder");
		await MeshoptDecoder.ready;
		return MeshoptDecoder;
	}),
	draco: once(async () => {
		const [{ default: create }, { default: wasmUrl }] = await Promise.all([
			import("draco3d/draco_decoder_nodejs.js"),
			import("draco3d/draco_decoder.wasm?url"),
		]);
		const wasmBinary = await (await fetch(wasmUrl)).arrayBuffer();
		return create({ wasmBinary });
	}),
};

function once<T>(load: () => Promise<T>): () => Promise<T> {
	let pending: Promise<T> | null = null;
	return () =>
		(pending ??= load().catch((err: unknown) => {
			pending = null;
			throw err;
		}));
}

/** Decompresses meshopt views, and decodes Draco primitives into new views that
 * their accessors are pointed at, so `parseGltf` reads both as plain data. */
export async function unpackGltf(
	json: Gltf,
	bin: Uint8Array,
	decoders: Decoders = browserDecoders,
): Promise<UnpackedViews> {
	const unpacked: UnpackedViews = new Map();
	const used = json.extensionsUsed ?? [];
	if (used.includes(MESHOPT)) {
		const meshopt = await decoders.meshopt();
		json.bufferViews?.forEach((view, i) => {
			const ext = view.extensions?.[MESHOPT];
			if (!ext) return;
			const start = ext.byteOffset ?? 0;
			const target = new Uint8Array(ext.count * ext.byteStride);
			meshopt.decodeGltfBuffer(
				target,
				ext.count,
				ext.byteStride,
				bin.subarray(start, start + ext.byteLength),
				ext.mode,
				ext.filter,
			);
			unpacked.set(i, target);
		});
	}
	if (used.includes(DRACO)) {
		const draco = await decoders.draco();
		for (const mesh of json.meshes ?? []) {
			for (const prim of mesh.primitives) {
				const ext = prim.extensions?.[DRACO];
				const bytes = ext && viewBytes(json, bin, ext.bufferView, unpacked);
				if (bytes) decodeDraco(draco, json, prim, ext, bytes, unpacked);
			}
		}
	}
	return unpacked;
}

type Primitive = NonNullable<Gltf["meshes"]>[number]["primitives"][number];

const COMPONENTS: Record<string, number> = {
	SCALAR: 1,
	VEC2: 2,
	VEC3: 3,
	VEC4: 4,
};

function decodeDraco(
	draco: DecoderModule,
	json: Gltf,
	prim: Primitive,
	ext: NonNullable<NonNullable<Primitive["extensions"]>[typeof DRACO]>,
	bytes: Uint8Array,
	unpacked: UnpackedViews,
) {
	const decoder = new draco.Decoder();
	const buffer = new draco.DecoderBuffer();
	buffer.Init(
		new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
		bytes.byteLength,
	);
	const isMesh =
		decoder.GetEncodedGeometryType(buffer) === draco.TRIANGULAR_MESH;
	const geometry = isMesh ? new draco.Mesh() : new draco.PointCloud();
	try {
		const status = isMesh
			? decoder.DecodeBufferToMesh(buffer, geometry as DracoMesh)
			: decoder.DecodeBufferToPointCloud(buffer, geometry);
		if (!status.ok()) return;
		const points = geometry.num_points();
		// A new view holding `data`, with the accessor pointed at it.
		const place = (
			accessor: number,
			data: Uint8Array,
			componentType: number,
			count: number,
		) => {
			const acc = json.accessors?.[accessor];
			if (!acc) return;
			json.bufferViews ??= [];
			const view = json.bufferViews.push({ byteLength: data.byteLength }) - 1;
			unpacked.set(view, data);
			Object.assign(acc, {
				bufferView: view,
				byteOffset: 0,
				componentType,
				count,
			});
		};
		for (const [name, id] of Object.entries(ext.attributes)) {
			const accessor = prim.attributes[name];
			const acc = json.accessors?.[accessor];
			if (!acc) continue;
			const attribute = decoder.GetAttributeByUniqueId(geometry, id);
			const size = COMPONENTS[acc.type] ?? 1;
			const type = DRACO_TYPES[acc.componentType] ?? DRACO_TYPES[5126];
			const byteLength = points * size * type.width;
			const ptr = draco._malloc(byteLength);
			decoder.GetAttributeDataArrayForAllPoints(
				geometry,
				attribute,
				draco[type.name],
				byteLength,
				ptr,
			);
			place(
				accessor,
				draco.HEAPU8.slice(ptr, ptr + byteLength),
				acc.componentType,
				points,
			);
			draco._free(ptr);
		}
		if (isMesh && prim.indices !== undefined) {
			const mesh = geometry as DracoMesh;
			const count = mesh.num_faces() * 3;
			const ptr = draco._malloc(count * 4);
			decoder.GetTrianglesUInt32Array(mesh, count * 4, ptr);
			place(
				prim.indices,
				draco.HEAPU8.slice(ptr, ptr + count * 4),
				5125,
				count,
			);
			draco._free(ptr);
		}
	} finally {
		draco.destroy(geometry);
		draco.destroy(buffer);
		draco.destroy(decoder);
	}
}

/** Decoded in the accessor's own type, so normalised integers stay normalised. */
const DRACO_TYPES: Record<
	number,
	{
		name:
			| "DT_INT8"
			| "DT_UINT8"
			| "DT_INT16"
			| "DT_UINT16"
			| "DT_UINT32"
			| "DT_FLOAT32";
		width: number;
	}
> = {
	5120: { name: "DT_INT8", width: 1 },
	5121: { name: "DT_UINT8", width: 1 },
	5122: { name: "DT_INT16", width: 2 },
	5123: { name: "DT_UINT16", width: 2 },
	5125: { name: "DT_UINT32", width: 4 },
	5126: { name: "DT_FLOAT32", width: 4 },
};
