import { describe, expect, it } from "bun:test";
import { mulberry32 } from "../rng";
import { searchSystem } from "./attractor/systems";
import { isAttractorSpec } from "./attractor/spec";
import { isCutoutSpec } from "./cutout/spec";
import { isFieldSpec, type FieldSpec } from "./field/spec";
import { isInkSpec } from "./ink/spec";
import {
	DRAWN_KINDS,
	isTransparentSpec,
	ONE_KINDS,
	planBatch,
	specKind,
} from "./plan";
import { deal } from "./palette";
import { embedSpec, isGeneratedSpec, readGenerated } from "./png-meta";
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
		for (const kind of ["mix", ...ONE_KINDS] as const)
			for (const variety of ["wild", "cohesive"] as const)
				for (const count of [1, 2, 8, 64]) {
					const specs = planBatch(1, wild({ count, kind, variety }));
					expect(specs).toHaveLength(count);
					for (const s of specs) {
						expect(isGeneratedSpec(s)).toBe(true);
						expect(isGeneratedSpec(JSON.parse(JSON.stringify(s)))).toBe(true);
					}
					if (kind !== "mix")
						for (const s of specs) expect(specKind(s)).toBe(kind);
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
		expect(new Set(specs.map(specKind)).size).toBe(ONE_KINDS.length);
	});

	it("keeps a named palette on every image", () => {
		const specs = planBatch(5, wild({ count: 8, palette: "Magma" }));
		for (const s of specs) expect(s.colors[2]).toBe("#e8197a");
	});

	it("no longer plans voronoi or stripes, in a mix or anywhere else", () => {
		for (let seed = 0; seed < 30; seed++)
			for (const variety of ["wild", "cohesive"] as const)
				for (const s of planBatch(seed, wild({ count: 16, variety })))
					expect(["voronoi", "stripes"]).not.toContain(specKind(s));
	});

	it("leaves the other fields in the original style", () => {
		for (const kind of ["plasma", "rings"] as const)
			for (const s of planBatch(6, wild({ count: 8, kind })))
				expect(s.gen === "field" && s.style).toBeUndefined();
	});

	it("keeps a cohesive batch to one generator", () => {
		const specs = planBatch(9, wild({ variety: "cohesive" }));
		expect(new Set(specs.map(specKind)).size).toBe(1);
	});

	it("picks a different generator for a cohesive mix across seeds", () => {
		const seen = (transparent: boolean) =>
			new Set(
				Array.from({ length: 40 }, (_, seed) =>
					specKind(
						planBatch(
							seed,
							wild({ count: 4, variety: "cohesive", transparent }),
						)[0],
					),
				),
			);
		expect(seen(false).size).toBeGreaterThan(4);
		expect(seen(true).size).toBe(DRAWN_KINDS.length);
	});

	it("varies the cohesive pick within a generator across seeds", () => {
		const across = (kind: "attractor" | "ink" | "rings", key: string) =>
			new Set(
				Array.from(
					{ length: 40 },
					(_, seed) =>
						(
							planBatch(
								seed,
								wild({ count: 2, kind, variety: "cohesive" }),
							)[0] as unknown as Record<string, unknown>
						)[key],
				),
			).size;
		expect(across("attractor", "system")).toBe(3);
		expect(across("ink", "style")).toBe(2);
		expect(across("rings", "domain")).toBe(2);
	});

	it("keeps a cohesive drawn batch to one scene, system or style", () => {
		const cohesive = (kind: "cutout" | "attractor" | "ink") =>
			planBatch(10, wild({ count: 8, kind, variety: "cohesive" }));
		const one = (values: unknown[]) => expect(new Set(values).size).toBe(1);
		one(cohesive("cutout").map((s) => s.gen === "cutout" && s.scene));
		one(cohesive("attractor").map((s) => s.gen === "attractor" && s.system));
		one(cohesive("ink").map((s) => s.gen === "ink" && s.style));
	});

	it("marks drawn images transparent when asked, and only those", () => {
		for (const kind of DRAWN_KINDS)
			for (const s of planBatch(
				12,
				wild({ count: 8, kind, transparent: true }),
			))
				expect(isTransparentSpec(s)).toBe(true);
		const field = planBatch(12, wild({ kind: "plasma", transparent: true }));
		expect(field.some(isTransparentSpec)).toBe(false);
		const opaque = planBatch(12, wild({ kind: "ink" }));
		for (const s of opaque) expect("transparent" in s).toBe(false);
	});

	it("keeps every drawn image and colour when the background turns transparent", () => {
		const strip = (spec: object) => {
			const { transparent: _, ...rest } = spec as { transparent?: true };
			return rest;
		};
		for (const kind of ["mix", ...DRAWN_KINDS] as const)
			for (const variety of ["wild", "cohesive"] as const)
				for (let seed = 0; seed < 12; seed++) {
					const solid = planBatch(seed, wild({ count: 16, kind, variety }));
					const clear = planBatch(
						seed,
						wild({ count: 16, kind, variety, transparent: true }),
					);
					solid.forEach((s, i) => {
						expect(clear[i].colors).toEqual(s.colors);
						if (DRAWN_KINDS.includes(specKind(s) as never))
							expect(strip(clear[i])).toEqual(strip(s));
					});
				}
	});

	it("deals only drawn kinds into a transparent mix", () => {
		for (const variety of ["wild", "cohesive"] as const) {
			const specs = planBatch(
				13,
				wild({ count: 32, variety, transparent: true }),
			);
			for (const s of specs) {
				expect(DRAWN_KINDS as readonly string[]).toContain(specKind(s));
				expect(isTransparentSpec(s)).toBe(true);
			}
		}
	});

	it("deals every cutout scene, attractor system and ink style in a wild batch", () => {
		const of = (kind: "cutout" | "attractor" | "ink") =>
			planBatch(11, wild({ count: 16, kind }));
		const count = (values: unknown[]) => new Set(values).size;
		expect(count(of("cutout").map((s) => s.gen === "cutout" && s.scene))).toBe(
			4,
		);
		expect(
			count(of("attractor").map((s) => s.gen === "attractor" && s.system)),
		).toBe(3);
		expect(count(of("ink").map((s) => s.gen === "ink" && s.style))).toBe(2);
	});

	it("keeps a smaller nested batch as the start of a larger one", () => {
		const ids = (specs: object[]) => specs.map((s) => JSON.stringify(s)).sort();
		for (const kind of ["mix", ...ONE_KINDS] as const)
			for (const variety of ["wild", "cohesive"] as const) {
				const batch = (count: number) =>
					planBatch(21, wild({ count, kind, variety, nest: 64 }));
				const big = ids(batch(32));
				for (const count of [6, 8, 16])
					for (const id of ids(batch(count))) expect(big).toContain(id);
			}
	});

	it("deals in proportion at every prefix", () => {
		const kinds = deal(mulberry32(5), 64, [
			["a", 0.5],
			["b", 0.25],
			["c", 0.25],
		]);
		for (let n = 1; n <= 64; n++) {
			const a = kinds.slice(0, n).filter((k) => k === "a").length;
			expect(Math.abs(a - n / 2)).toBeLessThan(2);
		}
	});
});

