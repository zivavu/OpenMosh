/** A layer lane's effect chain, as the clip panels edit it. EffectsPanel owns the
 * array it is given, so a lane's chain has to be mirrored into state of its own and
 * written back on every edit. Both clip panels need the same mirror. */

import { untrack } from "svelte";
import {
	setVolumeLink,
	type EffectInstance,
	type VolumeLink,
} from "../effects";

/** All a lane has to be for its chain to be edited this way. */
export interface EffectLane {
	id: string;
	effects: EffectInstance[];
}

export class LaneEffects<L extends EffectLane> {
	#effects = $state<EffectInstance[]>([]);
	#loadedLaneId = $state<string | null>(null);
	/** The array the mirror was last filled from, or last wrote back. */
	#loadedFrom: EffectInstance[] | null = null;
	readonly #getLane: () => L | null;
	readonly #onLaneChange: (lane: L) => void;
	readonly #onBeforeEdit?: (coalesceKey?: string) => void;

	constructor(
		getLane: () => L | null,
		onLaneChange: (lane: L) => void,
		onBeforeEdit?: (coalesceKey?: string) => void,
	) {
		this.#getLane = getLane;
		this.#onLaneChange = onLaneChange;
		this.#onBeforeEdit = onBeforeEdit;
	}

	get effects(): EffectInstance[] {
		return this.#effects;
	}

	set effects(next: EffectInstance[]) {
		this.#effects = next;
	}

	/** Reload the mirror when the panel moves to another lane, or when the lane's chain
	 * is replaced from outside (a mosh walked with ←/→ swaps the whole array). Both are
	 * identity checks, and `commit` records what it wrote, so an edit made through the
	 * panel must not reload. Call from an effect; the untracked reads keep it from
	 * subscribing to the state it writes. */
	sync(): void {
		const lane = this.#getLane();
		const id = lane?.id ?? null;
		const effects = lane?.effects ?? null;
		const known = untrack(
			() => id === this.#loadedLaneId && effects === this.#loadedFrom,
		);
		if (known) return;
		this.#loadedLaneId = id;
		this.#loadedFrom = effects;
		this.#effects = effects ? [...effects] : [];
	}

	/** Write the mirror back to the lane. */
	commit(): void {
		const lane = this.#getLane();
		if (!lane) return;
		const effects = $state.snapshot(this.#effects) as EffectInstance[];
		this.#loadedFrom = effects;
		this.#onLaneChange({ ...lane, effects });
	}

	/** Link one of the chain's params to the music, so a layer's own effects follow the
	 * track the way the main chain and the fx lanes do. Coalesced per param, so dragging
	 * a link's range leaves one undo entry rather than one per frame. */
	linkChange(index: number, paramKey: string, link: VolumeLink | null): void {
		const laneId = this.#getLane()?.id;
		this.#onBeforeEdit?.(`link:${laneId}:${index}:${paramKey}`);
		this.#effects = setVolumeLink(this.#effects, index, paramKey, link);
		this.commit();
	}
}
