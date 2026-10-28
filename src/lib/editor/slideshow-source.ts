/** A saved slideshow brought into the editor as a pool source: its slides join the
 * pool, hidden, and a cut list plays them. */

import { getDecodedAudioBuffer } from "../audio/audio-buffer-cache";
import { cutListFile, type CutList } from "../media/cut-list";
import { mediaTimelineSourceIds, type MediaTimeline } from "../media";
import { freezeSlideshow } from "../slideshow/cut-list";
import {
	DEFAULT_SLIDESHOW_CONFIG,
	type SlideshowConfig,
	type TimelineSegment,
} from "../slideshow/types";
import { loadRenderSettings } from "./render-settings";
import { stableSourceId } from "./sequence-media-store";
import { openSession } from "./sessions";

/** A slideshow with no song and no export length of its own runs this long. */
const SONGLESS_SECONDS = 30;

export interface FrozenSlideshow {
	slides: File[];
	cutFile: File;
	cutList: CutList;
	/** The song it was cut to, which the editor lays on an audio lane. */
	trackId: string | null;
	/** "consistent" never rolls, so its clip starts static. */
	rolls: boolean;
}

/** Null when the slideshow, or every one of its slides, is gone. */
export async function freezeSavedSlideshow(
	sessionKey: string,
	name: string,
): Promise<FrozenSlideshow | null> {
	const opened = await openSession(sessionKey);
	if (!opened) return null;
	const config = savedConfig(opened.state);
	const span = config.span ?? (await fullSpan(opened.trackFile, sessionKey));
	const cutList = freezeSlideshow({
		config,
		name,
		sessionKey,
		slideIds: opened.files.map(stableSourceId),
		span,
	});
	if (cutList.cuts.length === 0) return null;
	return {
		slides: opened.files,
		cutFile: cutListFile(cutList),
		cutList,
		trackId: opened.trackId,
		rolls: config.moshMode !== "consistent",
	};
}

function savedConfig(state: unknown): SlideshowConfig {
	const raw =
		((state as { config?: unknown } | null)
			?.config as Partial<SlideshowConfig> | null) ?? {};
	const number = (v: unknown, fallback: number) =>
		typeof v === "number" && Number.isFinite(v) ? v : fallback;
	const span = raw.span;
	return {
		...DEFAULT_SLIDESHOW_CONFIG,
		bpm: number(raw.bpm, DEFAULT_SLIDESHOW_CONFIG.bpm),
		beatOffset: number(raw.beatOffset, 0),
		subdivision: raw.subdivision ?? DEFAULT_SLIDESHOW_CONFIG.subdivision,
		moshMode: raw.moshMode ?? DEFAULT_SLIDESHOW_CONFIG.moshMode,
		segments: Array.isArray(raw.segments) ? raw.segments.filter(isSegment) : [],
		span:
			span && span.end > span.start
				? { start: Math.max(0, span.start), end: span.end }
				: undefined,
	};
}

function isSegment(seg: TimelineSegment): boolean {
	return (
		!!seg &&
		Number.isFinite(seg.startTime) &&
		typeof seg.subdivision === "number"
	);
}

/** The whole song, or a songless slideshow's export length. */
async function fullSpan(
	song: File | null,
	sessionKey: string,
): Promise<{ start: number; end: number }> {
	if (song) {
		const buffer = await getDecodedAudioBuffer(song).catch(() => null);
		if (buffer) return { start: 0, end: buffer.duration };
	}
	const duration = loadRenderSettings(sessionKey)?.duration;
	return {
		start: 0,
		end: duration && duration > 0 ? duration : SONGLESS_SECONDS,
	};
}

interface PoolSource {
	id: string;
	cutList?: CutList;
}

/** Slides no clip shows directly: the pool lists their slideshow in their place. */
export function hiddenSlides(
	sources: PoolSource[],
	timeline: MediaTimeline | null | undefined,
): Set<string> {
	const hidden = new Set<string>();
	if (!sources.some((s) => s.cutList)) return hidden;
	const used = new Set(mediaTimelineSourceIds(timeline));
	for (const s of sources) {
		for (const id of s.cutList?.slides ?? []) {
			if (!used.has(id)) hidden.add(id);
		}
	}
	return hidden;
}

/** The slides that go with a slideshow taken out of the pool: those no other one
 * plays and no clip shows. */
export function slidesLeftBehind(
	sources: PoolSource[],
	cutsId: string,
	timeline: MediaTimeline | null | undefined,
): string[] {
	const gone = sources.find((s) => s.id === cutsId)?.cutList;
	if (!gone) return [];
	const shown = new Set(mediaTimelineSourceIds(timeline));
	const playedElsewhere = new Set(
		sources.flatMap((s) => (s.id === cutsId ? [] : (s.cutList?.slides ?? []))),
	);
	return [...new Set(gone.slides)].filter(
		(id) => !shown.has(id) && !playedElsewhere.has(id),
	);
}
