import { compose, identity, multiply, slerp, type Mat4 } from "./mat4";
import { MeshBuilder, type Mesh, type Morph, type Rig } from "./mesh";

interface GltfNode {
	children?: number[];
	mesh?: number;
	weights?: number[];
	skin?: number;
	matrix?: number[];
	translation?: number[];
	rotation?: number[];
	scale?: number[];
}

export interface Gltf {
	extensionsUsed?: string[];
	scene?: number;
	scenes?: { nodes?: number[] }[];
	nodes?: GltfNode[];
	meshes?: {
		weights?: number[];
		primitives: {
			attributes: Record<string, number>;
			targets?: Record<string, number>[];
			indices?: number;
			material?: number;
			mode?: number;
			extensions?: {
				KHR_draco_mesh_compression?: {
					bufferView: number;
					attributes: Record<string, number>;
				};
			};
		}[];
	}[];
	skins?: { joints: number[]; inverseBindMatrices?: number }[];
	animations?: {
		name?: string;
		channels: { sampler: number; target: { node?: number; path: string } }[];
		samplers: { input: number; output: number; interpolation?: string }[];
	}[];
	materials?: {
		pbrMetallicRoughness?: {
			baseColorFactor?: number[];
			baseColorTexture?: { index: number };
		};
	}[];
	textures?: { source?: number }[];
	images?: { bufferView?: number; mimeType?: string }[];
	accessors?: {
		bufferView?: number;
		byteOffset?: number;
		componentType: number;
		normalized?: boolean;
		count: number;
		type: string;
	}[];
	bufferViews?: GltfBufferView[];
}

export interface GltfBufferView {
	byteOffset?: number;
	byteLength: number;
	byteStride?: number;
	extensions?: {
		EXT_meshopt_compression?: {
			byteOffset?: number;
			byteLength: number;
			byteStride: number;
			count: number;
			mode: string;
			filter?: string;
		};
	};
}

/** Buffer views decompressed ahead of parsing, by index; they start at byte 0. */
export type UnpackedViews = Map<number, Uint8Array>;

const COMPONENTS: Record<string, number> = {
	SCALAR: 1,
	VEC2: 2,
	VEC3: 3,
	VEC4: 4,
	MAT4: 16,
};

/** Binary glTF: meshes or point clouds with materials, skins and the first
 * animation. Images must be embedded; external buffers aren't reachable from a
 * single file. */
export function parseGlb(bytes: Uint8Array): Mesh | null {
	const glb = readGlb(bytes);
	return glb && parseGltf(glb.json, glb.bin);
}

/** The JSON and binary chunks of a GLB; null for anything else. */
export function readGlb(
	bytes: Uint8Array,
): { json: Gltf; bin: Uint8Array } | null {
	const chunks = readChunks(bytes);
	if (!chunks) return null;
	const json = JSON.parse(new TextDecoder().decode(chunks.json)) as Gltf;
	return { json, bin: chunks.bin };
}

/** A view's bytes, from `unpacked` when it was compressed. */
export function viewBytes(
	json: Gltf,
	bin: Uint8Array,
	index: number,
	unpacked?: UnpackedViews,
): Uint8Array | null {
	const done = unpacked?.get(index);
	if (done) return done;
	const view = json.bufferViews?.[index];
	if (!view) return null;
	const start = view.byteOffset ?? 0;
	return bin.subarray(start, start + view.byteLength);
}

