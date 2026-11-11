import {
	appendMediaLane,
	updateMediaLane,
	type MediaClip,
	type MediaTimeline,
} from "../media";
import {
	createAudioClip,
	createAudioLane,
	nextAudioLaneName,
} from "../mix/types";

export interface ProjectLaneSong {
	sourceId: string;
	/** Seconds into the song the clip starts at. */
	sourceStart: number;
	/** The project's song: its lane goes first and drives. */
	asSong: boolean;
}

/** A saved project added as one clip on a lane of its own on top, with its song on a
 * new audio lane under the same span. */
export function addProjectLane(
	timeline: MediaTimeline,
	opts: {
		sourceId: string;
		name: string;
		clip: MediaClip;
		z: number;
		song?: ProjectLaneSong | null;
	},
): { timeline: MediaTimeline; laneId: string } {
	let next = appendMediaLane(timeline, opts.sourceId, opts.z);
	const laneId = next.lanes[next.lanes.length - 1]!.id;
	next = updateMediaLane(next, laneId, (l) => ({
		...l,
		name: opts.name,
		clips: [opts.clip],
	}));
	const song = opts.song;
	if (song) {
		const audioLanes = timeline.audioLanes ?? [];
		const lane = createAudioLane(nextAudioLaneName(audioLanes), song.asSong);
		lane.clips = [
			createAudioClip(
				opts.clip.start,
				opts.clip.end,
				song.sourceId,
				song.sourceStart,
			),
		];
		next = {
			...next,
			audioLanes: song.asSong ? [lane, ...audioLanes] : [...audioLanes, lane],
		};
	}
	return { timeline: next, laneId };
}
