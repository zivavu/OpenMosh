/** What an Arcs clip keeps: a seed, a palette and only the knobs moved off their
 * defaults. Everything is read through here, so a hand-edited file can't ask for more
 * than a knob allows. */

import { PALETTES, type Colors } from "../generators/palette";
import { FORM_COUNT } from "./forms";

export type ArcsKnobGroup = "picture" | "arcs" | "music" | "listen";

interface ArcsKnob {
	key: string;
	label: string;
	group: ArcsKnobGroup;
	min: number;
	max: number;
	step: number;
	value: number;
	/** Slider curve, for a range that spans decades. */
	curve?: number;
}

export const ARCS_KNOBS = [
	{
		key: "hitSense",
		label: "Hit sensitivity",
		group: "listen",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.45,
	},
	{
		key: "arcAmount",
		label: "Arcs",
		group: "arcs",
		min: 0,
		max: 3,
		step: 0.05,
		value: 1,
	},
	{
		key: "arcSub",
		label: "Subarcs",
		group: "arcs",
		min: 0,
		max: 6,
		step: 1,
		value: 2,
	},
	{
		key: "arcReach",
		label: "Reach",
		group: "arcs",
		min: 0.2,
		max: 3,
		step: 0.05,
		value: 1,
	},
	{
		key: "variety",
		label: "Variety",
		group: "arcs",
		min: 0,
		max: 1,
		step: 0.01,
		value: 1,
	},

	{
		key: "exposure",
		label: "Exposure",
		group: "picture",
		min: 0.1,
		max: 4,
		step: 0.05,
		value: 1.4,
	},
	{
		key: "gamma",
		label: "Gamma",
		group: "picture",
		min: 0.6,
		max: 2.4,
		step: 0.05,
		value: 1.2,
	},
	{
		key: "bloom",
		label: "Bloom",
		group: "picture",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.26,
	},
	{
		key: "dust",
		label: "Core dust",
		group: "picture",
		min: 0,
		max: 0.3,
		step: 0.01,
		value: 0.06,
	},
	{
		key: "glint",
		label: "Glints",
		group: "picture",
		min: 0,
		max: 20,
		step: 0.1,
		value: 8,
	},
	{
		key: "glintThreshold",
		label: "Glint threshold",
		group: "picture",
		min: 0.2,
		max: 12,
		step: 0.1,
		value: 2.5,
	},
	{
		key: "glintLength",
		label: "Glint length",
		group: "picture",
		min: 0.3,
		max: 3,
		step: 0.05,
		value: 1,
	},
	{
		key: "rays",
		label: "Glint rays",
		group: "picture",
		min: 2,
		max: 8,
		step: 2,
		value: 4,
	},
	{
		key: "focusBlur",
		label: "Edge blur",
		group: "picture",
		min: 0,
		max: 6,
		step: 0.1,
		value: 2.5,
	},
	{
		key: "dof",
		label: "Depth of field",
		group: "picture",
		min: 0,
		max: 80,
		step: 1,
		value: 14,
	},
	{
		key: "shutter",
		label: "Shutter",
		group: "picture",
		min: 0,
		max: 0.12,
		step: 0.002,
		value: 0.03,
	},
	{
		key: "far",
		label: "Far structure",
		group: "picture",
		min: 0,
		max: 0.4,
		step: 0.01,
		value: 0.1,
	},

	{
		key: "arcCore",
		label: "Core arcs",
		group: "arcs",
		min: 0,
		max: 48,
		step: 1,
		value: 14,
	},
	{
		key: "arcStems",
		label: "Stems",
		group: "arcs",
		min: 0,
		max: 16,
		step: 1,
		value: 6,
	},
	{
		key: "arcSubDepth",
		label: "Subarc levels",
		group: "arcs",
		min: 1,
		max: 3,
		step: 1,
		value: 2,
	},
	{
		key: "arcSubLength",
		label: "Subarc length",
		group: "arcs",
		min: 0.1,
		max: 1.5,
		step: 0.01,
		value: 0.7,
	},
	{
		key: "arcSubSpread",
		label: "Subarc spread",
		group: "arcs",
		min: 0.1,
		max: 2,
		step: 0.01,
		value: 0.8,
	},
	{
		key: "arcLength",
		label: "Strokes",
		group: "arcs",
		min: 4,
		max: 64,
		step: 1,
		value: 26,
	},
	{
		key: "arcWidth",
		label: "Line width",
		group: "arcs",
		min: 0.4,
		max: 8,
		step: 0.1,
		value: 2.2,
	},
	{
		key: "arcDecay",
		label: "Line decay",
		group: "arcs",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.5,
	},
	{
		key: "arcWander",
		label: "Offset weight",
		group: "arcs",
		min: 0,
		max: 0.5,
		step: 0.005,
		value: 0.1,
	},
	{
		key: "arcMomentum",
		label: "Previous offset multiplier",
		group: "arcs",
		min: 0,
		max: 0.98,
		step: 0.01,
		value: 0.82,
	},
	{
		key: "arcGlow",
		label: "Blur",
		group: "arcs",
		min: 0.5,
		max: 16,
		step: 0.5,
		value: 4,
	},
	{
		key: "arcWrithe",
		label: "Writhe",
		group: "arcs",
		min: 0,
		max: 4,
		step: 0.05,
		value: 1,
	},
	{
		key: "coreSpin",
		label: "Core spin",
		group: "arcs",
		min: 0,
		max: 4,
		step: 0.05,
		value: 1,
	},

	{
		key: "arcKick",
		label: "Kick → arcs per hit",
		group: "music",
		min: 0,
		max: 30,
		step: 1,
		value: 10,
	},
	{
		key: "arcCrackle",
		label: "Highs → crackle",
		group: "music",
		min: 0,
		max: 4,
		step: 0.05,
		value: 1,
	},
	{
		key: "kickFlash",
		label: "Kick → flash",
		group: "music",
		min: 0,
		max: 4,
		step: 0.05,
		value: 0.6,
	},
	{
		key: "kickZoom",
		label: "Kick → zoom blur",
		group: "music",
		min: 0,
		max: 0.6,
		step: 0.01,
		value: 0.14,
	},
	{
		key: "kickPush",
		label: "Kick → camera",
		group: "music",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.3,
	},
	{
		key: "kickRipple",
		label: "Kick → ripple",
		group: "music",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.25,
	},
	{
		key: "bassSwell",
		label: "Bass → swell",
		group: "music",
		min: 0,
		max: 0.8,
		step: 0.01,
		value: 0.15,
	},
	{
		key: "midTwist",
		label: "Mids → twist",
		group: "music",
		min: 0,
		max: 2,
		step: 0.01,
		value: 0.3,
	},
	{
		key: "midWarp",
		label: "Mids → warp",
		group: "music",
		min: 0,
		max: 1.5,
		step: 0.01,
		value: 0.3,
	},
	{
		key: "highSparkle",
		label: "Highs → sparkle",
		group: "music",
		min: 0,
		max: 3,
		step: 0.01,
		value: 1,
	},
	{
		key: "speed",
		label: "Base speed",
		group: "music",
		min: 0,
		max: 2,
		step: 0.01,
		value: 0.35,
	},
	{
		key: "speedReact",
		label: "Energy → speed",
		group: "music",
		min: 0,
		max: 8,
		step: 0.05,
		value: 2,
	},
	{
		key: "morphEvery",
		label: "Change form every",
		group: "music",
		min: 4,
		max: 60,
		step: 1,
		value: 8,
	},
	{
		key: "kickReach",
		label: "Kick → reach",
		group: "music",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.2,
	},
	{
		key: "bassReach",
		label: "Bass → stem reach",
		group: "music",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.24,
	},
	{
		key: "arcLife",
		label: "Arc lifetime",
		group: "arcs",
		min: 0.3,
		max: 3,
		step: 0.05,
		value: 1,
	},
	{
		key: "hitSpacing",
		label: "Time between hits",
		group: "listen",
		min: 0.05,
		max: 1,
		step: 0.01,
		value: 0.12,
	},
	{
		key: "hitSmooth",
		label: "Hit smoothing",
		group: "listen",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.25,
	},
	{
		key: "hitFreqLow",
		label: "Hits from (Hz)",
		group: "listen",
		min: 20,
		max: 16000,
		step: 10,
		value: 30,
		curve: 3,
	},
	{
		key: "hitFreqHigh",
		label: "Hits to (Hz)",
		group: "listen",
		min: 20,
		max: 16000,
		step: 10,
		value: 140,
		curve: 3,
	},
	{
		key: "bassSmooth",
		label: "Bass smoothing",
		group: "listen",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.6,
	},
	{
		key: "bassPunch",
		label: "Bass punch",
		group: "listen",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.15,
	},
	{
		key: "bassFreqLow",
		label: "Bass from (Hz)",
		group: "listen",
		min: 20,
		max: 16000,
		step: 10,
		value: 30,
		curve: 3,
	},
	{
		key: "bassFreqHigh",
		label: "Bass to (Hz)",
		group: "listen",
		min: 20,
		max: 16000,
		step: 10,
		value: 140,
		curve: 3,
	},
	{
		key: "midSmooth",
		label: "Mids smoothing",
		group: "listen",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.5,
	},
	{
		key: "midPunch",
		label: "Mids punch",
		group: "listen",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.3,
	},
	{
		key: "midFreqLow",
		label: "Mids from (Hz)",
		group: "listen",
		min: 20,
		max: 16000,
		step: 10,
		value: 250,
		curve: 3,
	},
	{
		key: "midFreqHigh",
		label: "Mids to (Hz)",
		group: "listen",
		min: 20,
		max: 16000,
		step: 10,
		value: 2500,
		curve: 3,
	},
	{
		key: "highSmooth",
		label: "Highs smoothing",
		group: "listen",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.2,
	},
	{
		key: "highPunch",
		label: "Highs punch",
		group: "listen",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.7,
	},
	{
		key: "highFreqLow",
		label: "Highs from (Hz)",
		group: "listen",
		min: 20,
		max: 16000,
		step: 10,
		value: 5000,
		curve: 3,
	},
	{
		key: "highFreqHigh",
		label: "Highs to (Hz)",
		group: "listen",
		min: 20,
		max: 16000,
		step: 10,
		value: 14000,
		curve: 3,
	},
	{
		key: "energySmooth",
		label: "Energy smoothing",
		group: "listen",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.75,
	},
	{
		key: "sectionSense",
		label: "Section sensitivity",
		group: "listen",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.5,
	},
	{
		key: "kickHeat",
		label: "Kick → arc brightness",
		group: "music",
		min: 0,
		max: 2,
		step: 0.01,
		value: 0.75,
	},
] as const satisfies readonly ArcsKnob[];

