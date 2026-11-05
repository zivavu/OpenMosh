/** What an Arcs clip keeps: a seed, a palette and only the knobs moved off their
 * defaults. Everything is read through here, so a hand-edited file can't ask for more
 * than a knob allows. */

import { PALETTES, type Colors } from "../generators/palette";
import { FORM_COUNT } from "./forms";

export type ArcsKnobGroup = "main" | "picture" | "arcs" | "music";

interface ArcsKnob {
	key: string;
	label: string;
	group: ArcsKnobGroup;
	min: number;
	max: number;
	step: number;
	value: number;
}

export const ARCS_KNOBS = [
	{
		key: "intensity",
		label: "Intensity",
		group: "main",
		min: 0,
		max: 2,
		step: 0.01,
		value: 1,
	},
	{
		key: "arcAmount",
		label: "Arcs",
		group: "main",
		min: 0,
		max: 3,
		step: 0.05,
		value: 1,
	},
	{
		key: "arcSub",
		label: "Subarcs",
		group: "main",
		min: 0,
		max: 6,
		step: 1,
		value: 2,
	},
	{
		key: "arcReach",
		label: "Reach",
		group: "main",
		min: 0.2,
		max: 3,
		step: 0.05,
		value: 1,
	},
	{
		key: "variety",
		label: "Variety",
		group: "main",
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
] as const satisfies readonly ArcsKnob[];

export type ArcsKnobKey = (typeof ARCS_KNOBS)[number]["key"];

export type Look = Record<ArcsKnobKey, number> & { seed: number };

export interface ArcsSpec {
	seed: number;
	palette: string;
	/** Only the knobs moved off their defaults. */
	values?: Partial<Record<ArcsKnobKey, number>>;
	/** Which forms it moves through; absent means all of them. */
	forms?: number[];
}

/** What Intensity scales: everything the music does to the picture. */
const REACTIONS: ArcsKnobKey[] = [
	"arcKick",
	"arcCrackle",
	"kickFlash",
	"kickZoom",
	"kickPush",
	"kickRipple",
	"bassSwell",
	"midTwist",
	"midWarp",
	"highSparkle",
	"speedReact",
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

/** Null for anything that isn't a spec; a knob or form it doesn't know is dropped. */
export function normalizeArcsSpec(raw: unknown): ArcsSpec | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const { seed, palette, values, forms } = raw as Record<string, unknown>;
	if (typeof seed !== "number" || !Number.isFinite(seed)) return undefined;
	const spec: ArcsSpec = {
		seed: Math.abs(Math.floor(seed)) >>> 0,
		palette:
			typeof palette === "string" && ARCS_PALETTES[palette]
				? palette
				: DEFAULT_ARCS_PALETTE,
	};
	if (typeof values === "object" && values !== null) {
		const kept: Partial<Record<ArcsKnobKey, number>> = {};
		for (const [key, v] of Object.entries(values)) {
			const knob = KNOB_OF.get(key);
			if (knob && typeof v === "number" && Number.isFinite(v)) {
				kept[key as ArcsKnobKey] = clampTo(v, knob);
			}
		}
		if (Object.keys(kept).length > 0) spec.values = kept;
	}
	if (Array.isArray(forms)) {
		const kept = forms.filter(
			(f) => Number.isInteger(f) && f >= 0 && f < FORM_COUNT,
		);
		if (kept.length > 0) spec.forms = [...new Set(kept)] as number[];
	}
	return spec;
}

export function arcsKnobValue(spec: ArcsSpec, key: ArcsKnobKey): number {
	return spec.values?.[key] ?? KNOB_OF.get(key)!.value;
}

/** Every knob, ready to draw with. Clamps again: a spec needn't have been normalized. */
export function arcsLook(spec: ArcsSpec): Look {
	const look = { seed: spec.seed >>> 0 } as Look;
	for (const knob of ARCS_KNOBS) {
		look[knob.key] = clampTo(spec.values?.[knob.key] ?? knob.value, knob);
	}
	for (const key of REACTIONS) {
		look[key] = clampTo(look[key] * look.intensity, KNOB_OF.get(key)!);
	}
	return look;
}

export function arcsColors(spec: ArcsSpec): Colors {
	return ARCS_PALETTES[spec.palette] ?? ICE;
}
