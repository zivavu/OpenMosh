import { describe, expect, it } from "bun:test";
import { asMeshFile, isMeshFile, MESH_TYPE } from ".";
import { parseObj } from "./obj";
import { parseStl } from "./stl";

const QUAD = `
# a unit quad, as one polygon
v 0 0 0
v 2 0 0
v 2 2 0
v 0 2 0
f 1 2 3 4
`;

function maxRadius(positions: Float32Array): number {
	let r = 0;
	for (let i = 0; i < positions.length; i += 3) {
		r = Math.max(
			r,
			Math.hypot(positions[i], positions[i + 1], positions[i + 2]),
		);
	}
	return r;
}

describe("parseObj", () => {
	it("fans a polygon into triangles", () => {
		const mesh = parseObj(QUAD)!;
		expect(mesh.triangles).toBe(2);
		expect(mesh.positions.length).toBe(18);
		expect(mesh.colors).toBeNull();
	});

	it("centres the mesh and fits it into a unit sphere", () => {
		const mesh = parseObj(QUAD)!;
		expect(maxRadius(mesh.positions)).toBeCloseTo(1, 5);
		let sx = 0;
		let sy = 0;
		for (let i = 0; i < mesh.positions.length; i += 3) {
			sx += mesh.positions[i];
			sy += mesh.positions[i + 1];
		}
		// Both triangles share the diagonal, so the mean sits on the centre.
		expect(sx / 6).toBeCloseTo(0, 5);
		expect(sy / 6).toBeCloseTo(0, 5);
	});

	it("shades flat, facing +z for a counter-clockwise quad", () => {
		const mesh = parseObj(QUAD)!;
		for (let i = 0; i < mesh.normals.length; i += 3) {
			expect([...mesh.normals.slice(i, i + 3)]).toEqual([0, 0, 1]);
		}
	});

	it("reads vertex colours, scaling 0-255 down", () => {
		const mesh = parseObj(`
v 0 0 0 255 0 0
v 1 0 0 0 255 0
v 0 1 0 0 0 255
f 1 2 3`)!;
		expect([...mesh.colors!]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
	});

	it("uses the file's normals, and negative indices", () => {
		const mesh = parseObj(`
v 0 0 0
v 1 0 0
v 0 1 0
vn 0 0 -2
f -3//1 -2//1 -1//1`)!;
		expect([...mesh.normals.slice(0, 3)]).toEqual([0, 0, -1]);
	});

	it("skips faces pointing at missing vertices", () => {
		expect(parseObj("v 0 0 0\nv 1 0 0\nf 1 2 9")).toBeNull();
	});

	it("rejects a file with nothing to draw", () => {
		expect(parseObj("# empty")).toBeNull();
		expect(parseObj("v 1 1 1\nv 1 1 1\nv 1 1 1\nf 1 2 3")).toBeNull();
	});
});

describe("parseStl", () => {
	it("reads ASCII", () => {
		const text = `solid t
facet normal 0 0 0
outer loop
vertex 0 0 0
vertex 1 0 0
vertex 0 1 0
endloop
endfacet
endsolid t`;
		const mesh = parseStl(new TextEncoder().encode(text))!;
		expect(mesh.triangles).toBe(1);
		expect([...mesh.normals.slice(0, 3)]).toEqual([0, 0, 1]);
	});

	it("reads binary, even when the header says solid", () => {
		const bytes = new Uint8Array(80 + 4 + 50);
		bytes.set(new TextEncoder().encode("solid binary"));
		const view = new DataView(bytes.buffer);
		view.setUint32(80, 1, true);
		const verts = [0, 0, 0, 1, 0, 0, 0, 1, 0];
		verts.forEach((v, i) => view.setFloat32(84 + 12 + i * 4, v, true));
		const mesh = parseStl(bytes)!;
		expect(mesh.triangles).toBe(1);
		expect(maxRadius(mesh.positions)).toBeCloseTo(1, 5);
	});
});

describe("mesh files", () => {
	it("are recognised by extension, whatever the browser typed them", () => {
		expect(isMeshFile(new File([""], "cube.OBJ"))).toBe(true);
		expect(isMeshFile(new File([""], "part.stl", { type: "model/stl" }))).toBe(
			true,
		);
		expect(isMeshFile(new File([""], "photo.png"))).toBe(false);
	});

	it("keep their name and timestamp when retyped", () => {
		const file = new File(["v"], "cube.obj", { lastModified: 42 });
		const typed = asMeshFile(file);
		expect(typed.type).toBe(MESH_TYPE);
		expect(typed.name).toBe("cube.obj");
		expect(typed.lastModified).toBe(42);
	});
});