export type ArcsKnobKey = (typeof ARCS_KNOBS)[number]["key"];

export type Look = Record<ArcsKnobKey, number> & { seed: number };

/** What a user gets. Each runs from one extreme to another, with 50 the tuned look. */
export const ARCS_CONTROLS = [
	{
		key: "reaction",
		label: "Reaction",
		group: "controls",
		min: 0,
		max: 100,
		step: 1,
		value: 50,
		hint: "How hard the music moves the picture",
	},
	{
		key: "amount",
		label: "Amount",
		group: "controls",
		min: 0,
		max: 100,
		step: 1,
		value: 50,
		hint: "From a few arcs to a swarm",
	},
	{
		key: "reach",
		label: "Reach",
		group: "controls",
		min: 0,
		max: 100,
		step: 1,
		value: 50,
		hint: "How far the arcs travel, and how long they last",
	},
	{
		key: "roughness",
		label: "Roughness",
		group: "controls",
		min: 0,
		max: 100,
		step: 1,
		value: 50,
		hint: "Smooth curves at the low end, jagged lightning at the high end",
	},
] as const;

export type ArcsControlKey = (typeof ARCS_CONTROLS)[number]["key"];

/** Where each control takes the knobs it moves, at 0 and at 100. */
const CONTROL_RANGES: Record<
	ArcsControlKey,
	Partial<Record<ArcsKnobKey, [number, number]>>
