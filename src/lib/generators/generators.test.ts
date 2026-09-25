import { describe, expect, it } from "bun:test";
import { isFieldSpec } from "./field/spec";
import { isGradientSpec } from "./gradient/spec";
import { planBatch } from "./plan";
import { embedSpec, readGenerated } from "./png-meta";
import type { BatchOptions } from "./types";

const wild = (over: Partial<BatchOptions> = {}): BatchOptions => ({
	count: 16,
	variety: "wild",
	kind: "mix",
	palette: null,
	...over,
});

describe("planBatch", () => {
	it("is deterministic for a seed", () => {
		expect(planBatch(7, wild())).toEqual(planBatch(7, wild()));
		expect(planBatch(7, wild())).not.toEqual(planBatch(8, wild()));
	});

	it("produces valid specs at every count and kind", () => {
		for (const kind of [
			"mix",
			"gradient",
			"voronoi",
			"stripes",
			"plasma",
			"rings",
		] as const)
			for (const count of [1, 2, 8, 64]) {
				const specs = planBatch(1, wild({ count, kind }));
				expect(specs).toHaveLength(count);
				for (const s of specs)
					expect(isGradientSpec(s) || isFieldSpec(s)).toBe(true);
				if (kind !== "mix")
					for (const s of specs)
						expect(s.gen === "gradient" ? "gradient" : s.field).toBe(kind);
			}
	});

	it("deals gradient modes in proportion rather than by luck, and never masks", () => {
		const specs = planBatch(3, wild({ count: 32, kind: "gradient" }));
		const scatter = specs.filter(
			(s) => s.gen === "gradient" && s.mode === 1,
		).length;
		const masked = specs.filter(
			(s) => s.gen === "gradient" && s.thresh > 0,
		).length;
		expect(scatter).toBeGreaterThanOrEqual(10);
		expect(scatter).toBeLessThanOrEqual(16);
		expect(masked).toBe(0);
	});

	it("mixes every generator into a big batch", () => {
		const specs = planBatch(4, wild({ count: 32 }));
		const kinds = new Set(
			specs.map((s) => (s.gen === "gradient" ? "gradient" : s.field)),
		);
		expect(kinds.size).toBe(5);
	});

	it("keeps a named palette on every image", () => {
		const specs = planBatch(5, wild({ count: 8, palette: "Magma" }));
		for (const s of specs) expect(s.colors[2]).toBe("#e8197a");
	});

	it("draws new voronoi and stripes in the second style, euclid only and off the tunnel", () => {
		const voronoi = planBatch(6, wild({ count: 32, kind: "voronoi" }));
		const looks = new Set<number>();
		for (const s of voronoi) {
			if (s.gen !== "field") throw new Error("not a field");
			expect(s.style).toBe(1);
			expect(s.params[1]).toBe(0);
			expect(s.domain).not.toBe(1);
			looks.add(s.params[2]);
		}
		expect([...looks].every((l) => l >= 0 && l <= 3)).toBe(true);
		expect(looks.size).toBeGreaterThan(2);
		for (const s of planBatch(6, wild({ count: 8, kind: "stripes" })))
			expect(s.gen === "field" && s.style).toBe(1);
	});

	it("leaves the other fields in the original style", () => {
		for (const kind of ["plasma", "rings"] as const)
			for (const s of planBatch(6, wild({ count: 8, kind })))
				expect(s.gen === "field" && s.style).toBeUndefined();
	});

	it("keeps a cohesive batch to one generator", () => {
		const specs = planBatch(9, wild({ variety: "cohesive" }));
		const kinds = new Set(
			specs.map((s) => (s.gen === "gradient" ? "gradient" : s.field)),
		);
		expect(kinds.size).toBe(1);
	});
});

/** Smallest valid-looking PNG: signature + IHDR + empty IDAT + IEND. */
function fakePng(width: number, height: number): Blob {
	const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	const be = (n: number) => [
		(n >>> 24) & 255,
		(n >>> 16) & 255,
		(n >>> 8) & 255,
		n & 255,
	];
	const chunk = (type: string, data: number[]) => [
		...be(data.length),
		...[...type].map((c) => c.charCodeAt(0)),
		...data,
		0,
		0,
		0,
		0,
	];
	const ihdr = chunk("IHDR", [...be(width), ...be(height), 8, 6, 0, 0, 0]);
	return new Blob(
		[
			new Uint8Array([
				...sig,
				...ihdr,
				...chunk("IDAT", []),
				...chunk("IEND", []),
			]),
		],
		{ type: "image/png" },
	);
}

describe("png spec embedding", () => {
	it("round-trips a spec and the image size", async () => {
		for (const kind of ["gradient", "voronoi"] as const) {
			const [spec] = planBatch(2, wild({ count: 1, kind }));
			const blob = await embedSpec(fakePng(640, 360), spec);
			const file = new File([blob], "g.png", { type: "image/png" });
			const info = await readGenerated(file);
			expect(info).not.toBeNull();
			expect(info!.spec).toEqual(spec);
			expect(info!.width).toBe(640);
			expect(info!.height).toBe(360);
		}
	});

	it("reads older specs without a style, and refuses a style it doesn't know", () => {
		const [spec] = planBatch(2, wild({ count: 1, kind: "voronoi" }));
		const { style: _, ...older } = spec as typeof spec & { style?: 1 };
		expect(isFieldSpec(older)).toBe(true);
		expect(isFieldSpec({ ...spec, style: 2 })).toBe(false);
	});

	it("reads ordinary PNGs and other files as plain media", async () => {
		const plain = new File([fakePng(10, 10)], "p.png", { type: "image/png" });
		expect(await readGenerated(plain)).toBeNull();
		const jpg = new File([new Uint8Array([1, 2, 3])], "p.jpg", {
			type: "image/jpeg",
		});
		expect(await readGenerated(jpg)).toBeNull();
	});
});
