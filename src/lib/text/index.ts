import { ensureFontLoaded } from "../text-overlay";
import { textTimelineFonts } from "./resolve";
import type { TextTimeline } from "./types";

export { createTextHistory } from "./history.svelte";
export {
	applyBpmToTextClips,
	clearTextClips,
	fillTextClipsFromPreset,
	restoreTextClipMosh,
	rollTextClips,
	setTextClipsMode,
	syncTextClipsToPreset,
} from "./chain";
export {
	copyTextClips,
	pasteTextClips,
	pasteTextOnto,
	type TextClipboardEntry,
} from "./clipboard";
export {
	applyLyricsToTimeline,
	createLyricsClips,
	LYRICS_LANE_NAME,
	LYRICS_STYLE,
	lyricsDraftFromTimeline,
	lyricsLane,
} from "./lyrics";
export { drawTextToCanvas, textSignature } from "./render-text-clip";
export type { ResolvedTextLayer, TextChainSource } from "./resolve";
export {
	addClip,
	allTextEffectIds,
	findTextClip,
	findTextClipLane,
	clipAt,
	clipRange,
	createTextChainSource,
	freeRangeAt,
	moveClip,
	moveClips,
	moveClipsToLane,
	removeClip,
	replaceTextClip,
	resizeBoundary,
	resizeClip,
	resolveTextLayersAt,
	sortClips,
	textTimelineFonts,
	toggledTextTimeline,
	updateLane,
	updateTextClips,
} from "./resolve";
export type {
	TextAlign,
	TextClip,
	TextLane,
	TextStyle,
	TextTimeline,
} from "./types";
export {
	appendTextLane,
	createTextClip,
	createTextLane,
	createTextTimeline,
	DEFAULT_TEXT_STYLE,
	EMPTY_TEXT_TIMELINE,
	fitTextTimeline,
	MIN_CLIP_LENGTH,
	normalizeTextTimeline,
	splitTextClipAt,
	TEXT_Z_BASE,
	textClipWeight,
} from "./types";

/** Load every font the timeline needs, so an export doesn't start on a fallback face. */
export async function preloadTextTimelineFonts(
	timeline: TextTimeline | null | undefined,
): Promise<void> {
	await Promise.all(
		textTimelineFonts(timeline).map((f) => ensureFontLoaded(f)),
	);
}
