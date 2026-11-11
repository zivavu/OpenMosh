/** A timeline of chain-clip lanes as the editor holds it: the timeline, its clip
 * selection, its undo stack and its clip moshes. Text and media lanes are two of these. */

import type { Preset } from "../effects";
import {
	createSnapshotHistory,
	type SnapshotHistory,
} from "../timeline/snapshot-history.svelte";
import { chainClipMoshSnapshot, type ChainClip } from "./chain-clip";
import { fanOutEdit, fanOutNote, withAllLinkBands } from "./chain-fanout";
import { ClipMoshes } from "./clip-moshes.svelte";
import type { FreqBand } from "../effects/types";
import type { MoshOptions } from "./mosh";
import type { MoshSnapshot } from "./mosh-history";
import type { ChainMode } from "./sequence";

type ClipIds = Set<string>;

export interface ChainTimelineOps<
	T extends { lanes: L[] },
	L extends { id: string; clips: C[] },
	C extends ChainClip,
> {
	findClip(timeline: T, id: string | null): C | null;
	findLane(timeline: T, clipId: string | null): L | null;
	replaceClip(timeline: T, next: C): T;
	updateClips(timeline: T, ids: ClipIds, fn: (clip: C) => C): T;
	/** The fields beyond the chain that an edit carries to the rest of the selection. */
	fanOutClipFields(before: C, after: C, target: C): C;
	fanOutLaneEdit(before: L, after: L, target: L): L;
	roll(timeline: T, ids: ClipIds, options: MoshOptions): T;
	restoreMosh(timeline: T, clipId: string, snap: MoshSnapshot): T;
	clear(timeline: T, ids: ClipIds): T;
	fillFromPreset(timeline: T, ids: ClipIds, preset: Preset): T;
	setMode(
		timeline: T,
		ids: ClipIds,
		mode: ChainMode,
		intervalSec?: number,
		intervalBeats?: number | null,
	): T;
	/** Shown over the panel when an edit reaches several clips. */
	selectionNote(count: number): string;
}

export interface ChainTimelineHost {
	moshOptions(): MoshOptions;
	/** Runs a roll, re-rolling while it leaves the frame dead. */
	rollAlive(roll: () => void): void;
	/** After `set` replaces the timeline. */
	onSet?(): void;
}

export class ChainTimelineState<
	T extends { lanes: L[] },
	L extends { id: string; clips: C[] },
	C extends ChainClip,
