/** What a curated mosh knows about each effect: where it sits in a signal chain,
 * which effects it fights with, and which param is its strength. */

/** Signal-chain order, first to last. */
export const STAGES = [
	"geometry",
	"time",
	"glitch",
	"color",
	"stylize",
	"light",
	"finish",
] as const;
export type Stage = (typeof STAGES)[number];

/** Effects that fight each other: two palette remaps turn to mud, two edge
 * detectors to white, stacked symmetries to noise. */
export type Family =
	| "symmetry"
	| "warp"
	| "motion"
	| "time"
	| "displace"
	| "block"
	| "rgb"
	| "palette"
	| "grade"
	| "edges"
	| "print"
	| "light"
	| "focus"
	| "texture"
	| "frame"
	| "flash"
	| "overlay";

export interface FamilyRule {
	/** Relative odds of the family being picked for a slot. */
	weight: number;
	/** How many of its effects one roll may hold. */
	cap: number;
	/** Can carry a whole look on its own, so it may be the roll's hero. */
	hero: boolean;
}

export const FAMILIES: Record<Family, FamilyRule> = {
	symmetry: { weight: 0.5, cap: 1, hero: true },
	warp: { weight: 0.8, cap: 1, hero: true },
	motion: { weight: 0.4, cap: 1, hero: false },
	time: { weight: 1.2, cap: 1, hero: true },
	displace: { weight: 1.4, cap: 2, hero: true },
	block: { weight: 0.6, cap: 1, hero: true },
	rgb: { weight: 1.1, cap: 1, hero: true },
	palette: { weight: 1.0, cap: 1, hero: true },
	grade: { weight: 0.6, cap: 1, hero: false },
	edges: { weight: 0.8, cap: 1, hero: true },
	print: { weight: 0.5, cap: 1, hero: true },
	light: { weight: 0.8, cap: 1, hero: false },
	focus: { weight: 0.4, cap: 1, hero: false },
	texture: { weight: 0.7, cap: 1, hero: false },
	frame: { weight: 0.4, cap: 1, hero: false },
	flash: { weight: 0.3, cap: 1, hero: false },
	overlay: { weight: 0.2, cap: 1, hero: false },
};

export interface Curation {
	stage: Stage;
	family: Family;
	/** The range param that reads as "how much". `centered` ones run both ways from 0. */
	amount?: { key: string; centered?: true };
}

const c = (
	stage: Stage,
	family: Family,
	amount?: string,
	centered?: true,
): Curation => ({
	stage,
	family,
	...(amount
		? { amount: { key: amount, ...(centered ? { centered } : {}) } }
		: {}),
});

/** Every effect a roll may pick. Non-moshable effects need no entry. */
export const CURATION: Record<string, Curation> = {
	mirror: c("geometry", "symmetry"),
	kaleido: c("geometry", "symmetry", "amount"),
	tile: c("geometry", "symmetry"),
	bulge: c("geometry", "warp", "amount", true),
	wobble: c("geometry", "warp", "amount"),
	swirl: c("geometry", "warp", "angle"),
	ripple: c("geometry", "warp", "amount"),
	"ring-warp": c("geometry", "warp"),
	shockwave: c("geometry", "warp", "magnitude"),
	zoom: c("geometry", "motion", "amount", true),
	shake: c("geometry", "motion", "amount"),

	feedback: c("time", "time"),
	"fast-mosh": c("time", "time"),
	"optical-flow": c("time", "time", "amount"),
	smear: c("time", "time", "amount"),
	melt: c("time", "time", "amount"),
	tunnel: c("time", "time"),
	"motion-mask": c("time", "time"),

	slices: c("glitch", "displace", "offset"),
	"pixel-sort": c("glitch", "displace", "range"),
	"data-bend": c("glitch", "displace", "intensity"),
	"pixel-shifter": c("glitch", "displace"),
	"fiber-displace": c("glitch", "displace", "strength"),
	jitter: c("glitch", "displace", "amount"),
	"soft-glitch": c("glitch", "displace", "amount"),
	"screen-jump": c("glitch", "displace", "intensity"),
	"resize-glitch": c("glitch", "displace", "chance"),
	"stylize-glitch": c("glitch", "displace", "level"),
	pixelate: c("glitch", "block", "size"),
	"channel-split": c("glitch", "rgb", "amount"),
	"rgb-burst": c("glitch", "rgb", "amplitude"),
	stereoscopic: c("glitch", "rgb", "depth"),

	duotone: c("color", "palette", "intensity"),
	"trio-tone": c("color", "palette", "intensity"),
	thermal: c("color", "palette", "intensity"),
	"hsv-swap": c("color", "palette", "amount"),
	posterize: c("color", "palette"),
	solarize: c("color", "palette"),
	"color-halves": c("color", "palette", "amount"),
	bleach: c("color", "grade", "amount"),
	"color-correction": c("color", "grade"),

	edges: c("stylize", "edges", "mix"),
	"neon-edges": c("stylize", "edges", "strength"),
	"sobel-neon": c("stylize", "edges", "neon"),
	emboss: c("stylize", "edges", "mix"),
	relief: c("stylize", "edges", "amount"),
	"flow-contours": c("stylize", "edges"),
	halftone: c("stylize", "print"),

	glow: c("light", "light", "amount"),
	"liquid-light": c("light", "light"),
	ghosting: c("light", "light"),
	blur: c("light", "focus", "radius"),
	"radial-blur": c("light", "focus", "strength"),
	sharpen: c("light", "focus", "amount"),

	scanlines: c("finish", "texture", "amount"),
	vhs: c("finish", "texture", "static"),
	grain: c("finish", "texture", "amount"),
	composite: c("finish", "texture", "mix"),
	vignette: c("finish", "frame", "amount"),
	strobe: c("finish", "flash", "amount"),
	"rgb-strobe": c("finish", "flash"),
	"audio-bars": c("finish", "overlay", "opacity"),
	tracking: c("finish", "overlay", "opacity"),
};

/** What an effect missing from the table is treated as: a mid-chain glitch. */
export function curationOf(defId: string): Curation {
	return CURATION[defId] ?? { stage: "glitch", family: "displace" };
}
