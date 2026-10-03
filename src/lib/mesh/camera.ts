/** The 3D Transform effect's camera, for meshes. Mirrors the `transform-3d`
 * shader: its world is the frame's own axes (x right, y down, z away from the
 * camera at the origin), and a flat layer is a plane at z = focal / zoom. */

const DEG = Math.PI / 180;

export const TRANSFORM_3D_ID = "transform-3d";

export interface Transform3dValues {
	rotX: number;
	rotY: number;
	rotZ: number;
	perspective: number;
	zoom: number;
	spin: number;
	axis: string;
}

export interface MeshCamera {
	/** Column-major 3x3, as GLSL's mat3 takes it. */
	rotation: Float32Array;
	focal: number;
	/** Camera to model centre. */
	distance: number;
	/** The model's bounding sphere, in the frame's half-height units. */
	radius: number;
}

type Mat3 = number[];

function rotateX(a: number): Mat3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [1, 0, 0, 0, c, s, 0, -s, c];
}

function rotateY(a: number): Mat3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [c, 0, -s, 0, 1, 0, s, 0, c];
}

function rotateZ(a: number): Mat3 {
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [c, s, 0, -s, c, 0, 0, 0, 1];
}

/** a * b, both column-major. */
function mul(a: Mat3, b: Mat3): Mat3 {
	const out = new Array<number>(9);
	for (let col = 0; col < 3; col++) {
		for (let row = 0; row < 3; row++) {
			out[col * 3 + row] =
				a[row] * b[col * 3] +
				a[3 + row] * b[col * 3 + 1] +
				a[6 + row] * b[col * 3 + 2];
		}
	}
	return out;
}

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** The shader's R, `turned` being the spin's accumulated degrees (its u_time). */
export function transform3dRotation(
	v: Transform3dValues,
	turned: number,
): Mat3 {
	const t = turned * DEG;
	const sx = v.axis === "x" ? t : v.axis === "tumble" ? t * 0.43 : 0;
	const sy = v.axis === "y" || v.axis === "tumble" ? t : 0;
	const sz = v.axis === "z" ? t : v.axis === "tumble" ? t * 0.17 : 0;
	return mul(
		mul(rotateZ(v.rotZ * DEG + sz), rotateY(v.rotY * DEG + sy)),
		rotateX(v.rotX * DEG + sx),
	);
}

/** The low end is nearly orthographic, the high end a wide lens. */
export function focalLength(perspective: number): number {
	return 8 + (0.9 - 8) * perspective;
}

/** Big enough to read, small enough that a wide lens doesn't reach inside it. */
export function modelRadius(focal: number): number {
	return Math.min(0.8, 0.6 * focal);
}

/** Every 3D Transform in a chain, applied in order: rotations stack, zooms
 * multiply, and the last one's lens wins. None gives the front view. */
export function meshCamera(
	transforms: { values: Transform3dValues; time: number }[],
): MeshCamera {
	let rotation = IDENTITY;
	let zoom = 1;
	let perspective = 0.5;
	for (const { values, time } of transforms) {
		rotation = mul(transform3dRotation(values, time), rotation);
		zoom *= Math.max(values.zoom, 0.001);
		perspective = values.perspective;
	}
	const focal = focalLength(perspective);
	return {
		rotation: new Float32Array(rotation),
		focal,
		distance: focal / zoom,
		radius: modelRadius(focal),
	};
}

/** A model point (y up, front facing +z) in the camera's world. */
export function modelToWorld(
	camera: MeshCamera,
	p: ArrayLike<number>,
): [number, number, number] {
	const r = camera.rotation;
	const x = p[0] * camera.radius;
	const y = -p[1] * camera.radius;
	const z = -p[2] * camera.radius;
	return [
		r[0] * x + r[3] * y + r[6] * z,
		r[1] * x + r[4] * y + r[7] * z,
		r[2] * x + r[5] * y + r[8] * z + camera.distance,
	];
}

/** Where a world point lands, as the shader's uv (0-1, y down). */
export function projectToUv(
	camera: MeshCamera,
	aspect: number,
	w: [number, number, number],
): [number, number] {
	return [
		(camera.focal * w[0]) / (w[2] * aspect) / 2 + 0.5,
		(camera.focal * w[1]) / w[2] / 2 + 0.5,
	];
}

/** Half-width and half-height, in the frame's half-height units, of the screen box
 * the model's `extent` box covers from this camera, so nothing the model draws
 * falls outside. `sphere` tightens it by the model's bounding sphere too; the
 * front-view fit leaves it off, so a model keeps the scale it was saved at. */
export function modelFootprint(
	camera: MeshCamera,
	extent: ArrayLike<number>,
	sphere = true,
): { x: number; y: number } {
	const corners = Array.from({ length: 8 }, (_, i) =>
		modelToWorld(camera, [
			i & 1 ? extent[0] : -extent[0],
			i & 2 ? extent[1] : -extent[1],
			i & 4 ? extent[2] : -extent[2],
		]),
	);
	// The model fits the unit sphere, so no vertex is nearer than its front. A box
	// corner can be, and on a wide lens would blow the box up far past the model.
	const near = Math.max(
		camera.distance - camera.radius,
		camera.distance * 0.05,
	);
	const points = corners.filter((c) => c[2] >= near);
	// The box cut off at that depth: its edges crossing it close the cut face.
	for (let a = 0; a < 8; a++) {
		for (const bit of [1, 2, 4]) {
			if (a & bit) continue;
			const p = corners[a];
			const q = corners[a | bit];
			if (p[2] < near === q[2] < near) continue;
			const t = (near - p[2]) / (q[2] - p[2]);
			points.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), near]);
		}
	}
	let x = 0;
	let y = 0;
	for (const w of points) {
		x = Math.max(x, Math.abs((camera.focal * w[0]) / w[2]));
		y = Math.max(y, Math.abs((camera.focal * w[1]) / w[2]));
	}
	// The sphere, centred on the lens axis, projects to a circle; up close that's the
	// tighter bound of the two.
	const { distance: d, radius: r } = camera;
	if (sphere && d > r) {
		const circle = (camera.focal * r) / Math.sqrt(d * d - r * r);
		x = Math.min(x, circle);
		y = Math.min(y, circle);
	}
	return { x: Math.max(x, 1e-3), y: Math.max(y, 1e-3) };
}

/** Tight near and far planes around the model, for depth precision. */
export function depthRange(camera: MeshCamera): { near: number; far: number } {
	return {
		near: Math.max(0.01, (camera.distance - camera.radius) * 0.9),
		far: camera.distance + camera.radius * 1.1,
	};
}
