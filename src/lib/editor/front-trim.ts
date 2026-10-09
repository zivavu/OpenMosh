/** Moving the project's start: dragging the song's opening edge adds time before
 * everything or cuts it off the front, and every lane shifts with the music. */

import type { FxLane } from "./fx-lanes";
import {
	mediaClipSpeed,
	type MediaClip,
	type MediaLane,
	type MediaTimeline,
} from "../media/types";
import { sourceTimeAt, type SourceEdit } from "../media/source-edit";
import { trackIdOf, type AudioClip } from "../mix/types";
import type { TextTimeline } from "../text/types";
import {
	MIN_CLIP_LENGTH,
	type ClipLane,
	type TimelineClip,
} from "../timeline/clips";

export interface ProjectTimelines {
	media: MediaTimeline;
	text: TextTimeline;
	fx: FxLane[];
	length: number;
}

/** A library song opening the project: the clip whose start edge moves the project's. */
export function opensProject(clip: AudioClip): boolean {
	return clip.start <= 1e-6 && !!clip.sourceId && !!trackIdOf(clip.sourceId);
}

/**
 * The project with its start moved by `cut` seconds: negative adds time before
 * everything, positive cuts it off. The song `songId` keeps opening the project,
 * reaching back into its own intro and then leaving silence before it. Clips the
 * cut reaches lose their front, the rest of their media in step with the music.
 */
export function moveProjectStart(
	base: ProjectTimelines,
	songId: string,
	cut: number,
	maxLength: number,
	edits?: Record<string, SourceEdit>,
): ProjectTimelines & { cut: number } {
	const song = (base.media.audioLanes ?? [])
		.flatMap((l) => l.clips)
		.find((c) => c.id === songId);
	if (!song) return { ...base, cut: 0 };
	const step = Math.min(
		Math.max(cut, base.length - maxLength),
		song.end - MIN_CLIP_LENGTH,
		base.length - 1,
	);
	if (step === 0) return { ...base, cut: 0 };

	const shift = <C extends TimelineClip, L extends ClipLane<C>>(
		lane: L,
		advance: (clip: C, by: number) => C = (c) => c,
	): L => ({
		...lane,
		clips: lane.clips.flatMap((c) => {
			if (c.end <= step) return [];
			const cutIn = Math.max(0, step - c.start);
			const kept = cutIn > 0 ? advance({ ...c, start: step }, cutIn) : c;
			return [{ ...kept, start: kept.start - step, end: kept.end - step }];
		}),
	});

	const audioLanes = (base.media.audioLanes ?? []).map((lane) => ({
		...lane,
		clips: lane.clips.flatMap((c) => {
			if (c.id !== songId)
				return shift({ ...lane, clips: [c] }, advanceAudio).clips;
			// Its intro first; past that, silence goes in before it.
			const opens = Math.max(step, -c.sourceStart);
			return [
				{
					...c,
					start: opens - step,
					end: c.end - step,
					sourceStart: c.sourceStart + opens,
				},
			];
		}),
	}));

	function advanceAudio(c: AudioClip, by: number): AudioClip {
		const edit = c.sourceId ? edits?.[c.sourceId] : undefined;
		return {
			...c,
			sourceStart: sourceTimeAt(edit, by, c.sourceStart),
			fadeInSec: undefined,
		};
	}

	return {
		media: {
			...base.media,
			audioLanes,
			lanes: base.media.lanes.map((lane) =>
				shift<MediaClip, MediaLane>(lane, (c, by) => ({
					...c,
					sourceStart: sourceTimeAt(
						edits?.[c.sourceId ?? lane.sourceId ?? ""],
						by * mediaClipSpeed(c),
						c.sourceStart,
					),
					fadeInSec: undefined,
					transition: undefined,
				})),
			),
		},
		text: {
			...base.text,
			lanes: base.text.lanes.map((lane) => shift(lane)),
		},
		fx: base.fx.map((lane) => shift(lane)),
		length: base.length - step,
		cut: step,
	};
}
