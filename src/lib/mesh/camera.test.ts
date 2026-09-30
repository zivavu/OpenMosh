import { describe, expect, it } from "bun:test";
import {
	depthRange,
	meshCamera,
	modelFootprint,
	modelToWorld,
	projectToUv,
	type MeshCamera,
	type Transform3dValues,
} from "./camera";

const base: Transform3dValues = {
	rotX: 0,
	rotY: 0,
	rotZ: 0,
	perspective: 0.5,
	zoom: 1,
	spin: 0,
	axis: "y",
};

/** The transform-3d shader's inverse mapping, transcribed: which image uv a
 * screen uv shows. */
function shaderSample(
	cam: MeshCamera,
	aspect: number,
	uv: [number, number],
): [number, number] {
	const r = cam.rotation;
	const dir = [(uv[0] - 0.5) * 2 * aspect, (uv[1] - 0.5) * 2, cam.focal];
	const centre = [0, 0, cam.distance];
	const n = [r[6], r[7], r[8]];
	const dot = (a: number[], b: number[]) =>
		a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const k = dot(n, centre) / dot(n, dir);
	const p = [0, 1, 2].map((i) => k * dir[i] - centre[i]);
	// transpose(R) * p
	const q = [0, 1, 2].map(
		(col) => r[col * 3] * p[0] + r[col * 3 + 1] * p[1] + r[col * 3 + 2] * p[2],
	);
	return [(q[0] / aspect) * 0.5 + 0.5, q[1] * 0.5 + 0.5];
}

/** A point on the flat layer, carried through the mesh camera. */
function planeToUv(
	cam: MeshCamera,
	aspect: number,
	img: [number, number],
): [number, number] {
	const r = cam.rotation;
	const q = [(img[0] - 0.5) * 2 * aspect, (img[1] - 0.5) * 2, 0];
	const w: [number, number, number] = [
		r[0] * q[0] + r[3] * q[1] + r[6] * q[2],
		r[1] * q[0] + r[4] * q[1] + r[7] * q[2],
		r[2] * q[0] + r[5] * q[1] + r[8] * q[2] + cam.distance,
	];
	return projectToUv(cam, aspect, w);
}

describe("meshCamera", () => {
	it("turns the frame exactly as the 3D Transform shader does", () => {
		const aspect = 16 / 9;
		for (const v of [
			{ rotY: 25 },
			{ rotX: -40, rotZ: 15, perspective: 0.9 },
			{ rotX: 30, rotY: -50, zoom: 1.6, perspective: 0.2 },
			{ spin: 45, axis: "tumble" },
		]) {
			const cam = meshCamera([{ values: { ...base, ...v }, time: 1.3 }]);
			for (const img of [
				[0.5, 0.5],
				[0.2, 0.3],
				[0.8, 0.7],
			] as [number, number][]) {
				const back = shaderSample(cam, aspect, planeToUv(cam, aspect, img));
				expect(back[0]).toBeCloseTo(img[0], 5);
				expect(back[1]).toBeCloseTo(img[1], 5);
			}
		}
	});

	it("shows a model's front, upright, with no transform", () => {
		const cam = meshCamera([]);
		const top = projectToUv(cam, 1, modelToWorld(cam, [0, 1, 0]));
		const right = projectToUv(cam, 1, modelToWorld(cam, [1, 0, 0]));
		// uv runs down the frame, so up is a smaller v.
		expect(top[1]).toBeLessThan(0.5);
		expect(right[0]).toBeGreaterThan(0.5);
		const front = modelToWorld(cam, [0, 0, 1]);
		expect(front[2]).toBeLessThan(cam.distance);
	});

	it("stacks rotations and multiplies zoom", () => {
		const one = meshCamera([
			{ values: { ...base, rotY: 40, zoom: 2 }, time: 0 },
		]);
		const two = meshCamera([
			{ values: { ...base, rotY: 20, zoom: 2 }, time: 0 },
			{ values: { ...base, rotY: 20 }, time: 0 },
		]);
		for (let i = 0; i < 9; i++) {
			expect(two.rotation[i]).toBeCloseTo(one.rotation[i], 5);
		}
		expect(two.distance).toBeCloseTo(one.distance, 5);
	});

	it("keeps the whole model between the depth planes at any lens", () => {
		for (const perspective of [0, 0.5, 1]) {
			const cam = meshCamera([{ values: { ...base, perspective }, time: 0 }]);
			const { near, far } = depthRange(cam);
			expect(cam.distance - cam.radius).toBeGreaterThan(near);
			expect(cam.distance + cam.radius).toBeLessThan(far);
		}
	});

	it("keeps a valid near plane when zoomed into the model", () => {
		const cam = meshCamera([
			{ values: { ...base, perspective: 1, zoom: 3 }, time: 0 },
		]);
		const { near, far } = depthRange(cam);
		expect(near).toBeGreaterThan(0);
		expect(far).toBeGreaterThan(cam.distance + cam.radius);
	});
});

describe("modelFootprint", () => {
	const extent = [0.3, 0.9, 0.2];

	it("is tall for a tall model seen from the front", () => {
		const f = modelFootprint(meshCamera([]), extent);
		expect(f.y / f.x).toBeCloseTo(3, 0);
	});

	it("holds every point of the box, however the model turns", () => {
		for (const rotY of [0, 30, 75, 140]) {
			for (const rotX of [0, 40]) {
				const cam = meshCamera([
					{ values: { ...base, rotX, rotY, zoom: 1.4 }, time: 0 },
				]);
				const f = modelFootprint(cam, extent);
				for (let i = 0; i < 200; i++) {
					const p = extent.map((e) => (Math.random() * 2 - 1) * e);
					const w = modelToWorld(cam, p);
					expect(Math.abs((cam.focal * w[0]) / w[2])).toBeLessThanOrEqual(
						f.x + 1e-9,
					);
					expect(Math.abs((cam.focal * w[1]) / w[2])).toBeLessThanOrEqual(
						f.y + 1e-9,
					);
				}
			}
		}
	});
});
