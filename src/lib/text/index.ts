import { ensureFontLoaded } from "../text-overlay";
import { textTimelineFonts } from "./resolve";
import type { TextTimeline } from "./types";

export { createTextHistory } from "./history.svelte";
export {
   applyLyricsToTimeline,
   createLyricsClips,
   LYRICS_LANE_NAME,
   LYRICS_STYLE,
   lyricsLane,
} from "./lyrics";
export { drawTextToCanvas, textSignature } from "./render-text-clip";
export type { ResolvedTextLayer } from "./resolve";
export {
   addClip,
   allTextEffectIds,
   clipAt,
   freeRangeAt,
   moveClip,
   removeClip,
   resizeClip,
   resolveTextLayersAt,
   snapTime,
   sortClips,
   textTimelineFonts,
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
   createTextClip,
   createTextLane,
   createTextTimeline,
   DEFAULT_TEXT_STYLE,
   EMPTY_TEXT_TIMELINE,
   MIN_CLIP_LENGTH,
   normalizeTextTimeline,
} from "./types";

/** Load every font the timeline needs, so an export doesn't start on a fallback face. */
export async function preloadTextTimelineFonts(
   timeline: TextTimeline | null | undefined,
): Promise<void> {
   await Promise.all(textTimelineFonts(timeline).map((f) => ensureFontLoaded(f)));
}
