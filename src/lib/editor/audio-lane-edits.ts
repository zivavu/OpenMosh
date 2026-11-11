/** Edits to the editor's audio lanes: placing sound, swapping it, mic takes, and
 * moving a video clip's sound onto a lane of its own and back. */

import type { createSpanHistory } from "../audio/span-history.svelte";
import { addTrack } from "../audio/track-library";
import { showToast } from "../components/ui/toast.svelte";
import {
	addClip,
	clipSourceId,
	findMediaClipLane,
	MIN_CLIP_LENGTH,
	updateMediaLane,
	type MediaClip,
	type MediaLane,
	type MediaTimeline,
	type SourceEdit,
} from "../media";
import type { MicTakeResult } from "../mix/mic-recorder.svelte";
import type { SequenceMixer } from "../mix/mixer.svelte";
import type { SourceAudioBank } from "../mix/source-audio.svelte";
import {
	createAudioClip,
	createAudioLane,
	MAX_AUDIO_LANES,
	nextAudioLaneName,
	punchInAudioClip,
	removeAudioSource,
	removeAudioSourceIn,
	setAudioClipSources,
	trackSourceId,
	type AudioLane,
} from "../mix/types";
import type { SnapshotHistory } from "../timeline/snapshot-history.svelte";
import type { ChainTimelineState } from "./chain-timeline-state.svelte";
import { asOneEdit } from "./edit-clock";

export interface AudioLaneEditsHost {
	media: ChainTimelineState<MediaTimeline, MediaLane, MediaClip>;
	mixer: SequenceMixer;
	bank: SourceAudioBank;
	lengthHistory: SnapshotHistory<number>;
	spanHistory: ReturnType<typeof createSpanHistory>;
	selectAudioClip(id: string): void;
	/** A video with sound of its own, which a clip can detach. */
	hasVideoSound(sourceId: string): boolean;
	edits(): Record<string, SourceEdit>;
	videoLengths(): Record<string, number>;
	/** The audio lane last pressed, for a new lane to go under. */
	activeLaneId(): string | null | undefined;
	hasSong(): boolean;
	loadSong(trackId: string): Promise<void>;
}

