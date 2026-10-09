import { multiply, scaling, translation, type Mat4 } from "./mat4";

/** A triangle soup ready for the GPU: three vertices per triangle, nothing shared.
 * A point cloud has one vertex per point instead. */
export interface Mesh {
	/** xyz per vertex, fitted into a unit sphere at the origin; y up, front facing +z. */
	positions: Float32Array;
	normals: Float32Array;
	/** rgb per vertex, 0-1; null when the file carries no colour. */
	colors: Float32Array | null;
	/** u, v and which texture per vertex: 0 for none, else its index in
	 * `textures` plus one. Null without coordinates. */
	uvs: Float32Array | null;
	/** Encoded pictures, as the file carries them; `parseMesh` decodes them into `textures`. */
	images: { bytes: Uint8Array; mime: string }[];
	/** All one size, so they stack into one texture array. */
	textures: ImageBitmap[];
	/** Bones and animation. When set, `positions` is the pose at time 0 (for
	 * thumbnails) and the GPU draws `skin.bindPositions` instead. */
	skin: Skin | null;
	/** Half-size of the box the model fills along x, y and z, in the unit sphere's
	 * units, over its whole animation. Centred on the origin. */
	extent: [number, number, number];
	triangles: number;
	/** Drawn as unlit dots, one per vertex; scanned models come like this. */
	points: boolean;
}

/** Skinned-mesh data: four bone influences per vertex, and the bones' motion. */
export interface Skin {
	/** Positions as the file has them, before any bone moves them. */
	bindPositions: Float32Array;
	/** Four indices into the bones, per vertex. */
	joints: Uint16Array;
	weights: Float32Array;
	bones: number;
	/** The file's animations; empty for a rig with nothing to play. */
	animations: MeshAnimation[];
	/** Writes every bone's column-major 4x4 at `time` (looped) into `out`, with the
	 * unit-sphere fit folded in. An `animation` the rig lacks poses the first. */
	pose(time: number, out: Float32Array, animation?: number): void;
}

export interface MeshAnimation {
	name: string;
	/** Seconds it runs before looping. */
	duration: number;
}

/** A rig before its mesh has been fitted to the unit sphere. */
export interface Rig {
	bones: number;
	animations: MeshAnimation[];
	pose(time: number, out: Float32Array, animation?: number): void;
}

type Corners = [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>];

/** Extra per-vertex data for one triangle; the builder must have been made for it. */
export interface TriangleExtra {
	/** [u, v, textured] per corner. */
	uvs?: Corners;
	/** Four bone indices and four weights per corner. */
	joints?: Corners;
	weights?: Corners;
}

/** `TriangleExtra` for a single vertex. */
export interface VertexExtra {
	uv?: ArrayLike<number>;
	joints?: ArrayLike<number>;
	weights?: ArrayLike<number>;
}

/** One kind of primitive's vertex attributes, as a parser adds them. */
class Vertices {
	positions: number[] = [];
	normals: number[] = [];
	colors: number[] = [];
	hasColor = false;
	uvs: number[] = [];
	joints: number[] = [];
	weights: number[] = [];
}

/** Collects triangles, or points, while a parser walks its file. A file with any
 * triangles is drawn as those; its points only count when it has nothing else. */
export class MeshBuilder {
	#tris = new Vertices();
	#dots = new Vertices();
	#withUv: boolean;
	#withSkin: boolean;

	constructor(options: { uv?: boolean; skin?: boolean } = {}) {
		this.#withUv = options.uv ?? false;
		this.#withSkin = options.skin ?? false;
	}

