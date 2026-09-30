import {
	identity,
	invert,
	multiply,
	rotationAxis,
	scaling,
	translation,
	type Mat4,
} from "./mat4";
import { MeshBuilder, type Mesh, type Rig } from "./mesh";

interface FbxNode {
	name: string;
	props: unknown[];
	children: FbxNode[];
}

const MAGIC = "Kaydara FBX Binary";
/** FBX time is in ticks of 1/46186158000 s. */
const TICKS_PER_SECOND = 46186158000;

/** Binary FBX: meshes with their skin, materials, an embedded texture and the
 * first animation stack. ASCII FBX and textures kept in separate files aren't read. */
export async function parseFbx(bytes: Uint8Array): Promise<Mesh | null> {
	const root = await readTree(bytes);
	return root ? build(root) : null;
}

export async function readTree(bytes: Uint8Array): Promise<FbxNode | null> {
	const head = new TextDecoder().decode(bytes.subarray(0, MAGIC.length));
	if (head !== MAGIC) return null;
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = dv.getUint32(23, true);
	const wide = version >= 7500;
	const headerSize = wide ? 25 : 13;
	const pending: Promise<void>[] = [];
	let pos = 27;

	const word = (at: number) =>
		wide ? Number(dv.getBigUint64(at, true)) : dv.getUint32(at, true);

	const readArray = (type: string, props: unknown[], slot: number): void => {
		const count = dv.getUint32(pos, true);
		const encoding = dv.getUint32(pos + 4, true);
		const byteLength = dv.getUint32(pos + 8, true);
		const raw = bytes.subarray(pos + 12, pos + 12 + byteLength);
		pos += 12 + byteLength;
		const decode = (data: Uint8Array) => {
			const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
			switch (type) {
				case "d":
					return Float64Array.from({ length: count }, (_, i) =>
						view.getFloat64(i * 8, true),
					);
				case "f":
					return Float32Array.from({ length: count }, (_, i) =>
						view.getFloat32(i * 4, true),
					);
				case "l":
					return Array.from({ length: count }, (_, i) =>
						Number(view.getBigInt64(i * 8, true)),
					);
				case "i":
					return Int32Array.from({ length: count }, (_, i) =>
						view.getInt32(i * 4, true),
					);
				default:
					return data.slice(0, count);
			}
		};
		if (encoding === 0) props[slot] = decode(raw);
		else
			pending.push(
				inflate(raw).then((data) => void (props[slot] = decode(data))),
			);
	};

	const readProps = (count: number): unknown[] => {
		const props: unknown[] = new Array(count);
		for (let i = 0; i < count; i++) {
			const type = String.fromCharCode(bytes[pos++]);
			switch (type) {
				case "Y":
					props[i] = dv.getInt16(pos, true);
					pos += 2;
					break;
				case "C":
					props[i] = bytes[pos++] !== 0;
					break;
				case "I":
					props[i] = dv.getInt32(pos, true);
					pos += 4;
					break;
				case "F":
					props[i] = dv.getFloat32(pos, true);
					pos += 4;
					break;
				case "D":
					props[i] = dv.getFloat64(pos, true);
					pos += 8;
					break;
				case "L":
					props[i] = Number(dv.getBigInt64(pos, true));
					pos += 8;
					break;
				case "S": {
					const len = dv.getUint32(pos, true);
					props[i] = new TextDecoder().decode(
						bytes.subarray(pos + 4, pos + 4 + len),
					);
					pos += 4 + len;
					break;
				}
				case "R": {
					const len = dv.getUint32(pos, true);
					props[i] = bytes.slice(pos + 4, pos + 4 + len);
					pos += 4 + len;
					break;
				}
				case "f":
				case "d":
				case "l":
				case "i":
				case "b":
					readArray(type, props, i);
					break;
				default:
					throw new Error(`bad FBX property type ${type}`);
			}
		}
		return props;
	};

	const readNode = (): FbxNode | null => {
		const end = word(pos);
		const count = word(pos + (wide ? 8 : 4));
		const nameLength = bytes[pos + (wide ? 24 : 12)];
		if (end === 0) {
			pos += headerSize;
			return null;
		}
		pos += headerSize;
		const name = new TextDecoder().decode(
			bytes.subarray(pos, pos + nameLength),
		);
		pos += nameLength;
		const props = readProps(count);
		const children: FbxNode[] = [];
		while (pos < end) {
			const child = readNode();
			if (child) children.push(child);
		}
		pos = end;
		return { name, props, children };
	};

	const root: FbxNode = { name: "", props: [], children: [] };
	try {
		while (pos + headerSize <= bytes.length) {
			const node = readNode();
			if (!node) break;
			root.children.push(node);
		}
		await Promise.all(pending);
	} catch {
		return null;
	}
	return root;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
	const stream = new Blob([data as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream("deflate"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

const child = (node: FbxNode | undefined, name: string) =>
	node?.children.find((c) => c.name === name);
const kids = (node: FbxNode | undefined, name: string) =>
	node?.children.filter((c) => c.name === name) ?? [];
const numbers = (node: FbxNode | undefined, name: string): ArrayLike<number> =>
	(child(node, name)?.props[0] as ArrayLike<number> | undefined) ?? [];
const text = (node: FbxNode | undefined, name: string) =>
	(child(node, name)?.props[0] as string | undefined) ?? "";

/** A Properties70 entry's values, e.g. the three of "Lcl Rotation". */
function property(node: FbxNode, name: string): number[] | null {
	const p = kids(child(node, "Properties70"), "P").find(
		(x) => x.props[0] === name,
	);
	return p ? (p.props.slice(4) as number[]) : null;
}

interface FbxObject {
	id: number;
	type: string;
	kind: string;
	node: FbxNode;
}

interface Curve {
	times: number[];
	values: ArrayLike<number>;
}

const ROTATION_ORDERS = ["XYZ", "XZY", "YZX", "YXZ", "ZXY", "ZYX"];

function eulerMatrix(degrees: number[], order: number): Mat4 {
	let m = identity();
	for (const letter of ROTATION_ORDERS[order] ?? "XYZ") {
		const axis = "XYZ".indexOf(letter) as 0 | 1 | 2;
		m = multiply(rotationAxis(axis, (degrees[axis] * Math.PI) / 180), m);
	}
	return m;
}

function build(root: FbxNode): Mesh | null {
	const objectsNode = child(root, "Objects");
	if (!objectsNode) return null;
	const objects = new Map<number, FbxObject>();
	for (const node of objectsNode.children) {
		const id = node.props[0] as number;
		const [name, kind] = String(node.props[1] ?? "").split("\x00\x01");
		void name;
		objects.set(id, {
			id,
			type: node.name,
			kind: String(node.props[2] ?? kind ?? ""),
			node,
		});
	}

	// Connections: child -> parent, optionally naming the parent's property.
	const parentsOf = new Map<number, { parent: number; prop: string }[]>();
	const childrenOf = new Map<number, { child: number; prop: string }[]>();
	for (const c of child(root, "Connections")?.children ?? []) {
		const [, from, to, prop] = c.props as [string, number, number, string?];
		(parentsOf.get(from) ?? parentsOf.set(from, []).get(from)!).push({
			parent: to,
			prop: prop ?? "",
		});
		(childrenOf.get(to) ?? childrenOf.set(to, []).get(to)!).push({
			child: from,
			prop: prop ?? "",
		});
	}
	const childrenOfType = (id: number, type: string) =>
		(childrenOf.get(id) ?? [])
			.map((c) => ({ ...c, object: objects.get(c.child) }))
			.filter((c) => c.object?.type === type);

	const models = [...objects.values()].filter((o) => o.type === "Model");
	const modelIds = new Set(models.map((m) => m.id));

	// World transform of every model, animated.
	const parentModel = new Map<number, number | null>();
	for (const m of models) {
		const p = (parentsOf.get(m.id) ?? []).find((c) => modelIds.has(c.parent));
		parentModel.set(m.id, p ? p.parent : null);
	}
	const order: number[] = [];
	const seen = new Set<number>();
	const place = (id: number) => {
		if (seen.has(id)) return;
		seen.add(id);
		const p = parentModel.get(id);
		if (p !== null && p !== undefined) place(p);
		order.push(id);
	};
	models.forEach((m) => place(m.id));

	const curves = collectCurves(objects, parentsOf, childrenOf, modelIds);
	let start = Infinity;
	let stop = -Infinity;
	for (const perModel of curves.values()) {
		for (const perProp of perModel.values()) {
			for (const curve of perProp) {
				if (!curve || curve.times.length === 0) continue;
				start = Math.min(start, curve.times[0]);
				stop = Math.max(stop, curve.times[curve.times.length - 1]);
			}
		}
	}
	const duration = stop > start ? stop - start : 0;
	if (!Number.isFinite(start)) start = 0;

	const rest = new Map<
		number,
		{ values: Record<string, number[]>; order: number }
	>();
	for (const m of models) {
		const get = (name: string, fallback: number[]) =>
			property(m.node, name) ?? fallback;
		rest.set(m.id, {
			values: {
				"Lcl Translation": get("Lcl Translation", [0, 0, 0]),
				"Lcl Rotation": get("Lcl Rotation", [0, 0, 0]),
				"Lcl Scaling": get("Lcl Scaling", [1, 1, 1]),
				PreRotation: get("PreRotation", [0, 0, 0]),
				PostRotation: get("PostRotation", [0, 0, 0]),
			},
			order: get("RotationOrder", [0])[0] ?? 0,
		});
	}

	const upAxis = globalSetting(root, "UpAxis") ?? 1;
	const upFix = upAxis === 2 ? rotationAxis(0, -Math.PI / 2) : identity();

	const worldAt = (time: number, animated = true): Map<number, Mat4> => {
		const t = start + time;
		const world = new Map<number, Mat4>();
		for (const id of order) {
			const r = rest.get(id)!;
			const values: Record<string, number[]> = {};
			for (const prop of ["Lcl Translation", "Lcl Rotation", "Lcl Scaling"]) {
				const v = r.values[prop].slice();
				const axes = animated ? curves.get(id)?.get(prop) : undefined;
				axes?.forEach((curve, axis) => {
					if (curve && curve.times.length) v[axis] = sampleCurve(curve, t);
				});
				values[prop] = v;
			}
			const local = multiply(
				multiply(
					multiply(
						translation(
							...(values["Lcl Translation"] as [number, number, number]),
						),
						eulerMatrix(r.values.PreRotation, r.order),
					),
					multiply(
						eulerMatrix(values["Lcl Rotation"], r.order),
						invert(eulerMatrix(r.values.PostRotation, r.order)),
					),
				),
				scaling(...(values["Lcl Scaling"] as [number, number, number])),
			);
			const p = parentModel.get(id);
			world.set(
				id,
				p === null || p === undefined ? local : multiply(world.get(p)!, local),
			);
		}
		return world;
	};

	const restWorld = worldAt(0, false);
	const bones: { model: number; bind: Mat4 }[] = [];
	const boneOf = new Map<string, number>();
	const boneFor = (model: number, bind: Mat4, key: string) => {
		let slot = boneOf.get(key);
		if (slot === undefined) {
			slot = bones.length;
			bones.push({ model, bind });
			boneOf.set(key, slot);
		}
		return slot;
	};

	const builder = new MeshBuilder({ uv: true, skin: true });
	let image: { bytes: Uint8Array; mime: string } | null = null;
	let imageTexture: number | null = null;

	for (const meshModel of models) {
		for (const { object: geometry } of childrenOfType(
			meshModel.id,
			"Geometry",
		)) {
			if (!geometry || geometry.kind !== "Mesh") continue;
			const g = geometry.node;
			const vertices = numbers(g, "Vertices");
			const polygon = numbers(g, "PolygonVertexIndex");
			if (vertices.length === 0 || polygon.length === 0) continue;

			// Per control point: up to four bones, heaviest first.
			const influences = new Map<number, { slot: number; weight: number }[]>();
			for (const { object: skin } of childrenOfType(geometry.id, "Deformer")) {
				if (skin?.kind !== "Skin") continue;
				for (const { object: cluster } of childrenOfType(skin.id, "Deformer")) {
					if (cluster?.kind !== "Cluster") continue;
					const bone = childrenOfType(cluster.id, "Model")[0];
					if (!bone) continue;
					// The cluster's own `Transform` can't be trusted: some exporters write
					// the inverse bind matrix there. The mesh's rest transform is the bind.
					const link = numbers(cluster.node, "TransformLink");
					const bind = multiply(
						invert(link.length === 16 ? Array.from(link) : identity()),
						restWorld.get(meshModel.id) ?? identity(),
					);
					const slot = boneFor(
						bone.child,
						bind,
						`${geometry.id}:${bone.child}`,
					);
					const idx = numbers(cluster.node, "Indexes");
					const wts = numbers(cluster.node, "Weights");
					for (let i = 0; i < idx.length; i++) {
						const list = influences.get(idx[i]) ?? [];
						list.push({ slot, weight: wts[i] });
						influences.set(idx[i], list);
					}
				}
			}
			const rigid = boneFor(meshModel.id, identity(), `rigid:${meshModel.id}`);

			const normals = layer(g, "LayerElementNormal", "Normals", "NormalsIndex");
			const uvs = layer(g, "LayerElementUV", "UV", "UVIndex");
			const materialNode = child(g, "LayerElementMaterial");
			const materialIndex = numbers(materialNode, "Materials");
			const allSame =
				text(materialNode, "MappingInformationType") === "AllSame";
			const materials = childrenOfType(meshModel.id, "Material");

			const info = materials.map(({ object }) => {
				const rgb = (object && property(object.node, "DiffuseColor")) ?? [
					0.8, 0.8, 0.8,
				];
				let textured = false;
				if (object) {
					const tex = childrenOfType(object.id, "Texture").find(
						(t) => t.prop === "DiffuseColor",
					);
					const video = tex && childrenOfType(tex.child, "Video")[0];
					const content =
						video?.object && child(video.object.node, "Content")?.props[0];
					if (tex && content instanceof Uint8Array && content.length > 0) {
						if (imageTexture === null) {
							imageTexture = tex.child;
							image = { bytes: content, mime: mimeOf(content) };
						}
						textured = imageTexture === tex.child;
					}
				}
				return { color: [rgb[0], rgb[1], rgb[2]], textured };
			});

			const weightsFor = (cp: number) => {
				const list = (influences.get(cp) ?? [])
					.sort((a, b) => b.weight - a.weight)
					.slice(0, 4);
				const sum = list.reduce((s, x) => s + x.weight, 0);
				if (list.length === 0 || sum <= 1e-6) {
					return { j: [rigid, 0, 0, 0], w: [1, 0, 0, 0] };
				}
				const j = [0, 0, 0, 0];
				const w = [0, 0, 0, 0];
				list.forEach((x, k) => {
					j[k] = x.slot;
					w[k] = x.weight / sum;
				});
				return { j, w };
			};

			// Polygons end on a negative index (the real one is -i - 1).
			let face: { cp: number; pv: number }[] = [];
			let faceNumber = 0;
			for (let pv = 0; pv < polygon.length; pv++) {
				const raw = polygon[pv];
				const last = raw < 0;
				face.push({ cp: last ? -raw - 1 : raw, pv });
				if (!last) continue;
				const slotMaterial = allSame
					? materialIndex[0]
					: materialIndex[faceNumber];
				const mat = info[slotMaterial ?? 0];
				const corners = face.map(({ cp, pv: at }) => {
					const uv = uvs?.(cp, at, 2);
					const skin = weightsFor(cp);
					return {
						p: [vertices[cp * 3], vertices[cp * 3 + 1], vertices[cp * 3 + 2]],
						n: normals?.(cp, at, 3) ?? null,
						uv: [uv?.[0] ?? 0, uv?.[1] ?? 0, mat?.textured ? 1 : 0],
						...skin,
					};
				});
				for (let i = 1; i + 1 < corners.length; i++) {
					const c = [corners[0], corners[i], corners[i + 1]];
					const col = mat?.color ?? [0.8, 0.8, 0.8];
					builder.triangle(
						c[0].p,
						c[1].p,
						c[2].p,
						c.every((x) => x.n) ? [c[0].n!, c[1].n!, c[2].n!] : null,
						[col, col, col],
						{
							// FBX puts v = 0 at the bottom; textures here start at the top.
							uvs: c.map((x) => [x.uv[0], 1 - x.uv[1], x.uv[2]]) as [
								number[],
								number[],
								number[],
							],
							joints: [c[0].j, c[1].j, c[2].j],
							weights: [c[0].w, c[1].w, c[2].w],
						},
					);
				}
				face = [];
				faceNumber++;
			}
		}
	}
	if (bones.length === 0) return null;

	const rig: Rig = {
		bones: bones.length,
		duration,
		pose(time, out) {
			const t = duration > 0 ? ((time % duration) + duration) % duration : 0;
			const world = worldAt(t);
			bones.forEach((bone, b) => {
				const m = multiply(
					upFix,
					multiply(world.get(bone.model) ?? identity(), bone.bind),
				);
				for (let i = 0; i < 16; i++) out[b * 16 + i] = m[i];
			});
		},
	};
	const mesh = builder.buildSkinned(rig);
	if (!mesh) return null;
	mesh.image = image;
	if (!image) mesh.uvs = null;
	return mesh;
}

/** A layer element's per-corner reader: `(controlPoint, polygonVertex, size)`. */
function layer(
	geometry: FbxNode,
	element: string,
	dataName: string,
	indexName: string,
): ((cp: number, pv: number, size: number) => number[]) | null {
	const node = child(geometry, element);
	if (!node) return null;
	const data = numbers(node, dataName);
	const index = numbers(node, indexName);
	const byCorner = text(node, "MappingInformationType") === "ByPolygonVertex";
	const indexed = text(node, "ReferenceInformationType") === "IndexToDirect";
	if (data.length === 0) return null;
	return (cp, pv, size) => {
		const slot = byCorner ? pv : cp;
		const i = indexed ? index[slot] : slot;
		if (i === undefined || i < 0) return [];
		return Array.from({ length: size }, (_, k) => data[i * size + k]);
	};
}

/** Every curve, per model, per property ("Lcl Rotation"), per axis. Only the first
 * animation stack plays. */
function collectCurves(
	objects: Map<number, FbxObject>,
	parentsOf: Map<number, { parent: number; prop: string }[]>,
	childrenOf: Map<number, { child: number; prop: string }[]>,
	modelIds: Set<number>,
): Map<number, Map<string, (Curve | null)[]>> {
	const out = new Map<number, Map<string, (Curve | null)[]>>();
	const stack = [...objects.values()].find((o) => o.type === "AnimationStack");
	const layers = new Set(
		(childrenOf.get(stack?.id ?? -1) ?? [])
			.filter((c) => objects.get(c.child)?.type === "AnimationLayer")
			.map((c) => c.child),
	);
	for (const curveNode of objects.values()) {
		if (curveNode.type !== "AnimationCurveNode") continue;
		const inStack = (parentsOf.get(curveNode.id) ?? []).some((p) =>
			layers.has(p.parent),
		);
		if (stack && !inStack) continue;
		const target = (parentsOf.get(curveNode.id) ?? []).find((p) =>
			modelIds.has(p.parent),
		);
		if (!target) continue;
		const axes: (Curve | null)[] = [null, null, null];
		for (const c of childrenOf.get(curveNode.id) ?? []) {
			const curve = objects.get(c.child);
			if (curve?.type !== "AnimationCurve") continue;
			const axis = "XYZ".indexOf(c.prop.slice(-1));
			if (axis < 0) continue;
			const times = numbers(curve.node, "KeyTime");
			axes[axis] = {
				times: Array.from(times, (k) => k / TICKS_PER_SECOND),
				values: numbers(curve.node, "KeyValueFloat"),
			};
		}
		const perModel = out.get(target.parent) ?? new Map();
		perModel.set(target.prop, axes);
		out.set(target.parent, perModel);
	}
	return out;
}

function sampleCurve(curve: Curve, t: number): number {
	const { times, values } = curve;
	const n = times.length;
	if (t <= times[0] || n === 1) return values[0];
	if (t >= times[n - 1]) return values[n - 1];
	let lo = 0;
	let hi = n - 1;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (times[mid] <= t) lo = mid;
		else hi = mid;
	}
	const f = (t - times[lo]) / (times[hi] - times[lo]);
	return values[lo] + (values[hi] - values[lo]) * f;
}

function globalSetting(root: FbxNode, name: string): number | null {
	const settings = child(root, "GlobalSettings");
	return settings ? (property(settings, name)?.[0] ?? null) : null;
}

function mimeOf(bytes: Uint8Array): string {
	return bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : "image/jpeg";
}
