import { describe, expect, it } from "bun:test";
import { parsePly } from "./ply";

const encode = (s: string) => new TextEncoder().encode(s);

const ASCII_QUAD = `ply
format ascii 1.0
comment a coloured quad
element vertex 4
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
element face 1
property list uchar int vertex_indices
end_header
0 0 0 255 0 0
1 0 0 0 255 0
1 1 0 0 0 255
0 1 0 255 255 255
4 0 1 2 3
`;

/** Points in binary, with a header line per property, as `props` floats each. */
function binaryCloud(
	props: string[],
	rows: number[][],
	little = true,
): Uint8Array {
	const header = encode(
		[
			"ply",
			`format binary_${little ? "little" : "big"}_endian 1.0`,
			`element vertex ${rows.length}`,
			...props.map((p) => `property float ${p}`),
			"end_header\n",
		].join("\n"),
	);
	const out = new Uint8Array(header.length + rows.length * props.length * 4);
	out.set(header);
	const dv = new DataView(out.buffer);
	rows
		.flat()
		.forEach((v, i) => dv.setFloat32(header.length + i * 4, v, little));
	return out;
}

describe("parsePly", () => {
	it("fans ASCII faces into coloured triangles", () => {
		const mesh = parsePly(encode(ASCII_QUAD))!;
		expect(mesh.points).toBe(false);
		expect(mesh.triangles).toBe(2);
		expect(Array.from(mesh.colors!.subarray(0, 3))).toEqual([1, 0, 0]);
	});

	it("reads a file without faces as a point cloud", () => {
		for (const little of [true, false]) {
			const mesh = parsePly(
				binaryCloud(
					["x", "y", "z"],
					[
						[0, 0, 0],
						[1, 0, 0],
						[0, 2, 0],
					],
					little,
				),
			)!;
			expect(mesh.points).toBe(true);
			expect(mesh.positions.length).toBe(9);
			expect(mesh.colors).toBeNull();
		}
	});

	it("colours splats from their base term and drops the faint ones", () => {
		const mesh = parsePly(
			binaryCloud(
				["x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0"],
				[
					[0, 0, 0, 0, 0, 0, 5, 1],
					[1, 0, 0, 1.7724, -1.7724, 0, 5, 1],
					[0, 1, 0, 0, 0, 0, -9, 1],
				],
			),
		)!;
		expect(mesh.positions.length).toBe(6);
		expect(mesh.colors![0]).toBeCloseTo(0.5);
		expect(mesh.colors![3]).toBeCloseTo(1, 3);
		expect(mesh.colors![4]).toBeCloseTo(0, 3);
	});

	it("turns down a header that counts more than the file holds", () => {
		const big = binaryCloud(["x", "y", "z"], [[0, 0, 0]]);
		const text = new TextDecoder("latin1").decode(big);
		const lying = text.replace("element vertex 1", "element vertex 900000000");
		expect(parsePly(Uint8Array.from(lying, (c) => c.charCodeAt(0)))).toBeNull();
	});

	it("doesn't walk the count of an element with no properties", () => {
		const empty = ASCII_QUAD.replace(
			"element vertex 4",
			"element nothing 1000000000000\nelement vertex 4",
		);
		expect(parsePly(encode(empty))?.positions.length).toBeGreaterThan(0);
	});

	it("turns down a face list longer than the file", () => {
		const long = ASCII_QUAD.replace("4 0 1 2 3", "4000000000 0 1 2 3");
		expect(() => parsePly(encode(long))).toThrow();
	});

	it("turns down anything that isn't a PLY", () => {
		expect(parsePly(encode("solid cube\nendsolid"))).toBeNull();
	});
});
