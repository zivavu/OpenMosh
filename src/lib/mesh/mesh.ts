/** A triangle soup ready for the GPU: three vertices per triangle, nothing shared. */
export interface Mesh {
	/** xyz per vertex, fitted into a unit sphere at the origin; y up, front facing +z. */
	positions: Float32Array;
	normals: Float32Array;
	/** rgb per vertex, 0-1; null when the file carries no colour. */
	colors: Float32Array | null;
	triangles: number;
}

/** Collects triangles while a parser walks its file. */
export class MeshBuilder {
	#positions: number[] = [];
	#normals: number[] = [];
	#colors: number[] = [];
	#hasColor = false;

	/** `normals` per corner, or null to shade the triangle flat. */
	triangle(
		a: ArrayLike<number>,
		b: ArrayLike<number>,
		c: ArrayLike<number>,
		normals: [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>] | null,
		colors: [ArrayLike<number>, ArrayLike<number>, ArrayLike<number>] | null,
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
	}

	/** Null when nothing drawable was found. */
	build(): Mesh | null {
		const triangles = this.#positions.length / 9;
		if (triangles === 0) return null;
		const positions = new Float32Array(this.#positions);
		if (!fitUnitSphere(positions)) return null;
		return {
			positions,
			normals: new Float32Array(this.#normals),
			colors: this.#hasColor ? new Float32Array(this.#colors) : null,
			triangles,
		};
	}
}

const WHITE = [1, 1, 1];

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
