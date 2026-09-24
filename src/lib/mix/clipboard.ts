/** Copy/paste for audio clips: a paste stamps the copied sound down as new clips,
 * on the lane last clicked when that is an audio lane. */

import { copyClipBlock, pasteClipBlock } from "../timeline/clip-clipboard";
import type { ClipBlockEntry } from "../timeline/clips";
import { createAudioClip, type AudioClip, type AudioLane } from "./types";

export type AudioClipboardEntry = ClipBlockEntry &
	Omit<AudioClip, "id" | "start" | "end">;

export function copyAudioClips(
	lanes: AudioLane[],
	clipIds: string[],
): AudioClipboardEntry[] {
	return copyClipBlock<AudioClip, AudioLane, AudioClipboardEntry>(
		lanes,
		clipIds,
		({ id: _id, start: _start, end: _end, ...rest }) => rest,
	);
}

export interface AudioPasteResult {
	lanes: AudioLane[];
	/** The clips that landed, for the caller to select. Empty on a no-op. */
	clipIds: string[];
}

/** Stamp the clipboard down with its earliest clip at `at`; see pasteClipBlock. */
export function pasteAudioClips(
	lanes: AudioLane[],
	entries: AudioClipboardEntry[],
	at: number,
	duration: number,
	targetLaneId?: string | null,
): AudioPasteResult {
	return pasteClipBlock(
		lanes,
		entries,
		at,
		duration,
		targetLaneId,
		({ laneId: _l, offset: _o, length: _len, ...rest }, start, end) => ({
			...rest,
			...createAudioClip(start, end, rest.sourceId, rest.sourceStart),
		}),
	);
}
