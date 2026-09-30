/** Drives the upload-screen demo: which world is on screen and how it blends into the next. */

import { getDefinition } from "../effects";
import type { PostChainLayer } from "../gl/renderer";
import type { SceneDef } from "../gl/scene-pass";
import type { ResolvedMediaLayer } from "../media";
import type { ConcreteTransition } from "../media/transition";
import {
	findWorld,
	FLAT_WORLDS,
	startWorld,
	worldEffectIds,
	worldLayers,
	WORLDS,
	worldPost,
	type World,
	type WorldBlend,
	type WorldPart,
	type WorldShow,
} from "./demo-worlds";

const DEMO_BPM = 20;

/** Beats each world holds the screen. */
const WORLD_BEATS = 2;

/** Share of a beat the blend between worlds takes, ~0.6s at 20 BPM. */
const TRANSITION_BEATS = 0.2;

/** Every transition the app ships but "cut". */
const TRANSITION_POOL: ConcreteTransition["type"][] = [
	"rgbslip",
	"slam",
	"whip",
	"shatter",
	"burn",
	"crosswarp",
	"crosszoom",
	"cube",
];

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

export interface DemoFrame {
	/** Seconds since the demo first started, for the renderer's time uniform. */
	time: number;
	/** Scene parts to stage on their layers before rendering. */
	parts: WorldPart[];
	layers: ResolvedMediaLayer[];
	post: PostChainLayer[];
	/** The next world, once this one is halfway: compile it now, not at the cut. */
	upcoming: SceneDef | null;
}

export interface DemoDirector {
	/** The world on screen, or the one about to open. */
	scene(): SceneDef;
	advance(deltaSeconds: number): DemoFrame;
	/** Whether it runs the flat worlds, for devices the 3D ones are too heavy for. */
	readonly flat: boolean;
	/** Every scene of the running set, for compiling them all up front. */
	scenes(): SceneDef[];
	/** Cuts to the flat worlds on the next frame, and stays on them. */
	goFlat(): void;
}

interface DevOptions {
	only: { worlds: World[]; index: number } | null;
	raw: boolean;
	flat: boolean;
}

/** In dev, `?world=<id>` holds on one world, `?bare` drops every mosh and `?flat`
 * starts on the flat worlds, for building worlds. */
function devOptions(): DevOptions {
	if (!import.meta.env?.DEV || typeof location === "undefined") {
		return { only: null, raw: false, flat: false };
	}
	const params = new URLSearchParams(location.search);
	return {
		only: findWorld(params.get("world") ?? ""),
		raw: params.has("bare"),
		flat: params.has("flat"),
	};
}

/** Chains are rolled once per world visit, so frames within it reuse the same
 * EffectInstance objects (feedback buffers are keyed by instanceId). */
function createDemoDirector(startFlat: boolean): DemoDirector {
	const beatSeconds = 60 / DEMO_BPM;
	const dev = devOptions();
	let worlds =
		dev.only?.worlds ?? (startFlat || dev.flat ? FLAT_WORLDS : WORLDS);
	let elapsed = 0;
	let slotNo = -1;
	// A different opening world each session.
	let worldNo = dev.only?.index ?? Math.floor(Math.random() * worlds.length);
	let slotStart = 0;
	let show: WorldShow | null = null;
	let blend: Omit<WorldBlend, "progress"> | null = null;
	/** Set by goFlat: the next frame cuts straight to a flat world. */
	let cutNow = false;

	const nextWorld = () => dev.only?.index ?? (worldNo + 1) % worlds.length;

	return {
		scene: () => show?.scene ?? worlds[worldNo].scene,
		get flat() {
			return worlds === FLAT_WORLDS;
		},
		scenes: () => worlds.map((w) => w.scene),
		goFlat() {
			if (worlds === FLAT_WORLDS || dev.only) return;
			worlds = FLAT_WORLDS;
			worldNo = Math.floor(Math.random() * worlds.length);
			// Before the first frame there's nothing to cut from.
			cutNow = show !== null;
		},
		advance(deltaSeconds: number): DemoFrame {
			elapsed += Math.max(0, deltaSeconds);
			const beat = elapsed / beatSeconds;

			if (!show || cutNow || beat >= slotStart + WORLD_BEATS) {
				const from = show;
				if (cutNow) {
					slotStart = beat;
					cutNow = false;
				} else if (from) {
					worldNo = nextWorld();
					slotStart += WORLD_BEATS;
				}
				slotNo++;
				show = startWorld(worlds[worldNo], slotNo % 2 === 1);
				if (dev.raw) {
					show.chains = show.chains.map(() => []);
					show.post = [];
				}
				blend = from
					? {
							from,
							concrete: {
								type: pick(TRANSITION_POOL),
								direction: Math.floor(Math.random() * 4),
								density: Math.floor(Math.random() * 3),
							},
							seed: Math.floor(Math.random() * 997),
						}
					: null;
			}

			let live: WorldBlend | null = null;
			if (blend) {
				const progress = (beat - slotStart) / TRANSITION_BEATS;
				if (progress >= 1) blend = null;
				else live = { ...blend, progress: Math.max(0, progress) };
			}

			return {
				time: elapsed,
				parts: live ? [...show.parts, ...live.from.parts] : show.parts,
				layers: worldLayers(show, live),
				post: worldPost(show, live),
				upcoming:
					beat > slotStart + WORLD_BEATS / 2 ? worlds[nextWorld()].scene : null,
			};
		},
	};
}

let shared: DemoDirector | null = null;

/** One director for the whole session, so every upload mode shows the same
 * performance. `startFlat` only counts on the first call. */
export function getDemoDirector(startFlat: boolean): DemoDirector {
	return (shared ??= createDemoDirector(startFlat));
}

/** Ids in the pools that no longer exist, guarding against a rename emptying the demo. */
export function missingDemoEffects(): string[] {
	return worldEffectIds().filter((id) => !getDefinition(id));
}