/** Draco and meshopt files go through `unpackGltf` first. */
export function parseGltf(
	json: Gltf,
	bin: Uint8Array,
	unpacked?: UnpackedViews,
): Mesh | null {
	const nodes = json.nodes ?? [];

	const accessor = (index: number): { data: Float32Array; size: number } => {
		const acc = json.accessors?.[index];
		if (!acc) throw new Error("missing accessor");
		const size = COMPONENTS[acc.type] ?? 1;
		const data = new Float32Array(acc.count * size);
		const view =
			acc.bufferView === undefined ? null : json.bufferViews?.[acc.bufferView];
		const bytes =
			acc.bufferView === undefined
				? null
				: viewBytes(json, bin, acc.bufferView, unpacked);
		if (!view || !bytes) return { data, size };
		const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const width = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[
			acc.componentType
		];
		if (!width) throw new Error("bad component type");
		const stride = view.byteStride || width * size;
		const start = acc.byteOffset ?? 0;
		const norm = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[
			acc.componentType
		];
		for (let i = 0; i < acc.count; i++) {
			for (let c = 0; c < size; c++) {
				const at = start + i * stride + c * width;
				let v: number;
				switch (acc.componentType) {
					case 5120:
						v = dv.getInt8(at);
						break;
					case 5121:
						v = dv.getUint8(at);
						break;
					case 5122:
						v = dv.getInt16(at, true);
						break;
					case 5123:
						v = dv.getUint16(at, true);
						break;
					case 5125:
						v = dv.getUint32(at, true);
						break;
					default:
						v = dv.getFloat32(at, true);
				}
				data[i * size + c] =
					acc.normalized && norm ? Math.max(v / norm, -1) : v;
			}
		}
		return { data, size };
	};

	// Parents first, from the scene's roots down.
	const parent = new Array<number>(nodes.length).fill(-1);
	nodes.forEach((n, i) => n.children?.forEach((c) => (parent[c] = i)));
	const order: number[] = [];
	const visit = (i: number) => {
		order.push(i);
		nodes[i].children?.forEach(visit);
	};
	const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
	roots.forEach(visit);

	const bones: { node: number; inverseBind: Mat4 }[] = [];
	const boneOf = new Map<string, number>();
	const boneFor = (key: string, node: number, inverseBind: Mat4) => {
		let slot = boneOf.get(key);
		if (slot === undefined) {
			slot = bones.length;
			bones.push({ node, inverseBind });
			boneOf.set(key, slot);
		}
		return slot;
	};

	const builder = new MeshBuilder({ uv: true, skin: true });
	// Morph targets: offsets per emitted triangle corner, and each node's weight slots.
	const morphLayout: number[] = [];
	const morphDeltas: number[] = [];
	const weightSlots = new Map<number, { base: number; defaults: number[] }>();
	let slots = 0;
	/** Image index to texture layer. */
	const layerOf = new Map<number, number>();
	const imageOf = (material: number | undefined) => {
		const tex =
			json.materials?.[material ?? -1]?.pbrMetallicRoughness?.baseColorTexture
				?.index;
		return tex === undefined ? undefined : json.textures?.[tex]?.source;
	};

	for (const nodeIndex of order) {
		const node = nodes[nodeIndex];
		if (node.mesh === undefined) continue;
		const skin = node.skin === undefined ? null : json.skins?.[node.skin];
		const ibms = skin?.inverseBindMatrices
			? accessor(skin.inverseBindMatrices).data
			: null;
		for (const prim of json.meshes?.[node.mesh]?.primitives ?? []) {
			const mode = prim.mode ?? TRIANGLES;
			if (!DRAWN_MODES.has(mode) || prim.attributes.POSITION === undefined) {
				continue;
			}
			const pos = accessor(prim.attributes.POSITION).data;
			const nrm =
				prim.attributes.NORMAL === undefined
					? null
					: accessor(prim.attributes.NORMAL).data;
			const uv =
				prim.attributes.TEXCOORD_0 === undefined
					? null
					: accessor(prim.attributes.TEXCOORD_0).data;
			const jnt =
				skin && prim.attributes.JOINTS_0 !== undefined
					? accessor(prim.attributes.JOINTS_0).data
					: null;
			const wgt =
				skin && prim.attributes.WEIGHTS_0 !== undefined
					? accessor(prim.attributes.WEIGHTS_0).data
					: null;
			// Vertex colours, RGB or RGBA; low-poly models often carry these instead of a texture.
			const vcol =
				prim.attributes.COLOR_0 === undefined
					? null
					: accessor(prim.attributes.COLOR_0);
			const index =
				prim.indices === undefined ? null : accessor(prim.indices).data;

			const source = imageOf(prim.material);
			if (source !== undefined && !layerOf.has(source)) {
				layerOf.set(source, layerOf.size);
			}
			const textured = source === undefined ? 0 : layerOf.get(source)! + 1;
			const factor =
				json.materials?.[prim.material ?? -1]?.pbrMetallicRoughness
					?.baseColorFactor ?? WHITE;

			// Skinned vertices index the skin's joints; rigid ones ride their node.
			const slotOfJoint = skin
				? skin.joints.map((joint, j) =>
						boneFor(
							`${node.skin}:${j}`,
							joint,
							ibms
								? Array.from(ibms.subarray(j * 16, j * 16 + 16))
								: identity(),
						),
					)
				: [boneFor(`n${nodeIndex}`, nodeIndex, identity())];

			const corner = (v: number) => ({
				p: pos.subarray(v * 3, v * 3 + 3),
				n: nrm?.subarray(v * 3, v * 3 + 3) ?? null,
				uv: [uv?.[v * 2] ?? 0, uv?.[v * 2 + 1] ?? 0, uv ? textured : 0],
				j: [0, 1, 2, 3].map((k) =>
					jnt ? (slotOfJoint[jnt[v * 4 + k]] ?? 0) : slotOfJoint[0],
				),
				w: weightsAt(wgt, v),
				col: vcol
					? [0, 1, 2].map((k) => factor[k] * vcol.data[v * vcol.size + k])
					: [factor[0], factor[1], factor[2]],
			});
			const count = index ? index.length : pos.length / 3;
			const vertexAt = (i: number) => (index ? index[i] : i);
			const targets = (prim.targets ?? []).map((t) =>
				t.POSITION === undefined ? null : accessor(t.POSITION).data,
			);
			if (mode === POINTS) {
				for (let i = 0; i < count; i++) {
					const c = corner(vertexAt(i));
					builder.point(c.p, c.col, { uv: c.uv, joints: c.j, weights: c.w });
				}
				continue;
			}
			const tris = triangleCorners(mode, count);
			const corners = tris.length * 3;
			let morph = [0, 0, 0, 0];
			if (targets.length > 0) {
				let slot = weightSlots.get(nodeIndex);
				if (!slot) {
					const defaults =
						node.weights ?? json.meshes?.[node.mesh]?.weights ?? [];
					slot = {
						base: slots,
						defaults: targets.map((_, k) => defaults[k] ?? 0),
					};
					weightSlots.set(nodeIndex, slot);
					slots += targets.length;
				}
				const first = morphLayout.length / 4;
				const at = morphDeltas.length / 3;
				morph = [at - first, slot.base, targets.length, corners];
				for (let n = targets.length * corners * 3; n > 0; n--)
					morphDeltas.push(0);
				targets.forEach((t, k) => {
					if (!t) return;
					tris.forEach((tri, n) =>
						tri.forEach((i, j) => {
							const v = vertexAt(i);
							const to = (at + k * corners + n * 3 + j) * 3;
							for (let c = 0; c < 3; c++) morphDeltas[to + c] = t[v * 3 + c];
						}),
					);
				});
			}
			for (const tri of tris) {
				morphLayout.push(...morph, ...morph, ...morph);
				const c = tri.map((i) => corner(vertexAt(i)));
				builder.triangle(
					c[0].p,
					c[1].p,
					c[2].p,
					c.every((x) => x.n) ? [c[0].n!, c[1].n!, c[2].n!] : null,
					[c[0].col, c[1].col, c[2].col],
					{
						uvs: [c[0].uv, c[1].uv, c[2].uv],
						joints: [c[0].j, c[1].j, c[2].j],
						weights: [c[0].w, c[1].w, c[2].w],
					},
				);
			}
		}
	}
	if (bones.length === 0) return null;

	const rig = buildRig(
		json,
		nodes,
		parent,
		order,
		bones,
		accessor,
		weightSlots,
	);
	const mesh = builder.buildSkinned(rig);
	if (!mesh) return null;
	if (slots > 0 && !mesh.points && rig.weights) {
		mesh.morph = {
			deltas: new Float32Array(morphDeltas),
			layout: new Int32Array(morphLayout),
			slots,
			weights: rig.weights,
		} satisfies Morph;
	}
	// An image outside the file decodes to nothing and draws untextured.
	mesh.images = [...layerOf.keys()].map((image) => ({
		bytes:
			viewBytes(json, bin, json.images?.[image]?.bufferView ?? -1)?.slice() ??
			new Uint8Array(0),
		mime: json.images?.[image]?.mimeType ?? "image/png",
	}));
	if (mesh.images.length === 0) mesh.uvs = null;
	return mesh;
}