export function createAudioLaneEdits(host: AudioLaneEditsHost) {
	const { media, mixer } = host;
	const audioLanes = () => media.timeline.audioLanes ?? [];

	function setAudioLanes(lanes: AudioLane[]) {
		media.pushHistory();
		media.set({ ...media.timeline, audioLanes: lanes });
	}

	function placeAudioLane(
		sourceId: string,
		length: number,
		at: number,
		drives: boolean,
		lanes: AudioLane[],
	) {
		media.pushHistory();
		let next = media.timeline;
		const before = mixer.duration;
		if (drives && lanes.length === 0 && length > before) {
			host.lengthHistory.push(before);
			const spanBefore = { start: mixer.spanStart, end: mixer.spanEnd };
			next = {
				...next,
				lanes: next.lanes.map((l) =>
					l.clips.length === 1 &&
					l.clips[0].start === 0 &&
					Math.abs(l.clips[0].end - before) < 1e-6
						? { ...l, clips: [{ ...l.clips[0], end: length }] }
						: l,
				),
			};
			mixer.setDuration(length);
			host.spanHistory.pushMoved(spanBefore);
		}
		const duration = mixer.duration;
		const start = Math.min(at, Math.max(0, duration - MIN_CLIP_LENGTH));
		const lane = createAudioLane(nextAudioLaneName(lanes), drives);
		lane.clips = [
			createAudioClip(start, Math.min(duration, start + length), sourceId),
		];
		media.set({
			...next,
			audioLanes: drives ? [lane, ...lanes] : [...lanes, lane],
		});
		host.selectAudioClip(lane.clips[0].id);
	}

	/** A new lane holding one clip of `sourceId` from `at`. The first music into a
	 * project with no sound yet grows it to fit, and stretches a backdrop that filled it. */
	function placeAudio(
		sourceId: string,
		length: number,
		at: number,
		drives: boolean,
	) {
		const lanes = audioLanes();
		if (lanes.length >= MAX_AUDIO_LANES) {
			showToast(`${MAX_AUDIO_LANES} audio lanes is the limit`, "error");
			return;
		}
		asOneEdit(() => placeAudioLane(sourceId, length, at, drives, lanes));
	}

	/** A library song dropped on the lanes: on clips it swaps their sound, on empty
	 * space it adds a clip there. The first into a project with no song becomes it. */
	async function dropTrack(
		trackId: string,
		target: { clipIds: string[] } | { laneId: string; time: number },
	) {
		const sourceId = trackSourceId(trackId);
		if ("clipIds" in target) {
			const ids = new Set(target.clipIds);
			const changes = audioLanes().some((l) =>
				l.clips.some((c) => ids.has(c.id) && c.sourceId !== sourceId),
			);
			if (!changes) return;
			setAudioLanes(
				setAudioClipSources(audioLanes(), target.clipIds, sourceId),
			);
		} else {
			const length = (await host.bank.load(sourceId))?.duration ?? null;
			if (length === null) {
				showToast("That track has no sound that could be decoded", "error");
				return;
			}
			const lanes = audioLanes();
			const lane = lanes.find((l) => l.id === target.laneId);
			if (!lane) return;
			const clip = createAudioClip(target.time, target.time + length, sourceId);
			const next = addClip(lane, clip, mixer.duration);
			if (next === lane) return;
			setAudioLanes(lanes.map((l) => (l.id === lane.id ? next : l)));
			host.selectAudioClip(clip.id);
		}
		if (!host.hasSong()) await host.loadSong(trackId);
	}

	/** A finished take is stored beside the songs, off the library's list, and covers
	 * what was on its lane from where it began. */
	async function placeMicTake({ laneId, file, start, length }: MicTakeResult) {
		let track;
		try {
			track = await addTrack(file, { take: true });
		} catch (e) {
			console.error("Failed to store take:", e);
			showToast("Couldn't store the take. Storage refused the write.", "error");
			return;
		}
		const sourceId = trackSourceId(track.id);
		await host.bank.load(sourceId);
		const end = Math.min(mixer.duration, start + length);
		if (end - start < MIN_CLIP_LENGTH) return;
		const lane = audioLanes().find((l) => l.id === laneId);
		if (!lane) {
			placeAudio(sourceId, length, start, false);
			return;
		}
		const clip = createAudioClip(start, end, sourceId);
		setAudioLanes(
			audioLanes().map((l) =>
				l.id === laneId
					? punchInAudioClip(l, clip, host.edits(), host.videoLengths())
					: l,
			),
		);
		host.selectAudioClip(clip.id);
		showToast(`Take on ${lane.name}`, "info");
	}

	/** A lane with no sound yet, for clips pasted or dragged in from another. Goes
	 * under the audio lane last pressed, or last. */
	function addEmptyAudioLane() {
		const lanes = audioLanes();
		if (lanes.length >= MAX_AUDIO_LANES) return;
		const active = lanes.findIndex((l) => l.id === host.activeLaneId());
		const at = active === -1 ? lanes.length : active + 1;
		setAudioLanes([
			...lanes.slice(0, at),
			createAudioLane(nextAudioLaneName(lanes)),
			...lanes.slice(at),
		]);
	}

	function removeAudioClipsOf(sourceId: string) {
		const lanes = audioLanes();
		if (!lanes.some((l) => l.clips.some((c) => c.sourceId === sourceId)))
			return;
		setAudioLanes(removeAudioSource(lanes, sourceId));
	}

	/** Detach each video clip's sound onto an audio lane of its own. */
	function detachClipsAudio(clipIds: string[]) {
		let timeline = media.timeline;
		let lanes = audioLanes();
		for (const clipId of clipIds) {
			const lane = findMediaClipLane(timeline, clipId);
			const clip = lane?.clips.find((c) => c.id === clipId);
			const sourceId = lane && clip ? clipSourceId(lane, clip) : null;
			if (!lane || !clip || !sourceId || clip.audioDetached) continue;
			if (!host.hasVideoSound(sourceId)) continue;
			// The first free-standing lane with room takes it; otherwise a new one does.
			const fits = (l: AudioLane) =>
				l.clips.every((c) => c.end <= clip.start || c.start >= clip.end);
			const target = lanes.find((l) => !l.drives && fits(l));
			if (!target && lanes.length >= MAX_AUDIO_LANES) {
				showToast(`${MAX_AUDIO_LANES} audio lanes is the limit`, "error");
				break;
			}
			const detached = {
				...createAudioClip(clip.start, clip.end, sourceId, clip.sourceStart),
				gain: clip.gain,
				fadeInSec: clip.fadeInSec,
				fadeOutSec: clip.fadeOutSec,
				bounce: clip.bounce,
				bounceBack: clip.bounceBack,
			};
			lanes = target
				? lanes.map((l) =>
						l.id === target.id
							? {
									...l,
									clips: [...l.clips, detached].sort(
										(a, b) => a.start - b.start,
									),
								}
							: l,
					)
				: [
						...lanes,
						{ ...createAudioLane(nextAudioLaneName(lanes)), clips: [detached] },
					];
			timeline = updateMediaLane(timeline, lane.id, (l) => ({
				...l,
				clips: l.clips.map((c) =>
					c.id === clipId ? { ...c, audioDetached: true } : c,
				),
			}));
		}
		if (timeline === media.timeline) return;
		media.pushHistory();
		media.set({ ...timeline, audioLanes: lanes });
	}

	/** Give video clips their sound back: the audio clips playing it under each go. */
	function reattachClipsAudio(clipIds: string[]) {
		let timeline = media.timeline;
		let lanes = audioLanes();
		for (const clipId of clipIds) {
			const lane = findMediaClipLane(timeline, clipId);
			const clip = lane?.clips.find((c) => c.id === clipId);
			const sourceId = lane && clip ? clipSourceId(lane, clip) : null;
			if (!lane || !clip?.audioDetached || !sourceId) continue;
			lanes = removeAudioSourceIn(lanes, sourceId, clip.start, clip.end);
			timeline = updateMediaLane(timeline, lane.id, (l) => ({
				...l,
				clips: l.clips.map((c) =>
					c.id === clipId ? { ...c, audioDetached: undefined } : c,
				),
			}));
		}
		if (timeline === media.timeline) return;
		media.pushHistory();
		media.set({ ...timeline, audioLanes: lanes });
	}

	return {
		placeAudio,
		dropTrack,
		placeMicTake,
		addEmptyAudioLane,
		removeAudioClipsOf,
		detachClipsAudio,
		reattachClipsAudio,
	};
}
