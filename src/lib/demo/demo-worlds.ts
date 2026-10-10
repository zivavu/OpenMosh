/** Worlds for the upload-screen demo: scenes cut into layers, the backdrop and
 * each element running its own mosh. Raymarched 3D where the device keeps up,
 * flat 2D where it doesn't. */

import { createEffectInstance, getDefinition } from "../effects";
import type { EffectInstance } from "../effects/types";
import { generateMosh } from "../editor/mosh";
import type { PostChainLayer } from "../gl/renderer";
import type { SceneDef } from "../gl/scene-pass";
import {
	altLayerKey,
	DEFAULT_MEDIA_STYLE,
	type MediaLayerSide,
	type ResolvedMediaLayer,
} from "../media";
import type { ConcreteTransition } from "../media/transition";
import { LAVA_LAMP } from "./flat-worlds/lava-lamp";
import { NEON_TUNNEL } from "./flat-worlds/neon-tunnel";
import { POP_SHAPES } from "./flat-worlds/pop-shapes";
import { RINGED_PLANET } from "./flat-worlds/ringed-planet";
import { SUNSET_DRIVE } from "./flat-worlds/sunset-drive";
import { ABYSS } from "./worlds/abyss";
import { DEEP_SPACE } from "./worlds/deep-space";
import { GLOW_FOREST } from "./worlds/glow-forest";
import { MAGMA_RIVER } from "./worlds/magma-river";
import { NEON_CANYON } from "./worlds/neon-canyon";
import { SKY_WHALE } from "./worlds/sky-whale";
import { SNACK_GALAXY } from "./worlds/snack-galaxy";
import { VAPOR_PLAZA } from "./worlds/vapor-plaza";

/** Every world renders at this size; the canvas stretches it to cover the screen. */
export const DEMO_WIDTH = 640;
export const DEMO_HEIGHT = 360;

export interface World {
	scene: SceneDef;
	backdropPool: string[];
	/** One pool per element, in id order. */
	elementPools: string[][];
	postPool: string[];
	/** One effect per layer and post pass, not a stack. */
	lean?: boolean;
}

/** Rolled on every 3D world's backdrop and post pass, on top of its own picks. */
const BACKDROP_EXTRA = [
	"trio-tone",
	"thermal",
	"hsv-swap",
	"color-halves",
	"grain",
	"bleach",
];
const POST_EXTRA = ["rgb-burst", "stylize-glitch", "pixel-shifter", "grain"];

