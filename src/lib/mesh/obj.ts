import { MeshBuilder, type Mesh } from "./mesh";

/** Wavefront OBJ: `v` (with optional `r g b` after xyz), `vn` and `f` of any
 * size. Materials and texture coordinates are ignored. */
export function parseObj(text: string): Mesh | null {
	const positions: number[][] = [];
	const colors: number[][] = [];
	const normals: number[][] = [];
	const faces: string[][] = [];
	let hasColor = false;
	let colorScale = 1;

	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line === "" || line[0] === "#") continue;
		const parts = line.split(/\s+/);
		switch (parts[0]) {
			case "v": {
				const n = parts.slice(1).map(Number);
				positions.push([n[0], n[1], n[2]]);
				if (n.length >= 6 && n.slice(3, 6).every(Number.isFinite)) {
					hasColor = true;
					colors.push([n[3], n[4], n[5]]);
					// Some exporters write 0-255.
					if (Math.max(n[3], n[4], n[5]) > 1) colorScale = 1 / 255;
				} else {
					colors.push([1, 1, 1]);
				}
				break;
			}
			case "vn":
				normals.push(parts.slice(1, 4).map(Number));
				break;
			case "f":
				faces.push(parts.slice(1));
				break;
		}
	}

	if (colorScale !== 1) {
		for (const c of colors) for (let k = 0; k < 3; k++) c[k] *= colorScale;
	}

	const builder = new MeshBuilder();
	for (const face of faces) {
		const corners = face.map((ref) => {
			const [v, , vn] = ref.split("/");
			return {
				v: resolveIndex(v, positions.length),
				vn: vn ? resolveIndex(vn, normals.length) : -1,
			};
		});
		if (corners.some((c) => c.v < 0)) continue;
		const smooth = corners.every((c) => c.vn >= 0);
		// A fan: exact for the convex polygons exporters write.
		for (let i = 1; i + 1 < corners.length; i++) {
			const tri = [corners[0], corners[i], corners[i + 1]];
			builder.triangle(
				positions[tri[0].v],
				positions[tri[1].v],
				positions[tri[2].v],
				smooth
					? [normals[tri[0].vn], normals[tri[1].vn], normals[tri[2].vn]]
					: null,
				hasColor
					? [colors[tri[0].v], colors[tri[1].v], colors[tri[2].v]]
					: null,
			);
		}
	}
	return builder.build();
}

/** OBJ indices are 1-based, and negative ones count back from the latest entry.
 * -1 when out of range. */
function resolveIndex(ref: string, count: number): number {
	const n = parseInt(ref, 10);
	if (!Number.isFinite(n) || n === 0) return -1;
	const i = n > 0 ? n - 1 : count + n;
	return i >= 0 && i < count ? i : -1;
}
