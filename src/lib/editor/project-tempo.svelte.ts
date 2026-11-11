/** The editor project's tempo: its BPM and first beat, what they're measured from, and
 * the undo stack for a BPM set by hand. Correcting the BPM retimes every clip whose
 * spacing was set in beats. Detection runs an effect, so construct during component init. */

import type { MediaClip, MediaLane, MediaTimeline } from "../media";
import { applyBpmToMediaClips } from "../media";
import type { TextClip, TextLane, TextTimeline } from "../text";
import { applyBpmToTextClips } from "../text";
import { createSnapshotHistory } from "../timeline/snapshot-history.svelte";
import { BpmDetection } from "./bpm-detection.svelte";
import type { ChainTimelineState } from "./chain-timeline-state.svelte";
import { asOneEdit } from "./edit-clock";
import type { FxLaneState } from "./fx-lane-state.svelte";
import { applyBpmToFxLanes } from "./fx-lanes";

export interface ProjectTempoHost {
	/** The song, which the tempo is measured from unless a pool source is picked. */
	song(): File | null;
	decode(sourceId: string): Promise<AudioBuffer | null>;
	media(): ChainTimelineState<MediaTimeline, MediaLane, MediaClip>;
	text(): ChainTimelineState<TextTimeline, TextLane, TextClip>;
	fx(): FxLaneState;
}

export class ProjectTempo {
	readonly #host: ProjectTempoHost;

	/** Beats per minute; 0 is not measured yet. */
	bpm = $state(0);
	/** Seconds into the song of its first beat, as detection found it. */
	beatOffset = $state(0);
	/** A video's sound the tempo is measured from instead of the song. */
	poolSource = $state<string | null>(null);
	/** BPM set by hand, beside the beat-spaced clips it retimes. */
	readonly history = createSnapshotHistory<number>();
	readonly detection: BpmDetection;

	constructor(host: ProjectTempoHost) {
		this.#host = host;
		this.detection = new BpmDetection({
			source: () => this.poolSource ?? host.song(),
			decode: (id) => host.decode(id),
			bpm: () => this.bpm,
			onDetected: (bpm, beatOffset) => this.setDetected(bpm, beatOffset),
		});
	}

	/** Forget the tempo, so the next source is measured rather than keeping this one's. */
	forget() {
		this.bpm = 0;
		this.beatOffset = 0;
	}

	/** A restored BPM wins over any detection in flight: the clips were built against it. */
	restore(bpm: number, beatOffset = 0) {
		if (bpm > 0) this.detection.settle();
		this.bpm = bpm;
		this.beatOffset = beatOffset;
	}

	/** A detection over a BPM that was already set is undoable, like typing one in; the
	 * first one a fresh song gets isn't an edit. */
	setDetected(bpm: number, beatOffset: number) {
		this.beatOffset = beatOffset;
		if (this.bpm > 0 && bpm !== this.bpm) this.setByHand(bpm);
		else this.set(bpm);
	}

	set = (bpm: number) => {
		this.detection.settle();
		this.bpm = bpm;
		asOneEdit(() => this.#retime(bpm));
	};

	setByHand = (bpm: number) => {
		if (bpm === this.bpm) return;
		asOneEdit(() => {
			this.history.push(this.bpm);
			this.set(bpm);
		});
	};

	#retime(bpm: number) {
		const fx = this.#host.fx();
		const media = this.#host.media();
		const text = this.#host.text();
		const retimedFx = applyBpmToFxLanes(fx.lanes, bpm);
		if (retimedFx !== fx.lanes) {
			fx.pushHistory();
			fx.lanes = retimedFx;
		}
		const retimedMedia = applyBpmToMediaClips(media.timeline, bpm);
		if (retimedMedia !== media.timeline) {
			media.pushHistory();
			media.timeline = retimedMedia;
		}
		const retimedText = applyBpmToTextClips(text.timeline, bpm);
		if (retimedText !== text.timeline) {
			text.pushHistory();
			text.timeline = retimedText;
		}
	}
}
