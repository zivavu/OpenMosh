/** Drives the upload-screen demo: which world is on screen and how it blends into the next. */

import { getDefinition } from "../effects";
import type { PostChainLayer } from "../gl/renderer";
import type { SceneDef } from "../gl/scene-pass";
import type { ResolvedMediaLayer } from "../media";
import type { ConcreteTransition } from "../media/transition";
import {
	startWorld,
	WORLD_COUNT,
	worldEffectIds,
	worldIndexOf,
	worldLayers,
	worldPost,
	worldScene,
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
}

/** In dev, `?world=<id>` holds on one world and `?bare` drops every mosh, for
 * building worlds. */
function devOptions(): { only: number; raw: boolean } {
	if (!import.meta.env?.DEV || typeof location === "undefined") {
		return { only: -1, raw: false };
	}
	const params = new URLSearchParams(location.search);
	return {
		only: worldIndexOf(params.get("world") ?? ""),
		raw: params.has("bare"),
	};
}

/** Chains are rolled once per world visit, so frames within it reuse the same
 * EffectInstance objects (feedback buffers are keyed by instanceId). */
function createDemoDirector(): DemoDirector {
	const beatSeconds = 60 / DEMO_BPM;
	const dev = devOptions();
	let elapsed = 0;
	let slotNo = -1;
	// A different opening world each session.
	let worldNo =
		dev.only >= 0 ? dev.only : Math.floor(Math.random() * WORLD_COUNT);
	let slotStart = 0;
	let show: WorldShow | null = null;
	let blend: Omit<WorldBlend, "progress"> | null = null;

	const nextWorld = () =>
		dev.only >= 0 ? dev.only : (worldNo + 1) % WORLD_COUNT;

	return {
		scene: () => show?.scene ?? worldScene(worldNo),
		advance(deltaSeconds: number): DemoFrame {
			elapsed += Math.max(0, deltaSeconds);
			const beat = elapsed / beatSeconds;

			if (!show || beat >= slotStart + WORLD_BEATS) {
				const from = show;
				if (from) {
					worldNo = nextWorld();
					slotStart += WORLD_BEATS;
				}
				slotNo++;
				show = startWorld(worldNo, slotNo % 2 === 1);
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
					beat > slotStart + WORLD_BEATS / 2 ? worldScene(nextWorld()) : null,
			};
		},
	};
}

let shared: DemoDirector | null = null;

/** One director for the whole session, so every upload mode shows the same performance. */
export function getDemoDirector(): DemoDirector {
	return (shared ??= createDemoDirector());
}

/** Ids in the pools that no longer exist, guarding against a rename emptying the demo. */
export function missingDemoEffects(): string[] {
	return worldEffectIds().filter((id) => !getDefinition(id));
}
