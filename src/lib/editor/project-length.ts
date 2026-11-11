/** The editor project's length: set by hand, grown by a drag past either end. Each
 * change shares an undo step with the clips it trims or shifts. */

import type { createSpanHistory } from "../audio/span-history.svelte";
import type { MediaClip, MediaLane, MediaTimeline } from "../media";
import type { SequenceMixer } from "../mix/mixer.svelte";
import type { TextClip, TextLane, TextTimeline } from "../text";
import {
	trimClipsAt,
	type ClipLane,
	type TimelineClip,
} from "../timeline/clips";
import type { SnapshotHistory } from "../timeline/snapshot-history.svelte";
import type { ChainTimelineState } from "./chain-timeline-state.svelte";
import { asOneEdit, sharedEditSeq } from "./edit-clock";
import type { FxLaneState } from "./fx-lane-state.svelte";

type Span = { start: number; end: number };

export interface ProjectLengthHost {
	media: ChainTimelineState<MediaTimeline, MediaLane, MediaClip>;
	text: ChainTimelineState<TextTimeline, TextLane, TextClip>;
	fx: FxLaneState;
	mixer: SequenceMixer;
	lengthHistory: SnapshotHistory<number>;
	spanHistory: ReturnType<typeof createSpanHistory>;
	pause(): void;
	repeatSpan(): Span | null;
	setRepeatSpan(span: Span): void;
}

const shifted = <C extends TimelineClip, L extends ClipLane<C>>(
	lanes: L[],
	by: number,
): L[] =>
	lanes.map((l) => ({
		...l,
		clips: l.clips.map((c) => ({ ...c, start: c.start + by, end: c.end + by })),
	}));

export function createProjectLength(host: ProjectLengthHost) {
	const { media, text, fx, mixer, lengthHistory } = host;

	function setDurationKeepingSpan(length: number) {
		const spanBefore = { start: mixer.spanStart, end: mixer.spanEnd };
		mixer.setDuration(length);
		host.spanHistory.pushMoved(spanBefore);
	}

	return {
		/** Set by hand. Shorter cuts clips straddling the new end back to it, so their
		 * edge stays in reach; clips wholly past it are kept. One undo step with the clips
		 * it trims, joining Fit's when called under it. */
		setProjectLength(length: number) {
			host.pause();
			const next = Math.max(1, length);
			if (next === mixer.duration) return;
			asOneEdit(() => {
				const seq = sharedEditSeq();
				if (lengthHistory.undoSeq !== seq) lengthHistory.push(mixer.duration);
				if (next < mixer.duration) {
					const trim = <L extends ClipLane<TimelineClip>>(lanes: L[]) =>
						lanes.map((l) => trimClipsAt<TimelineClip, L>(l, next));
					const mediaLanes = trim(media.timeline.lanes);
					const audioLanes = trim(media.timeline.audioLanes ?? []);
					if (
						mediaLanes.some((l, i) => l !== media.timeline.lanes[i]) ||
						audioLanes.some((l, i) => l !== media.timeline.audioLanes?.[i])
					) {
						if (media.history.undoSeq !== seq) media.pushHistory();
						media.set({ ...media.timeline, lanes: mediaLanes, audioLanes });
					}
					const textLanes = trim(text.timeline.lanes);
					if (textLanes.some((l, i) => l !== text.timeline.lanes[i])) {
						if (text.history.undoSeq !== seq) text.pushHistory();
						text.set({ ...text.timeline, lanes: textLanes });
					}
					const fxLanes = trim(fx.lanes);
					if (fxLanes.some((l, i) => l !== fx.lanes[i])) {
						if (fx.history.undoSeq !== seq) fx.pushHistory();
						fx.set(fxLanes);
					}
				}
				// Shortening clamps the span; its undo puts the span back as it was set.
				setDurationKeepingSpan(next);
			});
		},

		/** A drag reaching past the end: joins the drag's undo entry, so Ctrl+Z gives the
		 * length back. */
		growProjectTo(length: number) {
			const seq = sharedEditSeq();
			if (lengthHistory.undoSeq !== seq) {
				lengthHistory.push(mixer.duration, seq === null ? "grow" : undefined);
			}
			setDurationKeepingSpan(length);
		},

		/** `by` seconds go in before everything (negative takes them back out), and the
		 * playhead and playback span keep their place against it. Joins the undo entry
		 * it's called under: a drag's (see growFrontTo) or Fit's. */
		growProjectFront(by: number) {
			const seq = sharedEditSeq();
			if (media.history.undoSeq !== seq) media.pushHistory();
			if (text.history.undoSeq !== seq) text.pushHistory();
			if (fx.history.undoSeq !== seq) fx.pushHistory();
			if (lengthHistory.undoSeq !== seq) lengthHistory.push(mixer.duration);
			host.pause();
			media.set({
				...media.timeline,
				lanes: shifted(media.timeline.lanes, by),
				audioLanes: shifted(media.timeline.audioLanes ?? [], by),
			});
			text.set({ ...text.timeline, lanes: shifted(text.timeline.lanes, by) });
			fx.set(shifted(fx.lanes, by));
			const whole =
				mixer.spanStart <= 1e-6 && mixer.spanEnd >= mixer.duration - 1e-6;
			const span = { start: mixer.spanStart, end: mixer.spanEnd };
			const playhead = mixer.currentTime;
			mixer.setDuration(mixer.duration + by);
			const at = (t: number) => Math.min(mixer.duration, Math.max(0, t + by));
			mixer.spanStart = whole ? 0 : at(span.start);
			mixer.spanEnd = whole ? mixer.duration : at(span.end);
			host.spanHistory.pushMoved(span);
			const repeat = host.repeatSpan();
			if (repeat) {
				host.setRepeatSpan({ start: at(repeat.start), end: at(repeat.end) });
			}
			mixer.seek(at(playhead));
		},
	};
}