const WHITE = [1, 1, 1];

const POINTS = 0;
const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const TRIANGLE_FAN = 6;
/** Lines are left out: they have no surface to draw. */
const DRAWN_MODES = new Set([POINTS, TRIANGLES, TRIANGLE_STRIP, TRIANGLE_FAN]);

/** The corners of each triangle a list, strip or fan of `count` vertices draws. */
function triangleCorners(mode: number, count: number): number[][] {
	const tris: number[][] = [];
	if (mode === TRIANGLE_STRIP) {
		// Every other strip triangle swaps two corners to keep the winding.
		for (let i = 0; i + 2 < count; i++) {
			tris.push(i % 2 ? [i + 1, i, i + 2] : [i, i + 1, i + 2]);
		}
	} else if (mode === TRIANGLE_FAN) {
		for (let i = 1; i + 1 < count; i++) tris.push([0, i, i + 1]);
	} else {
		for (let i = 0; i + 2 < count; i += 3) tris.push([i, i + 1, i + 2]);
	}
	return tris;
}

/** Influences that add up to one; a vertex with none follows its first bone. */
function weightsAt(wgt: Float32Array | null, v: number): number[] {
	if (!wgt) return [1, 0, 0, 0];
	const w = [0, 1, 2, 3].map((k) => wgt[v * 4 + k]);
	const sum = w[0] + w[1] + w[2] + w[3];
	return sum > 1e-6 ? w.map((x) => x / sum) : [1, 0, 0, 0];
}

