/** What an Arcs clip keeps: a seed, a palette and only the knobs moved off their
 * defaults. Everything is read through here, so a hand-edited file can't ask for more
 * than a knob allows. */

import { PALETTES, type Colors } from "../../../src/lib/generators/palette";

export type ArcsKnobGroup = "structure" | "stroke" | "music" | "listen";

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
		key: "arcBlur",
		label: "Line blur",
		group: "stroke",
		min: 1,
		max: 10,
		step: 0.1,
		value: 6,
	},
	{
		key: "arcLength",
		label: "Segments",
		group: "stroke",
		min: 2,
		max: 32,
		step: 1,
		value: 10,
	},
	{
		key: "arcWidth",
		label: "Line width",
		group: "stroke",
		min: 1,
		max: 15,
		step: 0.5,
		value: 8,
	},
	{
		key: "arcDecay",
		label: "Line decay",
		group: "stroke",
		min: 0.1,
		max: 2,
		step: 0.01,
		value: 0.5,
	},
	{
		key: "arcWander",
		label: "Offset weight",
		group: "stroke",
		min: 0,
		max: 120,
		step: 1,
		value: 50,
	},
	{
		key: "arcMomentum",
		label: "Momentum",
		group: "stroke",
		min: 0,
		max: 0.98,
		step: 0.01,
		value: 0.8,
	},
	{
		key: "arcHairs",
		label: "Strokes in a figure",
		group: "structure",
		min: 40,
		max: 500,
		step: 10,
		value: 150,
	},
	{
		key: "arcSize",
		label: "Figure size",
		group: "structure",
		min: 0.4,
		max: 1.6,
		step: 0.01,
		value: 1,
	},
	{
		key: "arcComb",
		label: "Comb",
		group: "structure",
		min: 0,
		max: 3,
		step: 0.01,
		value: 0.7,
	},
	{
		key: "arcJitter",
		label: "Stroke independence",
		group: "structure",
		min: 0,
		max: 1,
		step: 0.01,
		value: 0.12,
	},
	{
		key: "arcReach",
		label: "Reach",
		group: "structure",
		min: 0.2,
		max: 2.5,
		step: 0.01,
		value: 1,
	},
	{
		key: "arcHue",
		label: "Colour spread",
		group: "structure",
		min: 0,
		max: 0.5,
		step: 0.01,
		value: 0.12,
	},
	{
		key: "arcOpacity",
		label: "Opacity",
		group: "structure",
		min: 0,
		max: 1,
		step: 0.01,
		value: 1,
	},
	{
		key: "arcWrithe",
		label: "Writhe",
		group: "music",
		min: 0,
		max: 3,
		step: 0.05,
		value: 0.5,
	},
	{
		key: "midWrithe",
		label: "Mids → writhe",
		group: "music",
		min: 0,
		max: 3,
		step: 0.05,
		value: 1,
	},
	{
		key: "kickReach",
		label: "Kick → reach",
		group: "music",
		min: 0,
		max: 1.5,
		step: 0.01,
		value: 0.35,
	},
	{
		key: "bassReach",
		label: "Bass → reach",
		group: "music",
		min: 0,
		max: 1.5,
		step: 0.01,
		value: 0.25,
	},
	{
		key: "kickWidth",
		label: "Kick → width",
		group: "music",
		min: 0,
		max: 2,
		step: 0.01,
		value: 0.4,
	},
	{
		key: "kickPressure",
		label: "Hit → stroke weight",
		group: "music",
		min: 0,
		max: 1.5,
		step: 0.01,
		value: 0.6,
	},
	{
		key: "morphEvery",
		label: "Change figure every",
		group: "music",
		min: 4,
		max: 60,
		step: 1,
		value: 12,
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
		hint: "How many strokes each figure is drawn with",
	},
	{
		key: "reach",
		label: "Reach",
		group: "controls",
		min: 0,
		max: 100,
		step: 1,
		value: 50,
		hint: "How far each stroke runs from the figure",
	},
	{
		key: "roughness",
		label: "Roughness",
		group: "controls",
		min: 0,
		max: 100,
		step: 1,
		value: 50,
		hint: "Low: strokes bend together. High: each one goes its own way.",
	},
] as const;

export type ArcsControlKey = (typeof ARCS_CONTROLS)[number]["key"];

/** Where each control takes the knobs it moves, at 0 and at 100. */
const CONTROL_RANGES: Record<
	ArcsControlKey,
	Partial<Record<ArcsKnobKey, [number, number]>>
> = {
	reaction: {
		kickReach: [0, 1.2],
		bassReach: [0, 1],
		kickWidth: [0, 1.5],
		kickPressure: [0, 1.2],
		midWrithe: [0, 2.5],
	},
	amount: {
		arcHairs: [50, 450],
		// A denser figure's strokes are thinner, or it closes into a solid shape.
		arcWidth: [10, 5],
		arcBlur: [7, 4.5],
		arcOpacity: [1, 0.85],
	},
	reach: {
		arcReach: [0.4, 1.9],
		arcLength: [6, 20],
		arcComb: [0.4, 1.1],
		arcSize: [1.1, 0.8],
	},
	roughness: {
		arcJitter: [0, 1],
		arcMomentum: [0.9, 0.55],
		arcWrithe: [0.15, 2],
		arcDecay: [0.25, 1.2],
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
