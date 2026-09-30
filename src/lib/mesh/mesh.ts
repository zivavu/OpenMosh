import { multiply, scaling, translation, type Mat4 } from "./mat4";

/** A triangle soup ready for the GPU: three vertices per triangle, nothing shared. */
export interface Mesh {
	/** xyz per vertex, fitted into a unit sphere at the origin; y up, front facing +z. */
	positions: Float32Array;
	normals: Float32Array;
	/** rgb per vertex, 0-1; null when the file carries no colour. */
	colors: Float32Array | null;
	/** u, v and a 0/1 "take the texture" flag per vertex; null without coordinates. */
	uvs: Float32Array | null;
	/** Encoded picture bytes, as the file carries them; `parseMesh` decodes them into `texture`. */
	image: { bytes: Uint8Array; mime: string } | null;
	texture: ImageBitmap | null;
	/** Bones and animation. When set, `positions` is the pose at time 0 (for
	 * thumbnails) and the GPU draws `skin.bindPositions` instead. */
	skin: Skin | null;
	/** Half-size of the box the model fills along x, y and z, in the unit sphere's
	 * units, over its whole animation. Centred on the origin. */
	extent: [number, number, number];
	triangles: number;
}

/** Skinned-mesh data: four bone influences per vertex, and the bones' motion. */
export interface Skin {
	/** Positions as the file has them, before any bone moves them. */
	bindPositions: Float32Array;
	/** Four indices into the bones, per vertex. */
	joints: Uint16Array;
	weights: Float32Array;
	bones: number;
	/** Seconds the animation runs; 0 for a rig with nothing to play. */
	duration: number;
	/** Writes every bone's column-major 4x4 at `time` (looped) into `out`, with the
	 * unit-sphere fit folded in. */
	pose(time: number, out: Float32Array): void;
}

/** A rig before its mesh has been fitted to the unit sphere. */
export interface Rig {
	bones: number;
	duration: number;
	pose(time: number, out: Float32Array): void;
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

/** Collects triangles while a parser walks its file. */
export class MeshBuilder {
	#positions: number[] = [];
	#normals: number[] = [];
	#colors: number[] = [];
	#hasColor = false;
	#uvs: number[] = [];
	#joints: number[] = [];
	#weights: number[] = [];
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
		this.#positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
		const flat = faceNormal(a, b, c);
		for (const n of normals ?? [flat, flat, flat]) {
			const len = Math.hypot(n[0], n[1], n[2]);
			// A zeroed normal in the file shades as flat rather than black.
			if (len > 1e-9) this.#normals.push(n[0] / len, n[1] / len, n[2] / len);
			else this.#normals.push(flat[0], flat[1], flat[2]);
		}
		if (colors) this.#hasColor = true;
		for (const col of colors ?? [WHITE, WHITE, WHITE]) {
			this.#colors.push(col[0], col[1], col[2]);
		}
		for (let k = 0; k < 3; k++) {
			if (this.#withUv) {
				const uv = extra?.uvs?.[k] ?? NO_UV;
				this.#uvs.push(uv[0], uv[1], uv[2]);
			}
			if (this.#withSkin) {
				const j = extra?.joints?.[k] ?? NO_JOINTS;
				const w = extra?.weights?.[k] ?? NO_WEIGHTS;
				this.#joints.push(j[0], j[1], j[2], j[3]);
				this.#weights.push(w[0], w[1], w[2], w[3]);
			}
		}
	}

	/** Null when nothing drawable was found. */
	build(): Mesh | null {
		if (this.#positions.length === 0) return null;
		const positions = new Float32Array(this.#positions);
		if (!fitUnitSphere(positions)) return null;
		return this.#finish(positions, null, halfExtent(positions));
	}

	/** Like `build`, but the rig's whole motion decides the fit, so a dancer
	 * straying from the bind pose stays inside the sphere. */
	buildSkinned(rig: Rig): Mesh | null {
		if (this.#positions.length === 0 || !this.#withSkin) return null;
		const bind = new Float32Array(this.#positions);
		const joints = new Uint16Array(this.#joints);
		const weights = new Float32Array(this.#weights);
		const fitted = fitRig(bind, joints, weights, rig);
		if (!fitted) return null;
		const { fit, extent } = fitted;
		const skin: Skin = {
			bindPositions: bind,
			joints,
			weights,
			bones: rig.bones,
			duration: rig.duration,
			pose(time, out) {
				rig.pose(time, out);
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
		return {
			positions,
			normals: new Float32Array(this.#normals),
			colors: this.#hasColor ? new Float32Array(this.#colors) : null,
			uvs: this.#withUv ? new Float32Array(this.#uvs) : null,
			image: null,
			texture: null,
			skin,
			extent,
			triangles: this.#positions.length / 9,
		};
	}
}

const WHITE = [1, 1, 1];
const NO_UV = [0, 0, 0];
const NO_JOINTS = [0, 0, 0, 0];
const NO_WEIGHTS = [1, 0, 0, 0];

/** How many poses along the animation decide the fit. */
const FIT_SAMPLES = 48;

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
 * non-finite pose. */
function fitRig(
	bind: Float32Array,
	joints: Uint16Array,
	weights: Float32Array,
	rig: Rig,
): { fit: Mat4; extent: [number, number, number] } | null {
	const times =
		rig.duration > 0
			? Array.from(
					{ length: FIT_SAMPLES },
					(_, i) => (i / FIT_SAMPLES) * rig.duration,
				)
			: [0];
	const mats = new Float32Array(rig.bones * 16);
	const posed = new Float32Array(bind.length);
	const poses = times.map((t) => {
		rig.pose(t, mats);
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