> {
	readonly #ops: ChainTimelineOps<T, L, C>;
	readonly #host: ChainTimelineHost;
	/** The clip before the panel's edit: its chain panel edits the effects in place. */
	#editBase: C | null = null;

	timeline = $state<T>(null as unknown as T);
	selectedClipId = $state<string | null>(null);
	selectedClipIds = $state<string[]>([]);

	readonly history: SnapshotHistory<T> = createSnapshotHistory<T>();
	readonly moshes: ClipMoshes<C>;

	selectedClip = $derived.by(() => this.#selectedClip());
	/** The lane holding the selected clip. */
	selectedLane = $derived.by(() => this.#selectedLane());
	chainNote = $derived.by(() =>
		fanOutNote(this.selectedClip, this.#otherSelected(this.selectedClipId)),
	);
	/** The lanes behind the selected clips, each once. */
	selectedLaneIds = $derived.by(() =>
		this.selectedClipId
			? this.timeline.lanes
					.filter((l) =>
						l.clips.some((c) => this.selectedClipIds.includes(c.id)),
					)
					.map((l) => l.id)
			: [],
	);
	selectionNote = $derived.by(() => this.#selectionNote());

	constructor(
		initial: T,
		ops: ChainTimelineOps<T, L, C>,
		host: ChainTimelineHost,
	) {
		this.timeline = initial;
		this.#ops = ops;
		this.#host = host;
		this.moshes = new ClipMoshes<C>({
			clips: (ids) => this.clipsById(ids),
			snapshot: chainClipMoshSnapshot,
			roll: (ids) =>
				host.rollAlive(
					() =>
						(this.timeline = ops.roll(this.timeline, ids, host.moshOptions())),
				),
			restore: (id, snap) =>
				(this.timeline = ops.restoreMosh(this.timeline, id, snap)),
			beforeChange: () => this.pushHistory(),
		});
	}

	#selectedClip(): C | null {
		return this.#ops.findClip(this.timeline, this.selectedClipId);
	}

	#selectedLane(): L | null {
		return this.#ops.findLane(this.timeline, this.selectedClipId);
	}

	#otherSelected(exceptId: string | null): C[] {
		return this.clipsById(new Set(this.selectedClipIds)).filter(
			(c) => c.id !== exceptId,
		);
	}

	#selectionNote(): string | null {
		const count = this.clipsById(new Set(this.selectedClipIds)).length;
		return this.selectedClip && count > 1
			? this.#ops.selectionNote(count)
			: null;
	}

	clipsById(ids: ClipIds): C[] {
		return this.timeline.lanes.flatMap((l) =>
			l.clips.filter((c) => ids.has(c.id)),
		);
	}

	pushHistory = (coalesceKey?: string) => {
		this.history.push($state.snapshot(this.timeline) as T, coalesceKey);
	};

	set = (next: T) => {
		this.timeline = next;
		this.#host.onSet?.();
	};

	/** Drop the mosh stacks of clips that are gone. */
	retainMoshes() {
		this.moshes.retain(
			this.timeline.lanes.flatMap((l) => l.clips.map((c) => c.id)),
		);
	}

	/** Adopt a timeline as the new baseline: no selection, nothing to undo. */
	adopt(timeline: T) {
		this.timeline = timeline;
		this.selectedClipId = null;
		this.history.reset();
	}

	beforeClipEdit = (coalesceKey?: string) => {
		this.#editBase = this.selectedClip
			? ($state.snapshot(this.selectedClip) as C)
			: null;
		this.pushHistory(coalesceKey);
	};

	/** A chain edit also reaches the other selected clips when they run the same
	 * effects; the kind's other fields always do. */
	updateClip = (next: C) => {
		const base = this.#editBase;
		this.#editBase = null;
		const before =
			base?.id === next.id ? base : this.#ops.findClip(this.timeline, next.id);
		const others = $state.snapshot(this.#otherSelected(next.id)) as C[];
		const chained = fanOutEdit(before, next, others);
		const fanned = before
			? (chained.length > 0 ? chained : others).map((c) =>
					this.#ops.fanOutClipFields(before, next, c),
				)
			: chained;
		this.timeline = [next, ...fanned].reduce(
			this.#ops.replaceClip,
			this.timeline,
		);
	};

	/** "All links" reaches every selected clip, whatever effects it runs. */
	setClipsBand = (band: FreqBand) => {
		if (this.selectedClipIds.length < 2) return;
		this.timeline = this.#ops.updateClips(
			this.timeline,
			new Set(this.selectedClipIds),
			(c) => withAllLinkBands(c, band),
		);
	};

	/** A lane edit reaches every lane in the selection. */
	updateLane = (next: L) => {
		const before = this.timeline.lanes.find((l) => l.id === next.id);
		const snapshot = before && ($state.snapshot(before) as L);
		const selected = this.selectedLaneIds;
		this.timeline = {
			...this.timeline,
			lanes: this.timeline.lanes.map((l) => {
				if (l.id === next.id) return next;
				if (!snapshot || !selected.includes(l.id)) return l;
				return this.#ops.fanOutLaneEdit(snapshot, next, l);
			}),
		};
	};

	clear = (clipIds: string[]) => {
		this.pushHistory();
		this.timeline = this.#ops.clear(this.timeline, new Set(clipIds));
	};

	applyPreset = (clipIds: string[], preset: Preset) => {
		this.pushHistory();
		this.timeline = this.#ops.fillFromPreset(
			this.timeline,
			new Set(clipIds),
			preset,
		);
	};

	modeChange = (
		clipIds: string[],
		mode: ChainMode,
		intervalSec?: number,
		intervalBeats?: number | null,
	) => {
		this.pushHistory();
		this.timeline = this.#ops.setMode(
			this.timeline,
			new Set(clipIds),
			mode,
			intervalSec,
			intervalBeats,
		);
	};
}
