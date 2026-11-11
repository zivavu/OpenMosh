/** The editor's FX lanes: the lanes, their selection, undo stack and clip moshes. */

import { createSnapshotHistory } from "../timeline/snapshot-history.svelte";
import { fanOutNote } from "./chain-fanout";
import type { ChainMode } from "./sequence";
import { ClipMoshes } from "./clip-moshes.svelte";
import {
	appendFxLane,
	clearFxClips,
	createFxLayerSource,
	findFxClip,
	fxClipMoshSnapshot,
	restoreFxClipMosh,
	rollFxClips,
	setFxClipsMode,
	type FxClip,
	type FxLane,
	type FxLaneSettings,
} from "./fx-lanes";
import type { MoshOptions } from "./mosh";

export interface FxLaneStateHost {
	/** Editor mode; single mode has no FX lanes. */
	active(): boolean;
	moshOptions(): MoshOptions;
	/** What a new lane starts from: the editor's current settings. */
	newLaneSettings(): FxLaneSettings;
	duration(): number;
	newLaneZ(): number;
	/** Runs a roll, re-rolling while it leaves the frame dead. */
	rollAlive(roll: () => void): void;
}

export class FxLaneState {
	readonly #host: FxLaneStateHost;

	lanes = $state<FxLane[]>([]);
	selectedClipId = $state<string | null>(null);
	selectedClipIds = $state<string[]>([]);
	/** The lane the settings panel was aimed at by name. */
	selectedLaneId = $state<string | null>(null);

	/** Ctrl+Z reaches it when it holds the newest edit. */
	readonly history = createSnapshotHistory<FxLane[]>();
	readonly moshes: ClipMoshes<FxClip>;
	/** Same resolver the export builds, so interval rolls reproduce exactly. */
	readonly previewSource: ReturnType<typeof createFxLayerSource>;

	/** The fx clip the effects panel is editing, if one is selected. */
	selectedClip = $derived.by(() => this.#selectedClip());
	chainNote = $derived(
		fanOutNote(
			this.selectedClip,
			this.clipsById(new Set(this.selectedClipIds)).filter(
				(c) => c.id !== this.selectedClipId,
			),
		),
	);

	constructor(host: FxLaneStateHost) {
		this.#host = host;
		this.moshes = new ClipMoshes<FxClip>({
			clips: (ids) => this.clipsById(ids),
			snapshot: fxClipMoshSnapshot,
			roll: (ids) =>
				host.rollAlive(
					() => (this.lanes = rollFxClips(this.lanes, ids, host.moshOptions())),
				),
			restore: (id, snap) =>
				(this.lanes = restoreFxClipMosh(this.lanes, id, snap)),
			beforeChange: () => this.pushHistory(),
		});
		this.previewSource = createFxLayerSource(
			() => this.lanes,
			host.moshOptions,
		);
	}

	#selectedClip(): FxClip | null {
		if (!this.#host.active()) return null;
		return findFxClip(this.lanes, this.selectedClipId)?.clip ?? null;
	}

	pushHistory = (coalesceKey?: string) => {
		this.history.push($state.snapshot(this.lanes) as FxLane[], coalesceKey);
	};

	set = (next: FxLane[]) => {
		this.lanes = next;
		this.moshes.retain(next.flatMap((l) => l.clips.map((c) => c.id)));
	};

	/** Adopt saved lanes, or clear back to none when a song has none. */
	restore(lanes: FxLane[]) {
		this.lanes = lanes;
		this.selectedClipId = null;
		this.selectedClipIds = [];
		this.selectedLaneId = null;
		this.history.reset();
	}

	add = () => {
		// Full timeline width, so a new lane arrives with one clean clip to work on.
		const next = appendFxLane(
			this.lanes,
			this.#host.newLaneSettings(),
			this.#host.duration(),
			this.#host.newLaneZ(),
		);
		// At the cap this is a no-op; recording it would leave a Ctrl+Z that undoes nothing.
		if (next === this.lanes) return;
		this.pushHistory();
		this.lanes = next;
	};

	modeChange = (
		clipIds: string[],
		mode: ChainMode,
		intervalSec?: number,
		intervalBeats?: number | null,
	) => {
		this.pushHistory();
		this.lanes = setFxClipsMode(
			this.lanes,
			new Set(clipIds),
			mode,
			intervalSec,
			intervalBeats,
		);
	};

	clipsById(ids: Set<string>): FxClip[] {
		return this.lanes.flatMap((l) => l.clips.filter((c) => ids.has(c.id)));
	}

	clear = (clipIds: string[]) => {
		this.pushHistory();
		this.lanes = clearFxClips(this.lanes, new Set(clipIds));
	};
}
