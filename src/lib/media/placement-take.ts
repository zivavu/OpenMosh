/** A keyed layer placement held through playback, from a panel slider or a handle
 * on the preview, recorded as a pass. */

import { KeyTake, pointerHeld } from "../key-take";
import { writeTake } from "../keyframes";
import {
	hasLaneKeys,
	isPlacementKeyed,
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

function isPlacement(key: string): key is PlacementKey {
	return (PLACEMENT_KEYS as readonly string[]).includes(key);
}

export class PlacementTakes {
	readonly #host: PlacementTakeHost;
	#pass: { laneId: string; take: KeyTake<PlacementKey> } | null = null;

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
		const moved = PLACEMENT_KEYS.filter(
			(k) => isPlacementKeyed(lane, k) && style[k] !== shown[k],
		);
		const active = this.#pass?.laneId === laneId && !this.#pass.take.ended;
		if (moved.length === 0 && !active) return false;
		if (!active) this.#start(lane, history);

		// What isn't keyed is written as it is.
		const plain: Partial<MediaStyle> = {};
		for (const key of Object.keys(style) as (keyof MediaStyle)[]) {
			if (isPlacement(key) && isPlacementKeyed(lane, key)) continue;
			if (style[key] !== lane.style[key])
				(plain as Record<string, unknown>)[key] = style[key];
		}
		if (Object.keys(plain).length > 0)
			host.setLane(laneId, (l) => ({ ...l, style: { ...l.style, ...plain } }));

		this.#pass!.take.set(Object.fromEntries(moved.map((k) => [k, style[k]])));
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
		const take: KeyTake<PlacementKey> = new KeyTake<PlacementKey>({
			now: () => (host.playing() ? host.time() : null),
			frame: host.frame,
			cancelFrame: host.frame && (() => {}),
			apply: (samples, final) =>
				host.setLane(laneId, (l) => {
					const keys: LaneKeys = { ...l.keys };
					for (const [p, taken] of Object.entries(samples) as [
						PlacementKey,
						NonNullable<LaneKeys[PlacementKey]>,
					][])
						keys[p] = writeTake(
							base[p],
							taken,
							final ? PLACEMENT_TOLERANCE[p] : undefined,
						);
					return { ...l, keys };
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