> = {
	reaction: {
		kickFlash: [0, 2.5],
		kickHeat: [0.2, 1.8],
		kickZoom: [0, 0.4],
		kickPush: [0, 1],
		kickRipple: [0, 0.9],
		kickReach: [0.02, 0.8],
		bassReach: [0.02, 0.9],
		bassSwell: [0, 0.7],
		midTwist: [0, 1.4],
		midWarp: [0, 1.3],
		highSparkle: [0, 3],
		speedReact: [0.1, 7],
	},
	amount: {
		arcKick: [2, 30],
		arcStems: [1, 16],
		arcCore: [3, 44],
		arcCrackle: [0, 4],
		arcSub: [0, 5],
		arcSubDepth: [1, 3],
		// More arcs each burn dimmer, or a swarm is just a white haze.
		arcAmount: [1.4, 0.6],
	},
	reach: {
		arcReach: [0.35, 2.8],
		arcLength: [12, 60],
		arcLife: [0.45, 2.6],
		arcSubLength: [0.3, 1.3],
	},
	roughness: {
		arcMomentum: [0.95, 0.35],
		arcWander: [0.015, 0.24],
		arcWrithe: [0.25, 3.2],
		arcSubSpread: [0.25, 1.8],
		arcWidth: [4.2, 1.2],
		arcDecay: [0.1, 0.95],
	},
};

