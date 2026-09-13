import { describe, expect, it } from "bun:test";
import { planGradientBatch } from "./gradient/plan";
import { isGradientSpec } from "./gradient/spec";
import { embedSpec, readGenerated } from "./png-meta";

describe("planGradientBatch", () => {
	it("is deterministic for a seed", () => {
		const opts = { count: 16, variety: "wild" as const, palette: null };
		expect(planGradientBatch(7, opts)).toEqual(planGradientBatch(7, opts));
		expect(planGradientBatch(7, opts)).not.toEqual(planGradientBatch(8, opts));
	});

	it("produces valid specs at every count", () => {
		for (const count of [1, 2, 8, 64]) {
			const specs = planGradientBatch(1, {
				count,
				variety: "wild",
				palette: null,
			});
			expect(specs).toHaveLength(count);
			for (const s of specs) expect(isGradientSpec(s)).toBe(true);
		}
	});

	it("deals modes and masks in proportion rather than by luck", () => {
		const specs = planGradientBatch(3, {
			count: 32,
			variety: "wild",
			palette: null,
		});
		const scatter = specs.filter((s) => s.mode === 1).length;
		const masked = specs.filter((s) => s.thresh > 0).length;
		expect(scatter).toBeGreaterThanOrEqual(10);
		expect(scatter).toBeLessThanOrEqual(16);
		expect(masked).toBeGreaterThanOrEqual(8);
		expect(masked).toBeLessThanOrEqual(12);
	});

	it("keeps a named palette on every image", () => {
		const specs = planGradientBatch(5, {
			count: 8,
			variety: "wild",
			palette: "Magma",
		});
		for (const s of specs) expect(s.colors[2]).toBe("#e8197a");
	});

	it("keeps a cohesive batch to one mode and mask", () => {
		const specs = planGradientBatch(9, {
			count: 16,
			variety: "cohesive",
			palette: null,
		});
		expect(new Set(specs.map((s) => s.mode)).size).toBe(1);
		expect(new Set(specs.map((s) => s.thresh > 0)).size).toBe(1);
	});
});

/** Smallest valid-looking PNG: signature + IHDR + empty IDAT + IEND. */
function fakePng(width: number, height: number): Blob {
	const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	const chunk = (type: string, data: number[]) => [
		...[
			(data.length >>> 24) & 255,
			(data.length >>> 16) & 255,
			(data.length >>> 8) & 255,
			data.length & 255,
		],
		...[...type].map((c) => c.charCodeAt(0)),
		...data,
		0,
		0,
		0,
		0,
	];
	const be = (n: number) => [
		(n >>> 24) & 255,
		(n >>> 16) & 255,
		(n >>> 8) & 255,
		n & 255,
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
		const [spec] = planGradientBatch(2, {
			count: 1,
			variety: "wild",
			palette: null,
		});
		const blob = await embedSpec(fakePng(640, 360), spec);
		const file = new File([blob], "g.png", { type: "image/png" });
		const info = await readGenerated(file);
		expect(info).not.toBeNull();
		expect(info!.spec).toEqual(spec);
		expect(info!.width).toBe(640);
		expect(info!.height).toBe(360);
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
