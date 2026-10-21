import { describe, expect, it, spyOn } from "bun:test";
import { deflateSync } from "node:zlib";
import { readTree } from "./fbx";

const MAGIC = "Kaydara FBX Binary  \0\x1a\0";

/** A v7400 file: the 27-byte header, then the given nodes laid end to end. */
function fbx(nodes: Uint8Array[]): Uint8Array {
	const size = 27 + nodes.reduce((n, b) => n + b.length, 0) + 13;
	const out = new Uint8Array(size);
	out.set(new TextEncoder().encode(MAGIC), 0);
	new DataView(out.buffer).setUint32(23, 7400, true);
	let at = 27;
	for (const n of nodes) {
		out.set(n, at);
		at += n.length;
	}
	return out;
}

/** A node header with no properties, ending at `end` (absolute), plus padding. */
function node(name: string, end: number, length = 13 + name.length) {
	const out = new Uint8Array(length);
	new DataView(out.buffer).setUint32(0, end, true);
	out[12] = name.length;
	out.set(new TextEncoder().encode(name), 13);
	return out;
}

describe("readTree", () => {
	it("reads top-level nodes up to the null record", async () => {
		const tree = await readTree(fbx([node("A", 27 + 14), node("B", 27 + 28)]));
		expect(tree?.children.map((c) => c.name)).toEqual(["A", "B"]);
	});

	it("gives up on a node whose end points back before its start", async () => {
		const parent = node("P", 27 + 60, 14);
		const child = node("C", 27 + 1, 46);
		expect(await readTree(fbx([parent, child]))).toBeNull();
	});
});

/** A node holding one compressed array of `count` doubles, whose bytes are `data`. */
function arrayNode(start: number, count: number, data: Uint8Array) {
	const packed = deflateSync(data);
	const name = "A";
	const propsLength = 1 + 12 + packed.length;
	const out = new Uint8Array(13 + name.length + propsLength);
	const dv = new DataView(out.buffer);
	dv.setUint32(0, start + out.length, true);
	dv.setUint32(4, 1, true);
	dv.setUint32(8, propsLength, true);
	out[12] = name.length;
	out.set(new TextEncoder().encode(name), 13);
	let at = 13 + name.length;
	out[at++] = "d".charCodeAt(0);
	dv.setUint32(at, count, true);
	dv.setUint32(at + 4, 1, true);
	dv.setUint32(at + 8, packed.length, true);
	out.set(packed, at + 12);
	return out;
}

describe("readTree arrays", () => {
	it("inflates a compressed array", async () => {
		const values = new Float64Array([1.5, -2, 3]);
		const tree = await readTree(
			fbx([arrayNode(27, 3, new Uint8Array(values.buffer))]),
		);
		expect(Array.from(tree!.children[0].props[0] as Float64Array)).toEqual([
			1.5, -2, 3,
		]);
	});

	it("refuses an array that inflates far past its count", async () => {
		const bomb = new Uint8Array(8 * 1024 * 1024);
		expect(await readTree(fbx([arrayNode(27, 3, bomb)]))).toBeNull();
	});

	it("refuses a count no real model reaches, before sizing anything", async () => {
		const tree = await readTree(
			fbx([arrayNode(27, 0xffffffff, new Uint8Array(8))]),
		);
		expect(tree).toBeNull();
	});

	it("sizes a compressed array by what it inflates to, not by its count", async () => {
		const from = spyOn(Float64Array, "from");
		try {
			const tree = await readTree(
				fbx([arrayNode(27, 60_000_000, new Uint8Array(8))]),
			);
			expect(tree).toBeNull();
			expect(from).not.toHaveBeenCalled();
		} finally {
			from.mockRestore();
		}
	});
});
