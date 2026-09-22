/** Drives the upload-screen demo: which source and effect chain run, on a fixed tempo. */

import { createEffectInstance, getDefinition } from "../effects";
import type { EffectInstance } from "../effects/types";
import { generateMosh } from "../editor/mosh";
import { ANIMATED_EFFECTS } from "../gl/effect-shaders";

const DEMO_BPM = 20;

/** Effects that keep moving between cuts; every id must be one the renderer animates. */
const ANIMATED_POOL = [
	"wobble",
	"ripple",
	"swirl",
	"tunnel",
	"vhs",
	"scanlines",
	"tile",
];

/** Stills that give each cut its character; excludes the subtle ones (blur, sharpen). */
const STATIC_POOL = [
	"zoom",
	"glow",
	"posterize",
	"solarize",
	"channel-split",
	"duotone",
	"color-halves",
	"slices",
	"smear",
	"data-bend",
	"pixel-sort",
	"halftone",
	"edges",
	"neon-edges",
	"mirror",
	"bulge",
	"bleach",
	"soft-glitch",
];

/** Every transition the app ships; "cut" is excluded since the demo already cuts. */
const TRANSITION_POOL = [
	"rgbslip",
	"slam",
	"whip",
	"shatter",
	"burn",
	"crosswarp",
	"crosszoom",
	"cube",
];

/** Share of the beat the blend occupies, tuned for a ~0.45s blend at 20 BPM. */
const TRANSITION_BEATS = 0.15;

/** Sources cut on the beat, never per frame: swapping posters at frame rate strobes. */
const BEATS_PER_SOURCE = 1;

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

function buildChain(): EffectInstance[] {
	const ids = new Set<string>([pick(ANIMATED_POOL)]);
	// A second animated effect most of the time: one alone reads as a loop.
	if (Math.random() > 0.35) ids.add(pick(ANIMATED_POOL));
	const extras = 1 + Math.floor(Math.random() * 2);
	for (let i = 0; i < extras; i++) ids.add(pick(STATIC_POOL));

	const chain: EffectInstance[] = [];
	for (const id of ids) {
		const def = getDefinition(id);
		if (def) chain.push(createEffectInstance(def));
	}

	// Mosh the whole set, reusing the app's own parameter biasing.
	generateMosh(chain, {
		moshMin: chain.length,
		moshMax: chain.length,
		randomizeOrder: false,
		moshAudioLink: false,
		moshAudioLinkStrength: 0,
		hasAudio: false,
	});
	return chain;
}

/** A source change still mid-blend; a null `transition` means the poster is on screen. */
export interface DemoTransition {
	/** Poster being blended out of; goes in the renderer's alt source slot. */
	fromSourceIndex: number;
	effects: EffectInstance[];
	type: string;
	/** 0→1 across the blend. */
	progress: number;
	seed: number;
	direction: number;
	density: number;
}

export interface DemoFrame {
	sourceIndex: number;
	effects: EffectInstance[];
	/** Seconds since the demo first started, for the renderer's time uniform. */
	time: number;
	transition: DemoTransition | null;
}

export interface DemoDirector {
	advance(deltaSeconds: number): DemoFrame;
}

/** Chains are rolled lazily on each cut and cached, so frames within a cut reuse the
 * same EffectInstance objects (feedback buffers are keyed by instanceId). */
function createDemoDirector(sourceCount: number): DemoDirector {
	const beatSeconds = 60 / DEMO_BPM;
	let elapsed = 0;
	let sourceCut = -1;
	let sourceIndex = 0;
	let effects: EffectInstance[] = [];
	/** The blend rolled at the last source cut, replayed until it finishes. */
	let blend: Omit<DemoTransition, "progress"> | null = null;
	let blendStartBeat = 0;

	return {
		advance(deltaSeconds: number): DemoFrame {
			elapsed += Math.max(0, deltaSeconds);
			const beat = elapsed / beatSeconds;

			const nextSourceCut = Math.floor(beat / BEATS_PER_SOURCE);
			if (nextSourceCut !== sourceCut) {
				const first = sourceCut === -1;
				const fromSourceIndex = sourceIndex;
				sourceCut = nextSourceCut;
				sourceIndex = nextSourceCut % sourceCount;
				// Captured before the reroll: the outgoing side keeps rendering the
				// on-screen chain.
				const outgoing = effects;
				effects = buildChain();
				// Nothing to blend out of on the very first poster.
				blend = first
					? null
					: {
							fromSourceIndex,
							effects: outgoing,
							type: pick(TRANSITION_POOL),
							seed: Math.floor(Math.random() * 997),
							direction: Math.floor(Math.random() * 4),
							density: Math.floor(Math.random() * 3),
						};
				blendStartBeat = nextSourceCut * BEATS_PER_SOURCE;
			}

			let transition: DemoTransition | null = null;
			if (blend) {
				const progress = (beat - blendStartBeat) / TRANSITION_BEATS;
				if (progress >= 1) blend = null;
				else transition = { ...blend, progress: Math.max(0, progress) };
			}

			return { sourceIndex, effects, time: elapsed, transition };
		},
	};
}

let shared: { director: DemoDirector; sourceCount: number } | null = null;

/** One director for the whole session, so every upload mode shows the same performance. */
export function getDemoDirector(sourceCount: number): DemoDirector {
	if (!shared || shared.sourceCount !== sourceCount) {
		shared = { director: createDemoDirector(sourceCount), sourceCount };
	}
	return shared.director;
}

/** Ids in the pools that no longer exist, guarding against a rename emptying the demo. */
export function missingDemoEffects(): string[] {
	return [...ANIMATED_POOL, ...STATIC_POOL].filter((id) => !getDefinition(id));
}

/** Animated-pool entries the renderer does not animate, so that slide can come out still. */
export function stillDemoEffects(): string[] {
	return ANIMATED_POOL.filter((id) => !ANIMATED_EFFECTS.has(id));
}
