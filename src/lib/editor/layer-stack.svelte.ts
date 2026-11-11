/** One stacking order across media, text and fx lanes: moving a lane restacks the
 * others it passes, whichever timeline holds them. */

import {
	duplicateMediaLane,
	MAX_MEDIA_LANES,
	type MediaClip,
	type MediaLane,
	type MediaTimeline,
} from "../media";
import type { TextClip, TextLane, TextTimeline } from "../text";
import {
	applyLayerMoves,
	combinedLayerOrder,
	moveLayerTo,
	nextLayerZ,
	stackIndex,
	zAbove,
} from "../timeline/layer-order";
import type { ChainTimelineState } from "./chain-timeline-state.svelte";
import { asOneEdit } from "./edit-clock";
import type { FxLaneState } from "./fx-lane-state.svelte";

type Move = { id: string; z: number };

export interface LayerStackHost {
	media: ChainTimelineState<MediaTimeline, MediaLane, MediaClip>;
	text: ChainTimelineState<TextTimeline, TextLane, TextClip>;
	fx: FxLaneState;
	/** The lane last pressed, which a new lane goes just above. */
	activeLaneId(): string | null | undefined;
	revealLane(laneId: string): void;
}

const movesAny = (moves: Move[], lanes: { id: string }[]) =>
	lanes.some((l) => moves.some((m) => m.id === l.id));

export class LayerStack {
	readonly #host: LayerStackHost;

	/** Every layer, front first. */
	order = $derived.by(() =>
		combinedLayerOrder(
			this.#host.media.timeline.lanes,
			this.#host.text.timeline.lanes,
			this.#host.fx.lanes,
		),
	);

	constructor(host: LayerStackHost) {
		this.#host = host;
	}

	/** The z of a lane added on top. */
	topZ(): number {
		return nextLayerZ(this.order);
	}

	/** Where a new stacked lane goes: just above the lane last pressed, else on top. */
	newLaneZ = (): number =>
		zAbove(this.order, this.#host.activeLaneId() ?? null);

	/** Drop a layer at `toIndex` in the shared stack. Only the stacks whose lanes moved
	 * record it, under one stamp: one Ctrl+Z. */
	reorder = (laneId: string, toIndex: number, coalesceKey?: string) => {
		const moves = moveLayerTo(this.order, laneId, toIndex);
		if (!moves) return;
		const { media } = this.#host;
		asOneEdit(() => {
			if (movesAny(moves, media.timeline.lanes)) {
				media.pushHistory(coalesceKey);
				media.set({
					...media.timeline,
					lanes: applyLayerMoves(media.timeline.lanes, moves),
				});
			}
			this.#restackFxAndText(moves, coalesceKey);
		});
	};

	/** A copy of the media lane, stacked right above it, in one undo step. */
	copyMediaLane = (laneId: string) => {
		const { media, text, fx } = this.#host;
		const lane = media.timeline.lanes.find((l) => l.id === laneId);
		if (!lane || media.timeline.lanes.length >= MAX_MEDIA_LANES) return;
		const copy = duplicateMediaLane(lane, this.topZ());
		const lanes = [...media.timeline.lanes, copy];
		const order = combinedLayerOrder(lanes, text.timeline.lanes, fx.lanes);
		const moves =
			moveLayerTo(order, copy.id, stackIndex(this.order, laneId)) ?? [];
		asOneEdit(() => {
			media.pushHistory();
			media.set({ ...media.timeline, lanes: applyLayerMoves(lanes, moves) });
			this.#restackFxAndText(moves);
		});
		this.#host.revealLane(copy.id);
	};

	#restackFxAndText(moves: Move[], coalesceKey?: string) {
		const { text, fx } = this.#host;
		if (movesAny(moves, fx.lanes)) {
			fx.pushHistory(coalesceKey);
			fx.set(applyLayerMoves(fx.lanes, moves));
		}
		if (movesAny(moves, text.timeline.lanes)) {
			text.pushHistory(coalesceKey);
			text.set({
				...text.timeline,
				lanes: applyLayerMoves(text.timeline.lanes, moves),
			});
		}
	}
}
