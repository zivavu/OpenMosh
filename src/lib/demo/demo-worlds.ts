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
	/** One effect per element, not up to two. */
	lean?: boolean;
}

export const WORLDS: World[] = [
	{
		scene: NEON_CANYON,
		backdropPool: ["posterize", "soft-glitch", "duotone"],
		elementPools: [
			["glow", "channel-split", "solarize", "data-bend"],
			["neon-edges", "posterize", "glow", "halftone"],
			["glow", "channel-split", "neon-edges"],
			["glow", "ripple", "wobble", "channel-split"],
		],
		postPool: ["vhs", "channel-split", "soft-glitch", "scanlines"],
	},
	{
		scene: ABYSS,
		backdropPool: ["posterize", "soft-glitch", "halftone"],
		elementPools: [
			["glow", "wobble", "channel-split"],
			["glow", "neon-edges", "ripple"],
			["glow", "solarize", "wobble"],
		],
		postPool: ["vhs", "scanlines", "channel-split"],
	},
	{
		scene: SNACK_GALAXY,
		backdropPool: ["posterize", "halftone", "duotone"],
		elementPools: [
			["pixel-sort", "glow", "halftone", "channel-split"],
			["glow", "solarize", "posterize"],
			["data-bend", "channel-split", "neon-edges"],
			["wobble", "glow", "posterize"],
		],
		postPool: ["soft-glitch", "channel-split", "scanlines"],
	},
	{
		scene: GLOW_FOREST,
		backdropPool: ["posterize", "soft-glitch", "halftone"],
		elementPools: [
			["glow", "neon-edges", "solarize"],
			["pixel-sort", "channel-split", "glow"],
			["wobble", "posterize", "channel-split"],
			["glow"],
		],
		postPool: ["vhs", "scanlines", "soft-glitch"],
	},
	{
		scene: SKY_WHALE,
		backdropPool: ["posterize", "soft-glitch", "halftone"],
		elementPools: [
			["pixel-sort", "channel-split", "glow", "data-bend"],
			["glow", "channel-split"],
			["posterize", "wobble", "neon-edges"],
		],
		postPool: ["vhs", "scanlines", "channel-split"],
	},
	{
		scene: VAPOR_PLAZA,
		backdropPool: ["posterize", "soft-glitch", "halftone", "duotone"],
		elementPools: [
			["glow", "channel-split", "solarize"],
			["glow", "neon-edges"],
			["glow", "channel-split", "data-bend"],
		],
		postPool: ["vhs", "scanlines", "channel-split"],
	},
	{
		scene: DEEP_SPACE,
		backdropPool: ["posterize", "soft-glitch", "halftone"],
		elementPools: [
			["glow", "channel-split", "pixel-sort"],
			["neon-edges", "posterize", "data-bend"],
			["solarize", "halftone", "wobble"],
		],
		postPool: ["vhs", "scanlines", "channel-split"],
	},
	{
		scene: MAGMA_RIVER,
		backdropPool: ["posterize", "soft-glitch", "halftone"],
		elementPools: [
			["glow", "channel-split", "data-bend"],
			["pixel-sort", "posterize", "channel-split"],
			["glow", "neon-edges", "solarize"],
		],
		postPool: ["vhs", "scanlines", "channel-split"],
	},
];

/** Single-pass effects only: no glow bloom, no wide sampling loops. */
const FLAT_BACKDROP = ["posterize", "duotone", "halftone", "soft-glitch"];
const FLAT_POST = ["scanlines", "channel-split", "vhs"];

export const FLAT_WORLDS: World[] = [
	{
		scene: SUNSET_DRIVE,
		backdropPool: FLAT_BACKDROP,
		elementPools: [
			["channel-split", "solarize", "data-bend"],
			["wobble", "channel-split", "posterize"],
		],
		postPool: FLAT_POST,
		lean: true,
	},
	{
		scene: LAVA_LAMP,
		backdropPool: FLAT_BACKDROP,
		elementPools: [
			["ripple", "solarize", "posterize"],
			["channel-split", "wobble", "halftone"],
		],
		postPool: FLAT_POST,
		lean: true,
	},
	{
		scene: POP_SHAPES,
		backdropPool: FLAT_BACKDROP,
		elementPools: [
			["halftone", "channel-split"],
			["data-bend", "solarize"],
			["wobble", "posterize"],
		],
		postPool: FLAT_POST,
		lean: true,
	},
	{
		scene: RINGED_PLANET,
		backdropPool: FLAT_BACKDROP,
		elementPools: [
			["posterize", "channel-split", "data-bend"],
			["solarize", "wobble"],
		],
		postPool: FLAT_POST,
		lean: true,
	},
	{
		scene: NEON_TUNNEL,
		backdropPool: FLAT_BACKDROP,
		elementPools: [
			["channel-split", "solarize", "ripple"],
			["wobble", "data-bend"],
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

export function startWorld(world: World, alt: boolean): WorldShow {
	const chains = [
		moshed(pickSome(world.backdropPool, 1)),
		...world.elementPools.map((pool) =>
			moshed(
				pickSome(pool, world.lean ? 1 : 1 + Math.floor(Math.random() * 2)),
			),
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
		post: moshed(pickSome(world.postPool, 1)),
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