/** What hits are heard in, in Hz. */
export const ARCS_LISTEN = {
	kick: { label: "Kick", band: [30, 140] },
	snare: { label: "Snare", band: [180, 5000] },
	hats: { label: "Hats", band: [6000, 16000] },
} as const;

export type ArcsListen = keyof typeof ARCS_LISTEN;

export interface ArcsSpec {
	seed: number;
	palette: string;
	/** Absent means the tuned band, the kick's. */
	listen?: ArcsListen;
	/** Only the controls moved off 50. */
	values?: Partial<Record<ArcsControlKey, number>>;
	/** Lab only, and never saved: what the controls' 50 means. */
	tuning?: Partial<Record<ArcsKnobKey, number>>;
}

/** The knobs the song table is built from; the rest only change how it's drawn. */
export const TABLE_KNOBS: ArcsKnobKey[] = [
	"morphEvery",
	"hitSense",
	...ARCS_KNOBS.filter((k) => k.group === "listen").map((k) => k.key),
];

const ICE: Colors = ["#000208", "#061a4a", "#1f5fd0", "#7fc4ff", "#f2fbff"];
export const ARCS_PALETTES: Record<string, Colors> = { Ice: ICE, ...PALETTES };
export const DEFAULT_ARCS_PALETTE = "Ice";

const KNOB_OF = new Map<string, (typeof ARCS_KNOBS)[number]>(
	ARCS_KNOBS.map((k) => [k.key, k]),
);

function clampTo(v: number, { min, max }: { min: number; max: number }) {
	return v < min ? min : v > max ? max : v;
}

export function allForms(): number[] {
	return Array.from({ length: FORM_COUNT }, (_, i) => i);
}

/** Undefined for anything that isn't a spec; a control it doesn't know is dropped. */
export function normalizeArcsSpec(raw: unknown): ArcsSpec | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const { seed, palette, listen, values } = raw as Record<string, unknown>;
	if (typeof seed !== "number" || !Number.isFinite(seed)) return undefined;
	const spec: ArcsSpec = {
		seed: Math.abs(Math.floor(seed)) >>> 0,
		palette:
			typeof palette === "string" && ARCS_PALETTES[palette]
				? palette
				: DEFAULT_ARCS_PALETTE,
	};
	if (typeof listen === "string" && listen in ARCS_LISTEN) {
		spec.listen = listen as ArcsListen;
	}
	if (typeof values === "object" && values !== null) {
		const kept: Partial<Record<ArcsControlKey, number>> = {};
		for (const control of ARCS_CONTROLS) {
			const v = (values as Record<string, unknown>)[control.key];
			if (typeof v === "number" && Number.isFinite(v)) {
				kept[control.key] = clampTo(v, control);
			}
		}
		if (Object.keys(kept).length > 0) spec.values = kept;
	}
	return spec;
}

export function arcsControlValue(spec: ArcsSpec, key: ArcsControlKey): number {
	return spec.values?.[key] ?? 50;
}

/** Every knob, ready to draw with. Clamps again: a spec needn't have been normalized. */
export function arcsLook(spec: ArcsSpec): Look {
	const look = { seed: spec.seed >>> 0 } as Look;
	for (const knob of ARCS_KNOBS) {
		look[knob.key] = clampTo(spec.tuning?.[knob.key] ?? knob.value, knob);
	}
	for (const control of ARCS_CONTROLS) {
		const at = clampTo(arcsControlValue(spec, control.key), control) / 100;
		const ranges = Object.entries(CONTROL_RANGES[control.key]) as [
			ArcsKnobKey,
			[number, number],
		][];
		for (const [key, [low, high]] of ranges) {
			const tuned = look[key];
			look[key] = clampTo(
				at < 0.5
					? low + (tuned - low) * at * 2
					: tuned + (high - tuned) * (at - 0.5) * 2,
				KNOB_OF.get(key)!,
			);
		}
	}
	if (spec.listen && spec.listen !== "kick") {
		[look.hitFreqLow, look.hitFreqHigh] = ARCS_LISTEN[spec.listen].band;
	}
	return look;
}

export function arcsColors(spec: ArcsSpec): Colors {
	return ARCS_PALETTES[spec.palette] ?? ICE;
}
