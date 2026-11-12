/** A keyed layer placement held through playback, from a panel slider or a handle
 * on the preview, recorded as a pass. */

import { KeyTake, pointerHeld } from "../key-take";
import { writeTake, type Keyframe } from "../keyframes";
import { levelOf } from "../key-groups";
import {
	hasLaneKeys,
	isPlacementGrouped,
	isPlacementKeyed,
	setLaneGroupCurve,
	laneStyleAt,
	PLACEMENT_KEYS,
	PLACEMENT_TOLERANCE,
	type LaneKeys,
	type PlacementKey,
} from "./lane-keys";
import type { MediaLane, MediaStyle } from "./types";

export interface PlacementTakeHost {
	/** Whether a pointer is down; the real one unless a test stands in. */
	held?: () => boolean;
	/** Frame scheduling for the take, for tests. */
	frame?: (cb: () => void) => number;
	lane(id: string): MediaLane | null;
	setLane(id: string, edit: (lane: MediaLane) => MediaLane): void;
	beforeEdit(): void;
	/** Timeline seconds. */
	time(): number;
	playing(): boolean;
}

/** A take's name for a group's curve, apart from the placement values. */
const GROUP = "group:";

function isPlacement(key: string): key is PlacementKey {
	return (PLACEMENT_KEYS as readonly string[]).includes(key);
}

export class PlacementTakes {
	readonly #host: PlacementTakeHost;
	#pass: { laneId: string; take: KeyTake<string> } | null = null;

	constructor(host: PlacementTakeHost) {
		this.#host = host;
	}

	/** A placement edit, taken as part of a recorded pass. False when it isn't one.
	 * `history` off when the caller already marked the gesture for undo. */
	edit(laneId: string, style: MediaStyle, history = true): boolean {
		const host = this.#host;
		if (!host.playing() || !(host.held ?? pointerHeld)()) return false;
		const lane = host.lane(laneId);
		if (!lane || !hasLaneKeys(lane)) return false;
		const shown = laneStyleAt(lane, host.time());
		const animated = (k: PlacementKey) =>
			isPlacementKeyed(lane, k) || isPlacementGrouped(lane, k);
		const moved = PLACEMENT_KEYS.filter(
			(k) => animated(k) && style[k] !== shown[k],
		);
		const active = this.#pass?.laneId === laneId && !this.#pass.take.ended;
		if (moved.length === 0 && !active) return false;
		if (!active) this.#start(lane, history);

		// What isn't keyed is written as it is.
		const plain: Partial<MediaStyle> = {};
		for (const key of Object.keys(style) as (keyof MediaStyle)[]) {
			if (isPlacement(key) && animated(key)) continue;
			if (style[key] !== lane.style[key])
				(plain as Record<string, unknown>)[key] = style[key];
		}
		if (Object.keys(plain).length > 0)
			host.setLane(laneId, (l) => ({ ...l, style: { ...l.style, ...plain } }));

		// A grouped value records its group's curve, as the level it sits at.
		const values: Record<string, number> = {};
		for (const k of moved) {
			const link = lane.keyLinks?.[k];
			if (link) values[`${GROUP}${link.group}`] = levelOf(link, style[k]);
			else values[k] = style[k];
		}
		this.#pass!.take.set(values);
		return true;
	}

	#start(lane: MediaLane, history: boolean) {
		this.#pass?.take.end();
		const host = this.#host;
		if (history) host.beforeEdit();
		const laneId = lane.id;
		const base: LaneKeys = Object.fromEntries(
			Object.entries(lane.keys ?? {}).map(([k, keys]) => [
				k,
				keys!.map((key) => ({ ...key })),
			]),
		);
		const curves = new Map<string, Keyframe<number>[]>();
		for (const link of Object.values(lane.keyLinks ?? {}))
			if (link)
				curves.set(
					link.group,
					link.keys.map((k) => ({ ...k })),
				);
		const take: KeyTake<string> = new KeyTake<string>({
			now: () => (host.playing() ? host.time() : null),
			frame: host.frame,
			cancelFrame: host.frame && (() => {}),
			apply: (samples, final) =>
				host.setLane(laneId, (l) => {
					let next = l;
					const keys: LaneKeys = { ...l.keys };
					for (const [p, taken] of Object.entries(samples)) {
						if (!taken) continue;
						if (p.startsWith(GROUP)) {
							const group = p.slice(GROUP.length);
							next = setLaneGroupCurve(
								next,
								group,
								writeTake(curves.get(group), taken, final ? 0.01 : undefined),
							);
							continue;
						}
						const key = p as PlacementKey;
						keys[key] = writeTake(
							base[key],
							taken,
							final ? PLACEMENT_TOLERANCE[key] : undefined,
						);
					}
					if (Object.keys(keys).length > 0) return { ...next, keys };
					const { keys: _, ...rest } = next;
					return rest;
				}),
			onEnd: () => {
				if (this.#pass?.take === take) this.#pass = null;
			},
		});
		this.#pass = { laneId, take };
	}

	dispose() {
		this.#pass?.take.end();
	}
}
