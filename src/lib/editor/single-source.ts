/** A saved single edit brought into the editor: its file joins the pool and one clip
 * carries its chain, linked back so it can update from the edit. */

import { getDecodedAudioBuffer } from "../audio/audio-buffer-cache";
import { restoreEffects, type EffectInstance } from "../effects";
import type { MediaTimeline } from "../media";
import { normalizeSourceEdits, type SourceEdit } from "../media/source-edit";
import { cloneChainEffects, type ChainClip } from "./chain-clip";
import { handBuiltLabel, keepLockedInPreset } from "./sequence";
import {
	getSession,
	getTimeline,
	sessionTimelineKeys,
	stableSourceId,
} from "./sequence-media-store";
import { openSession, type SingleSessionState } from "./sessions";

export interface SavedSingle {
	file: File;
	effects: EffectInstance[];
	/** Its crop, key and erase, when it has any. */
	sourceEdit: SourceEdit | null;
	trackId: string | null;
	/** The part of the song it plays, when it has a song. */
	songSpan: { start: number; end: number } | null;
}

/** Null when the edit, or its file, is gone. */
export async function openSavedSingle(
	sessionKey: string,
): Promise<SavedSingle | null> {
	const [opened, session] = await Promise.all([
		openSession(sessionKey),
		getSession(sessionKey),
	]);
	if (!opened || !session || session.mode !== "single") return null;
	const file = opened.files[0];
	const state = opened.state as Partial<SingleSessionState> | null;
	return {
		file,
		effects: restoreEffects(state?.effects ?? []),
		sourceEdit: await savedSourceEdit(session, stableSourceId(file)),
		trackId: opened.trackId,
		songSpan: opened.trackFile
			? await songSpan(opened.trackFile, state?.span)
			: null,
	};
}

async function savedSourceEdit(
	session: Parameters<typeof sessionTimelineKeys>[0],
	sourceId: string,
): Promise<SourceEdit | null> {
	const key = sessionTimelineKeys(session)[0];
	if (!key) return null;
	const entry = (await getTimeline(key).catch(() => null)) as {
		sourceEdits?: unknown;
	} | null;
	return normalizeSourceEdits(entry?.sourceEdits)[sourceId] ?? null;
}

async function songSpan(
	song: File,
	span: { start: number; end: number } | undefined,
): Promise<{ start: number; end: number } | null> {
	if (span && Number.isFinite(span.start) && span.end > span.start) {
		return { start: Math.max(0, span.start), end: span.end };
	}
	const buffer = await getDecodedAudioBuffer(song).catch(() => null);
	return buffer ? { start: 0, end: buffer.duration } : null;
}

/** The clip with the edit's chain in place of its own; what the user locked stays. */
export function withSingleChain<C extends ChainClip>(
	clip: C,
	effects: EffectInstance[],
): C {
	const next = keepLockedInPreset(cloneChainEffects(effects), clip.effects);
	return {
		...clip,
		mode: "static",
		effects: next,
		label: handBuiltLabel(next),
		presetName: undefined,
		modified: false,
	};
}

/** The clips added from this single edit. */
export function singleClipIds(
	timeline: MediaTimeline,
	sessionKey: string,
): string[] {
	return timeline.lanes.flatMap((lane) =>
		lane.clips
			.filter((clip) => clip.single?.sessionKey === sessionKey)
			.map((clip) => clip.id),
	);
}