export const WORLDS: World[] = [
	{
		scene: NEON_CANYON,
		backdropPool: ["posterize", "soft-glitch", "duotone", ...BACKDROP_EXTRA],
		elementPools: [
			["glow", "channel-split", "solarize", "data-bend", "sobel-neon"],
			["neon-edges", "posterize", "glow", "halftone", "radial-blur", "slices"],
			["glow", "channel-split", "neon-edges", "rgb-burst", "kaleido"],
			["glow", "ripple", "wobble", "channel-split", "shockwave", "ring-warp"],
		],
		postPool: [
			"vhs",
			"channel-split",
			"soft-glitch",
			"scanlines",
			...POST_EXTRA,
		],
	},
	{
		scene: ABYSS,
		backdropPool: ["posterize", "soft-glitch", "halftone", ...BACKDROP_EXTRA],
		elementPools: [
			["glow", "wobble", "channel-split", "liquid-light", "swirl"],
			["glow", "neon-edges", "ripple", "ring-warp", "ghosting"],
			["glow", "solarize", "wobble", "melt", "bulge"],
		],
		postPool: ["vhs", "scanlines", "channel-split", ...POST_EXTRA],
	},
	{
		scene: SNACK_GALAXY,
		backdropPool: ["posterize", "halftone", "duotone", ...BACKDROP_EXTRA],
		elementPools: [
			["pixel-sort", "glow", "halftone", "channel-split", "kaleido", "tile"],
			["glow", "solarize", "posterize", "hsv-swap", "bulge"],
			["data-bend", "channel-split", "neon-edges", "slices", "pixel-shifter"],
			["wobble", "glow", "posterize", "swirl", "rgb-burst"],
		],
		postPool: ["soft-glitch", "channel-split", "scanlines", ...POST_EXTRA],
	},
	{
		scene: GLOW_FOREST,
		backdropPool: ["posterize", "soft-glitch", "halftone", ...BACKDROP_EXTRA],
		elementPools: [
			["glow", "neon-edges", "solarize", "sobel-neon", "ghosting"],
			["pixel-sort", "channel-split", "glow", "smear", "melt"],
			["wobble", "posterize", "channel-split", "flow-contours", "swirl"],
			["glow", "radial-blur", "shockwave"],
		],
		postPool: ["vhs", "scanlines", "soft-glitch", ...POST_EXTRA],
	},
	{
		scene: SKY_WHALE,
		backdropPool: ["posterize", "soft-glitch", "halftone", ...BACKDROP_EXTRA],
		elementPools: [
			["pixel-sort", "channel-split", "glow", "data-bend", "smear", "slices"],
			["glow", "channel-split", "ghosting", "radial-blur"],
			["posterize", "wobble", "neon-edges", "ripple", "stereoscopic"],
		],
		postPool: ["vhs", "scanlines", "channel-split", ...POST_EXTRA],
	},
	{
		scene: VAPOR_PLAZA,
		backdropPool: [
			"posterize",
			"soft-glitch",
			"halftone",
			"duotone",
			...BACKDROP_EXTRA,
		],
		elementPools: [
			["glow", "channel-split", "solarize", "mirror", "trio-tone"],
			["glow", "neon-edges", "sobel-neon", "kaleido"],
			["glow", "channel-split", "data-bend", "slices", "pixel-shifter"],
		],
		postPool: ["vhs", "scanlines", "channel-split", ...POST_EXTRA],
	},
	{
		scene: DEEP_SPACE,
		backdropPool: ["posterize", "soft-glitch", "halftone", ...BACKDROP_EXTRA],
		elementPools: [
			["glow", "channel-split", "pixel-sort", "radial-blur", "shockwave"],
			["neon-edges", "posterize", "data-bend", "sobel-neon", "stereoscopic"],
			["solarize", "halftone", "wobble", "swirl", "ring-warp"],
		],
		postPool: ["vhs", "scanlines", "channel-split", ...POST_EXTRA],
	},
	{
		scene: MAGMA_RIVER,
		backdropPool: ["posterize", "soft-glitch", "halftone", ...BACKDROP_EXTRA],
		elementPools: [
			["glow", "channel-split", "data-bend", "melt", "thermal"],
			["pixel-sort", "posterize", "channel-split", "smear", "slices"],
			["glow", "neon-edges", "solarize", "liquid-light", "ghosting"],
		],
		postPool: ["vhs", "scanlines", "channel-split", ...POST_EXTRA],
	},
];

/** Single-pass effects only: no glow bloom, no wide sampling loops. */
const FLAT_BACKDROP = [
	"posterize",
	"duotone",
	"halftone",
	"soft-glitch",
	"trio-tone",
	"thermal",
	"hsv-swap",
	"color-halves",
];
const FLAT_POST = [
	"scanlines",
	"channel-split",
	"vhs",
	"grain",
	"pixel-shifter",
];

export const FLAT_WORLDS: World[] = [
	{
		scene: SUNSET_DRIVE,
		backdropPool: FLAT_BACKDROP,
		elementPools: [
			["channel-split", "solarize", "data-bend", "slices", "stereoscopic"],
			["wobble", "channel-split", "posterize", "mirror", "jitter"],
		],
		postPool: FLAT_POST,
		lean: true,
	},
	{
		scene: LAVA_LAMP,
		backdropPool: FLAT_BACKDROP,
		elementPools: [
			["ripple", "solarize", "posterize", "swirl", "bulge"],
			["channel-split", "wobble", "halftone", "ring-warp"],
		],
		postPool: FLAT_POST,
		lean: true,
	},
	{
		scene: POP_SHAPES,
		backdropPool: FLAT_BACKDROP,
		elementPools: [
			["halftone", "channel-split", "tile"],
			["data-bend", "solarize", "slices"],
			["wobble", "posterize", "bulge"],
		],
		postPool: FLAT_POST,
		lean: true,
	},
	{
		scene: RINGED_PLANET,
		backdropPool: FLAT_BACKDROP,
		elementPools: [
			["posterize", "channel-split", "data-bend", "stereoscopic"],
			["solarize", "wobble", "swirl"],
		],
		postPool: FLAT_POST,
		lean: true,
	},
	{
		scene: NEON_TUNNEL,
		backdropPool: FLAT_BACKDROP,
		elementPools: [
			["channel-split", "solarize", "ripple", "ring-warp"],
			["wobble", "data-bend", "jitter"],
		],
		postPool: FLAT_POST,
		lean: true,
	},
];

