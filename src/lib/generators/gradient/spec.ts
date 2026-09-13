/** Everything the gradient shader needs to reproduce one image. */
export interface GradientSpec {
	gen: "gradient";
	seed: number;
	/** 0 = flow (domain-warped fbm), 1 = scatter (vortex field). */
	mode: 0 | 1;
	offset: [number, number];
	scale: number;
	warp: number;
	angle: number;
	light: number;
	spread: number;
	thresh: number;
	soft: number;
	contrast: number;
	gamma: number;
	grain: number;
	/** Five hex stops, dark to bright. */
	colors: [string, string, string, string, string];
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Type guard for a spec read back from a file; anything off is rejected whole. */
export function isGradientSpec(v: unknown): v is GradientSpec {
	if (!v || typeof v !== "object") return false;
	const s = v as Record<string, unknown>;
	if (s.gen !== "gradient") return false;
	if (s.mode !== 0 && s.mode !== 1) return false;
	for (const k of [
		"seed",
		"scale",
		"warp",
		"angle",
		"light",
		"spread",
		"thresh",
		"soft",
		"contrast",
		"gamma",
		"grain",
	]) {
		if (typeof s[k] !== "number" || !Number.isFinite(s[k])) return false;
	}
	const off = s.offset;
	if (
		!Array.isArray(off) ||
		off.length !== 2 ||
		!off.every((n) => typeof n === "number" && Number.isFinite(n))
	)
		return false;
	const cols = s.colors;
	return (
		Array.isArray(cols) &&
		cols.length === 5 &&
		cols.every((c) => typeof c === "string" && HEX.test(c))
	);
}