/** A voronoi image as one was saved before the generator was retired. */
const SAVED_FIELD: FieldSpec = {
	gen: "field",
	field: "voronoi",
	seed: 41.7,
	offset: [1.2, -0.8],
	scale: 4.5,
	domain: 0,
	cycles: 1,
	params: [0.85, 0, 1, 0.4],
	angle: 2.1,
	light: 1.8,
	contrast: 1.3,
	gamma: 0.6,
	grain: 0,
	colors: ["#000000", "#5c0026", "#e8197a", "#ff6a1a", "#ffd23a"],
	style: 1,
};

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
		for (const kind of ONE_KINDS) {
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

	it("still reads images made with the retired voronoi and stripes", async () => {
		for (const field of ["voronoi", "stripes"] as const) {
			const blob = await embedSpec(fakePng(320, 180), {
				...SAVED_FIELD,
				field,
			});
			const file = new File([blob], "old.png", { type: "image/png" });
			expect((await readGenerated(file))?.spec).toEqual({
				...SAVED_FIELD,
				field,
			});
		}
	});

	it("reads older specs without a style, and refuses a style it doesn't know", () => {
		const { style: _, ...older } = SAVED_FIELD;
		expect(isFieldSpec(older)).toBe(true);
		expect(isFieldSpec({ ...SAVED_FIELD, style: 2 })).toBe(false);
	});

	it("refuses drawn specs with values a render can't use", () => {
		const [cutout] = planBatch(3, wild({ count: 1, kind: "cutout" }));
		const [attractor] = planBatch(3, wild({ count: 1, kind: "attractor" }));
		const [ink] = planBatch(3, wild({ count: 1, kind: "ink" }));
		expect(isCutoutSpec({ ...cutout, layers: 40 })).toBe(false);
		expect(isCutoutSpec({ ...cutout, scene: "sea" })).toBe(false);
		expect(isCutoutSpec({ ...cutout, seed: 1.5 })).toBe(false);
		expect(isAttractorSpec({ ...attractor, density: 0 })).toBe(false);
		expect(isAttractorSpec({ ...attractor, symmetry: 2.5 })).toBe(false);
		expect(isInkSpec({ ...ink, strokes: 1e6 })).toBe(false);
		expect(isInkSpec({ ...ink, turbulence: 1e9 })).toBe(false);
		expect(isInkSpec({ ...ink, turbulence: -1 })).toBe(false);
		expect(isInkSpec({ ...ink, colors: ["#000"] })).toBe(false);
		expect(isInkSpec({ ...ink, transparent: true })).toBe(true);
		expect(isInkSpec({ ...ink, transparent: false })).toBe(false);
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

describe("attractor search", () => {
	it("finds the same system and finite bounds for a seed", () => {
		for (const kind of ["clifford", "dejong", "flame"] as const) {
			const a = searchSystem(mulberry32(42), kind);
			const b = searchSystem(mulberry32(42), kind);
			expect(a.bounds).toEqual(b.bounds);
			expect(a.system.coef).toEqual(b.system.coef);
			const [x0, x1, y0, y1] = a.bounds;
			expect(x1 - x0).toBeGreaterThan(0);
			expect(y1 - y0).toBeGreaterThan(0);
			expect(a.bounds.every(Number.isFinite)).toBe(true);
		}
	});
});