/** The world with this scene id in either set, for previewing one in dev. */
export function findWorld(
	id: string,
): { worlds: World[]; index: number } | null {
	for (const worlds of [WORLDS, FLAT_WORLDS]) {
		const index = worlds.findIndex((w) => w.scene.id === id);
		if (index >= 0) return { worlds, index };
	}
	return null;
}

/** Every effect a world rolls from, for the dev check that they still exist. */
export function worldEffectIds(): string[] {
	return [...WORLDS, ...FLAT_WORLDS].flatMap((w) => [
		...w.backdropPool,
		...w.postPool,
		...w.elementPools.flat(),
	]);
}

function pickSome(pool: string[], count: number): string[] {
	const left = [...pool];
	const out: string[] = [];
	while (out.length < count && left.length > 0) {
		out.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]);
	}
	return out;
}

/** `ids`, all on, with rolled values. */
function moshed(ids: string[]): EffectInstance[] {
	const chain: EffectInstance[] = [];
	for (const id of ids) {
		const def = getDefinition(id);
		if (def) chain.push(createEffectInstance(def));
	}
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

/** One layer's share of the scene: 0 the backdrop, then each element. */
export interface WorldPart {
	key: string;
	scene: SceneDef;
	part: number;
}

/** A world on screen: its scene, cut into lanes, each with a freshly rolled chain. */
export interface WorldShow {
	scene: SceneDef;
	parts: WorldPart[];
	chains: EffectInstance[][];
	post: EffectInstance[];
}

/** Lane i's key. Consecutive worlds alternate between a lane's two keys, so the
 * outgoing one keeps its texture while the next blends in over it. */
function laneKey(lane: number, alt: boolean): string {
	const key = `demo-world-${lane}`;
	return alt ? altLayerKey(key) : key;
}

/** 1 to `max` effects; a lean world always takes one. */
function rollCount(world: World, max: number): number {
	return world.lean ? 1 : 1 + Math.floor(Math.random() * max);
}

export function startWorld(world: World, alt: boolean): WorldShow {
	const chains = [
		moshed(pickSome(world.backdropPool, rollCount(world, 2))),
		...world.elementPools.map((pool) =>
			moshed(pickSome(pool, rollCount(world, 3))),
		),
	];
	return {
		scene: world.scene,
		parts: chains.map((_, part) => ({
			key: laneKey(part, alt),
			scene: world.scene,
			part,
		})),
		chains,
		post: moshed(pickSome(world.postPool, rollCount(world, 2))),
	};
}

function side(show: WorldShow, lane: number): MediaLayerSide {
	const { key } = show.parts[lane];
	return {
		key,
		clipId: key,
		sourceId: key,
		sourceTime: 0,
		effects: show.chains[lane],
	};
}

export interface WorldBlend {
	from: WorldShow;
	concrete: ConcreteTransition;
	/** 0→1 across the blend. */
	progress: number;
	seed: number;
}

/** The frame's layers: the world on screen, each lane blending in from the same
 * lane of the world before it while `blend` runs. */
export function worldLayers(
	show: WorldShow,
	blend: WorldBlend | null,
): ResolvedMediaLayer[] {
	const lanes = Math.max(show.parts.length, blend?.from.parts.length ?? 0);
	const layers: ResolvedMediaLayer[] = [];
	for (let lane = 0; lane < lanes; lane++) {
		const incoming = lane < show.parts.length ? side(show, lane) : null;
		const outgoing =
			blend && lane < blend.from.parts.length ? side(blend.from, lane) : null;
		const base = {
			laneId: `demo-world-${lane}`,
			z: lane,
			style: DEFAULT_MEDIA_STYLE,
		};
		if (incoming) {
			layers.push({
				...base,
				...incoming,
				opacity: 1,
				transition: blend
					? {
							from: outgoing,
							concrete: blend.concrete,
							progress: blend.progress,
							seed: blend.seed,
						}
					: undefined,
			});
		} else if (outgoing && blend) {
			layers.push({ ...base, ...outgoing, opacity: 1 - blend.progress });
		}
	}
	return layers;
}

/** The pass over the whole world, cross-faded with the outgoing world's. */
export function worldPost(
	show: WorldShow,
	blend: WorldBlend | null,
): PostChainLayer[] {
	const lanes: PostChainLayer[] = [
		{ effects: show.post, weight: blend ? blend.progress : 1, z: 100 },
	];
	if (blend) {
		lanes.push({ effects: blend.from.post, weight: 1 - blend.progress, z: 99 });
	}
	return lanes;
}
