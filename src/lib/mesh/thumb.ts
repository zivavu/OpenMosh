import { meshCamera, modelToWorld, projectToUv } from "./camera";
import type { Mesh } from "./mesh";

/** A three-quarter view, so a cube reads as a cube. */
const THUMB_VIEW = {
	rotX: -20,
	rotY: 35,
	rotZ: 0,
	perspective: 0.5,
	zoom: 1,
	spin: 0,
	axis: "y",
};

/** Lit like the renderer's mesh pass: up, left, in front. */
const LIGHT = normalize([-0.45, -0.65, -0.6]);
const DEFAULT_COLOR = 0.82;

function normalize(v: number[]): number[] {
	const len = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / len, v[1] / len, v[2] / len];
}

/** A flat-shaded, back-to-front 2D drawing of the mesh; no GL context needed. */
export async function renderMeshThumb(
	mesh: Mesh,
	size: number,
): Promise<Blob | null> {
	const canvas = new OffscreenCanvas(size, size);
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	const cam = meshCamera([{ values: THUMB_VIEW, time: 0 }]);
	const p = mesh.positions;
	const tris: { depth: number; pts: number[]; fill: string }[] = [];
	for (let t = 0; t < mesh.triangles; t++) {
		const w = [0, 1, 2].map((k) =>
			modelToWorld(cam, p.subarray((t * 3 + k) * 3, (t * 3 + k) * 3 + 3)),
		);
		const e1 = [0, 1, 2].map((i) => w[1][i] - w[0][i]);
		const e2 = [0, 1, 2].map((i) => w[2][i] - w[0][i]);
		let n = normalize([
			e1[1] * e2[2] - e1[2] * e2[1],
			e1[2] * e2[0] - e1[0] * e2[2],
			e1[0] * e2[1] - e1[1] * e2[0],
		]);
		const centre = [0, 1, 2].map((i) => (w[0][i] + w[1][i] + w[2][i]) / 3);
		// Two-sided, as in the renderer.
		if (n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2] > 0) {
			n = n.map((c) => -c);
		}
		const diffuse = Math.max(
			0,
			n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2],
		);
		const shade = 0.28 + 0.8 * diffuse;
		const base = mesh.colors
			? [0, 1, 2].map(
					(i) =>
						(mesh.colors![t * 9 + i] +
							mesh.colors![t * 9 + 3 + i] +
							mesh.colors![t * 9 + 6 + i]) /
						3,
				)
			: [DEFAULT_COLOR, DEFAULT_COLOR, DEFAULT_COLOR];
		const [r, g, b] = base.map((c) => Math.round(Math.min(1, c * shade) * 255));
		const pts = w.flatMap((v) => projectToUv(cam, 1, v).map((c) => c * size));
		tris.push({ depth: centre[2], pts, fill: `rgb(${r},${g},${b})` });
	}
	tris.sort((a, b) => b.depth - a.depth);
	ctx.lineJoin = "round";
	ctx.lineWidth = 0.5;
	for (const { pts, fill } of tris) {
		ctx.beginPath();
		ctx.moveTo(pts[0], pts[1]);
		ctx.lineTo(pts[2], pts[3]);
		ctx.lineTo(pts[4], pts[5]);
		ctx.closePath();
		ctx.fillStyle = fill;
		// A hairline in the same colour closes the seams between triangles.
		ctx.strokeStyle = fill;
		ctx.fill();
		ctx.stroke();
	}
	return canvas.convertToBlob({ type: "image/png" });
}
