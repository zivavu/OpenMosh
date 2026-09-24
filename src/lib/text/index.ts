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
	lyricsDraftFromTimeline,
} from "./lyrics";
export { drawTextToCanvas, textSignature } from "./render-text-clip";
export type { ResolvedTextLayer, TextChainSource } from "./resolve";
export {
	findTextClip,
	findTextClipLane,
	createTextChainSource,
	replaceTextClip,
	resolveTextLayersAt,
	toggledTextTimeline,
	updateLane,
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
	DEFAULT_TEXT_STYLE,
	EMPTY_TEXT_TIMELINE,
	fitTextTimeline,
	MIN_CLIP_LENGTH,
	normalizeTextTimeline,
	splitTextClipAt,
	textClipPosition,
} from "./types";

/** Load every font the timeline needs, so an export doesn't start on a fallback face. */
export async function preloadTextTimelineFonts(
	timeline: TextTimeline | null | undefined,
): Promise<void> {
	await Promise.all(
		textTimelineFonts(timeline).map((f) => ensureFontLoaded(f)),
	);
}