function readChunks(
	bytes: Uint8Array,
): { json: Uint8Array; bin: Uint8Array } | null {
	if (bytes.length < 20) return null;
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	// "glTF"
	if (dv.getUint32(0, true) !== 0x46546c67) return null;
	let json: Uint8Array | null = null;
	let bin: Uint8Array = new Uint8Array(0);
	for (let at = 12; at + 8 <= bytes.length;) {
		const len = dv.getUint32(at, true);
		const type = dv.getUint32(at + 4, true);
		const body = bytes.subarray(at + 8, at + 8 + len);
		if (type === 0x4e4f534a) json = body;
		else if (type === 0x004e4942) bin = body;
		at += 8 + len;
	}
	return json ? { json, bin } : null;
}

interface Track {
	node: number;
	path: "translation" | "rotation" | "scale" | "weights";
	times: Float32Array;
	values: Float32Array;
	size: number;
	step: boolean;
	cubic: boolean;
}

function buildRig(
	json: Gltf,
	nodes: GltfNode[],
	parent: number[],
	order: number[],
	bones: { node: number; inverseBind: Mat4 }[],
	accessor: (i: number) => { data: Float32Array; size: number },
	weightSlots: Map<number, { base: number; defaults: number[] }>,
): Rig {
	const clips = (json.animations ?? []).map((anim, i) => {
		const tracks: Track[] = [];
		let duration = 0;
		for (const ch of anim.channels) {
			const sampler = anim.samplers[ch.sampler];
			const path = ch.target.path;
			if (
				ch.target.node === undefined ||
				!sampler ||
				(path !== "translation" &&
					path !== "rotation" &&
					path !== "scale" &&
					(path !== "weights" || !weightSlots.has(ch.target.node)))
			) {
				continue;
			}
			const times = accessor(sampler.input).data;
			const out = accessor(sampler.output);
			tracks.push({
				node: ch.target.node,
				path,
				times,
				values: out.data,
				size:
					path === "weights"
						? weightSlots.get(ch.target.node)!.defaults.length
						: path === "rotation"
							? 4
							: 3,
				step: sampler.interpolation === "STEP",
				cubic: sampler.interpolation === "CUBICSPLINE",
			});
			if (times.length) duration = Math.max(duration, times[times.length - 1]);
		}
		return { name: anim.name || `Animation ${i + 1}`, duration, tracks };
	});

	const rest = nodes.map((n) => {
		if (n.matrix) return { matrix: n.matrix as Mat4 };
		return {
			t: n.translation ?? [0, 0, 0],
			r: n.rotation ?? [0, 0, 0, 1],
			s: n.scale ?? [1, 1, 1],
		};
	});

	const loop = (time: number, duration: number) =>
		duration > 0 ? ((time % duration) + duration) % duration : 0;

	return {
		bones: bones.length,
		animations: clips.map(({ name, duration }) => ({ name, duration })),
		weights(time, out, animation = 0) {
			for (const { base, defaults } of weightSlots.values()) {
				out.set(defaults, base);
			}
			const clip = clips[animation] ?? clips[0];
			if (!clip) return;
			const t = loop(time, clip.duration);
			for (const track of clip.tracks) {
				if (track.path !== "weights") continue;
				out.set(sample(track, t), weightSlots.get(track.node)!.base);
			}
		},
		pose(time, out, animation = 0) {
			const clip = clips[animation] ?? clips[0];
			const duration = clip?.duration ?? 0;
			const tracks = clip?.tracks ?? [];
			const t = loop(time, duration);
			const local = rest.map((r) => ({
				t: r.t?.slice(),
				r: r.r?.slice(),
				s: r.s?.slice(),
				matrix: r.matrix,
			}));
			for (const track of tracks) {
				if (track.path === "weights") continue;
				const target = local[track.node];
				const key =
					track.path === "translation"
						? "t"
						: track.path === "rotation"
							? "r"
							: "s";
				// An animated node takes its transform from the track, not its rest matrix.
				target.matrix = undefined;
				target.t ??= [0, 0, 0];
				target.r ??= [0, 0, 0, 1];
				target.s ??= [1, 1, 1];
				target[key] = sample(track, t);
			}
			const world: Mat4[] = new Array(nodes.length);
			for (const i of order) {
				const l = local[i];
				const m = l.matrix ?? compose(l.t!, l.r!, l.s!);
				world[i] = parent[i] >= 0 ? multiply(world[parent[i]], m) : m;
			}
			bones.forEach((bone, b) => {
				const m = multiply(world[bone.node] ?? identity(), bone.inverseBind);
				for (let i = 0; i < 16; i++) out[b * 16 + i] = m[i];
			});
		},
	};
}

function sample(track: Track, t: number): number[] {
	const { times, values, size } = track;
	const n = times.length;
	const stride = track.cubic ? size * 3 : size;
	// Cubic tracks hold in-tangent, value, out-tangent; the value is enough here.
	const at = (k: number) =>
		Array.from(
			values.subarray(
				k * stride + (track.cubic ? size : 0),
				k * stride + (track.cubic ? size : 0) + size,
			),
		);
	if (n === 0) {
		return track.path === "rotation" ? [0, 0, 0, 1] : new Array(size).fill(0);
	}
	if (t <= times[0] || n === 1) return at(0);
	if (t >= times[n - 1]) return at(n - 1);
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (times[mid] <= t) lo = mid;
		else hi = mid;
	}
	const a = at(lo);
	if (track.step) return a;
	const f = (t - times[lo]) / (times[hi] - times[lo]);
	const b = at(hi);
	return track.path === "rotation"
		? slerp(a, b, f)
		: a.map((v, i) => v + (b[i] - v) * f);
}
