import { planGradientBatch, GRADIENT_PALETTES } from "./gradient/plan";
import { embedSpec, rememberGenerated } from "./png-meta";
import { renderSpec } from "./render";
import type { BatchOptions, GeneratedSpec } from "./types";

export { GRADIENT_PALETTES, planGradientBatch };
export { readGenerated, type GeneratedInfo } from "./png-meta";
export { renderSpec } from "./render";
export { GeneratedSizeSync } from "./size-sync";
export { mulberry32, randomSeed } from "./rng";
export type { BatchOptions, GeneratedSpec, Variety } from "./types";

/** Output shapes offered by the panel; `base` is the short side in pixels. */
export const RATIOS = [
	{ label: "16:9", w: 16, h: 9 },
	{ label: "9:16", w: 9, h: 16 },
	{ label: "1:1", w: 1, h: 1 },
	{ label: "4:3", w: 4, h: 3 },
	{ label: "3:2", w: 3, h: 2 },
	{ label: "4:5", w: 4, h: 5 },
] as const;

export type RatioLabel = (typeof RATIOS)[number]["label"];

/** Pixel size for a ratio at a given short side. */
export function ratioSize(
	label: RatioLabel,
	shortSide: number,
): { width: number; height: number } {
	const r = RATIOS.find((x) => x.label === label) ?? RATIOS[0];
	return r.w >= r.h
		? { width: Math.round((shortSide * r.w) / r.h), height: shortSide }
		: { width: shortSide, height: Math.round((shortSide * r.h) / r.w) };
}

/** The short side generated files are rendered at. */
export const GENERATED_SHORT_SIDE = 1080;

export function planBatch(seed: number, opts: BatchOptions): GeneratedSpec[] {
	return planGradientBatch(seed, opts);
}

/** Render to a self-describing PNG the rest of the app treats as an upload. */
export async function specToFile(
	spec: GeneratedSpec,
	width: number,
	height: number,
	name: string,
): Promise<File> {
	const png = await renderSpec(spec, width, height, "image/png");
	const blob = await embedSpec(png, spec);
	const file = new File([blob], name, {
		type: "image/png",
		lastModified: Date.now(),
	});
	rememberGenerated(file, { spec, width, height });
	return file;
}

/** Render a whole batch, one after another so the GPU isn't swamped. */
export async function specsToFiles(
	specs: GeneratedSpec[],
	width: number,
	height: number,
	onProgress?: (done: number, total: number) => void,
): Promise<File[]> {
	const stamp = Date.now().toString(36);
	const files: File[] = [];
	for (let i = 0; i < specs.length; i++) {
		const n = String(i + 1).padStart(2, "0");
		files.push(
			await specToFile(
				specs[i],
				width,
				height,
				`${specs[i].gen}-${stamp}-${n}.png`,
			),
		);
		onProgress?.(i + 1, specs.length);
	}
	return files;
}
