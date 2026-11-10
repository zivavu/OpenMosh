export type ExportQuality = "small" | "standard" | "high" | "max";

export const DEFAULT_EXPORT_QUALITY: ExportQuality = "standard";

interface BitrateLevel {
	bitsPerPixel: number;
	min: number;
	max: number;
}

/** Bitrate scales with output size: a fixed rate starves big canvases and bloats
 * small ones. Chrome honors the target, Firefox clamps it. */
const LEVELS: Record<ExportQuality, BitrateLevel> = {
	small: { bitsPerPixel: 0.08, min: 1_500_000, max: 20_000_000 },
	standard: { bitsPerPixel: 0.2, min: 3_000_000, max: 60_000_000 },
	high: { bitsPerPixel: 0.4, min: 6_000_000, max: 80_000_000 },
	max: { bitsPerPixel: 0.8, min: 10_000_000, max: 120_000_000 },
};

export function isExportQuality(value: unknown): value is ExportQuality {
	return typeof value === "string" && Object.hasOwn(LEVELS, value);
}

export function targetVideoBitrate(
	quality: ExportQuality,
	width: number,
	height: number,
	fps: number,
): number {
	const { bitsPerPixel, min, max } = LEVELS[quality];
	return Math.round(
		Math.min(max, Math.max(min, width * height * fps * bitsPerPixel)),
	);
}