	/** `normals` per corner, or null to shade the triangle flat. */
	triangle(
		a: ArrayLike<number>,
		b: ArrayLike<number>,
		c: ArrayLike<number>,
		normals: Corners | null,
		colors: Corners | null,
		extra?: TriangleExtra,
	) {
		const flat = faceNormal(a, b, c);
		const corners = [a, b, c];
		for (let k = 0; k < 3; k++) {
			const n = normals?.[k] ?? flat;
			const len = Math.hypot(n[0], n[1], n[2]);
			// A zeroed normal in the file shades as flat rather than black.
			this.#vertex(
				this.#tris,
				corners[k],
				len > 1e-9 ? [n[0] / len, n[1] / len, n[2] / len] : flat,
				colors?.[k] ?? null,
				{
					uv: extra?.uvs?.[k],
					joints: extra?.joints?.[k],
					weights: extra?.weights?.[k],
				},
			);
		}
	}

	point(
		p: ArrayLike<number>,
		color: ArrayLike<number> | null,
		extra: VertexExtra = {},
	) {
		this.#vertex(this.#dots, p, NO_NORMAL, color, extra);
	}

	#vertex(
		to: Vertices,
		p: ArrayLike<number>,
		n: ArrayLike<number>,
		color: ArrayLike<number> | null,
		extra: VertexExtra,
	) {
		to.positions.push(p[0], p[1], p[2]);
		to.normals.push(n[0], n[1], n[2]);
		if (color) to.hasColor = true;
		const col = color ?? WHITE;
		to.colors.push(col[0], col[1], col[2]);
		if (this.#withUv) {
			const uv = extra.uv ?? NO_UV;
			to.uvs.push(uv[0], uv[1], uv[2]);
		}
		if (this.#withSkin) {
			const j = extra.joints ?? NO_JOINTS;
			const w = extra.weights ?? NO_WEIGHTS;
			to.joints.push(j[0], j[1], j[2], j[3]);
			to.weights.push(w[0], w[1], w[2], w[3]);
		}
	}

	get #drawn(): Vertices {
		return this.#tris.positions.length > 0 ? this.#tris : this.#dots;
	}

	/** Null when nothing drawable was found. */
	build(): Mesh | null {
		if (this.#drawn.positions.length === 0) return null;
		const positions = new Float32Array(this.#drawn.positions);
		if (!fitUnitSphere(positions)) return null;
		return this.#finish(positions, null, halfExtent(positions));
	}

	/** Like `build`, but the rig's whole motion decides the fit, so a dancer
	 * straying from the bind pose stays inside the sphere. */
	buildSkinned(rig: Rig): Mesh | null {
		const v = this.#drawn;
		if (v.positions.length === 0 || !this.#withSkin) return null;
		const bind = new Float32Array(v.positions);
		const joints = new Uint16Array(v.joints);
		const weights = new Float32Array(v.weights);
		const fitted = fitRig(bind, joints, weights, rig);
		if (!fitted) return null;
		const { fit, extent } = fitted;
		const skin: Skin = {
			bindPositions: bind,
			joints,
			weights,
			bones: rig.bones,
			animations: rig.animations,
			pose(time, out, animation) {
				rig.pose(time, out, animation);
				for (let b = 0; b < rig.bones; b++) {
					const m = multiply(fit, out.subarray(b * 16, b * 16 + 16));
					for (let i = 0; i < 16; i++) out[b * 16 + i] = m[i];
				}
			},
		};
		const mats = new Float32Array(rig.bones * 16);
		skin.pose(0, mats);
		const posed = new Float32Array(bind.length);
		skinPositions(bind, joints, weights, mats, posed);
		return this.#finish(posed, skin, extent);
	}

	#finish(
		positions: Float32Array,
		skin: Skin | null,
		extent: [number, number, number],
	): Mesh {
		const v = this.#drawn;
		const points = v === this.#dots;
		return {
			positions,
			normals: new Float32Array(v.normals),
			colors: v.hasColor ? new Float32Array(v.colors) : null,
			uvs: this.#withUv ? new Float32Array(v.uvs) : null,
			images: [],
			textures: [],
			skin,
			extent,
			triangles: points ? 0 : v.positions.length / 9,
			points,
		};
	}
}

const WHITE = [1, 1, 1];
const NO_NORMAL = [0, 0, 0];
const NO_UV = [0, 0, 0];
const NO_JOINTS = [0, 0, 0, 0];
const NO_WEIGHTS = [1, 0, 0, 0];

/** How many poses along the animations decide the fit, shared between them. */
const FIT_SAMPLES = 192;
/** The fewest poses one animation gets, however many the file has. */
const FIT_SAMPLES_MIN = 8;

function faceNormal(
	a: ArrayLike<number>,
	b: ArrayLike<number>,
	c: ArrayLike<number>,
): number[] {
	const ux = b[0] - a[0];
	const uy = b[1] - a[1];
	const uz = b[2] - a[2];
	const vx = c[0] - a[0];
	const vy = c[1] - a[1];
	const vz = c[2] - a[2];
	const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
	const len = Math.hypot(n[0], n[1], n[2]);
	return len > 1e-12 ? [n[0] / len, n[1] / len, n[2] / len] : [0, 0, 1];
}

/** Writes each vertex moved by its bones (`mats`: one column-major 4x4 per bone). */
function skinPositions(
	bind: Float32Array,
	joints: Uint16Array,
	weights: Float32Array,
	mats: Float32Array,
	out: Float32Array,
) {
	for (let v = 0; v < bind.length / 3; v++) {
		const x = bind[v * 3];
		const y = bind[v * 3 + 1];
		const z = bind[v * 3 + 2];
		let ox = 0;
		let oy = 0;
		let oz = 0;
		for (let k = 0; k < 4; k++) {
			const w = weights[v * 4 + k];
			if (w === 0) continue;
			const m = joints[v * 4 + k] * 16;
			ox +=
				w * (mats[m] * x + mats[m + 4] * y + mats[m + 8] * z + mats[m + 12]);
			oy +=
				w *
				(mats[m + 1] * x + mats[m + 5] * y + mats[m + 9] * z + mats[m + 13]);
			oz +=
				w *
				(mats[m + 2] * x + mats[m + 6] * y + mats[m + 10] * z + mats[m + 14]);
		}
		out[v * 3] = ox;
		out[v * 3 + 1] = oy;
		out[v * 3 + 2] = oz;
	}
}

/** Largest |x|, |y| and |z| over the positions. */
function halfExtent(positions: Float32Array): [number, number, number] {
	const e: [number, number, number] = [0, 0, 0];
	for (let i = 0; i < positions.length; i += 3) {
		for (let k = 0; k < 3; k++)
			e[k] = Math.max(e[k], Math.abs(positions[i + k]));
	}
	return e;
}

/** The matrix that centres the rig's poses on the origin and scales the furthest
 * vertex to 1, and the box those poses fill; null for a rig with no extent or a
 * non-finite pose. Every animation counts, so switching one keeps the scale. */
function fitRig(
	bind: Float32Array,
	joints: Uint16Array,
	weights: Float32Array,
	rig: Rig,
): { fit: Mat4; extent: [number, number, number] } | null {
	const per = Math.max(
		FIT_SAMPLES_MIN,
		Math.floor(FIT_SAMPLES / Math.max(1, rig.animations.length)),
	);
	const samples = rig.animations.length
		? rig.animations.flatMap((a, animation) =>
				Array.from({ length: a.duration > 0 ? per : 1 }, (_, i) => ({
					time: (i / per) * a.duration,
					animation,
				})),
			)
		: [{ time: 0, animation: 0 }];
	const mats = new Float32Array(rig.bones * 16);
	const posed = new Float32Array(bind.length);
	const poses = samples.map(({ time, animation }) => {
		rig.pose(time, mats, animation);
		skinPositions(bind, joints, weights, mats, posed);
		return posed.slice();
	});
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const p of poses) {
		for (let i = 0; i < p.length; i += 3) {
			for (let k = 0; k < 3; k++) {
				const v = p[i + k];
				if (!Number.isFinite(v)) return null;
				if (v < min[k]) min[k] = v;
				if (v > max[k]) max[k] = v;
			}
		}
	}
	const centre = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
	let radius = 0;
	for (const p of poses) {
		for (let i = 0; i < p.length; i += 3) {
			radius = Math.max(
				radius,
				Math.hypot(
					p[i] - centre[0],
					p[i + 1] - centre[1],
					p[i + 2] - centre[2],
				),
			);
		}
	}
	if (radius <= 0) return null;
	return {
		fit: multiply(
			scaling(1 / radius, 1 / radius, 1 / radius),
			translation(-centre[0], -centre[1], -centre[2]),
		),
		extent: [0, 1, 2].map((k) => (max[k] - min[k]) / 2 / radius) as [
			number,
			number,
			number,
		],
	};
}

/** Centres the bounding box on the origin and scales its furthest vertex to 1.
 * False for a mesh with no extent or a non-finite coordinate. */
export function fitUnitSphere(positions: Float32Array): boolean {
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (let i = 0; i < positions.length; i += 3) {
		for (let k = 0; k < 3; k++) {
			const v = positions[i + k];
			if (!Number.isFinite(v)) return false;
			if (v < min[k]) min[k] = v;
			if (v > max[k]) max[k] = v;
		}
	}
	const centre = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
	let radius = 0;
	for (let i = 0; i < positions.length; i += 3) {
		radius = Math.max(
			radius,
			Math.hypot(
				positions[i] - centre[0],
				positions[i + 1] - centre[1],
				positions[i + 2] - centre[2],
			),
		);
	}
	if (radius <= 0) return false;
	for (let i = 0; i < positions.length; i += 3) {
		for (let k = 0; k < 3; k++) {
			positions[i + k] = (positions[i + k] - centre[k]) / radius;
		}
	}
	return true;
}
