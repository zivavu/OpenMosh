import { ensureFontLoaded } from "../text-overlay";
import { textTimelineFonts } from "./resolve";
import type { TextTimeline } from "./types";

export {
  DEFAULT_TEXT_STYLE,
  EMPTY_TEXT_TIMELINE,
  MIN_CLIP_LENGTH,
  createTextClip,
  createTextLane,
  createTextTimeline,
  normalizeTextTimeline,
} from "./types";
export type {
  TextAlign,
  TextClip,
  TextLane,
  TextStyle,
  TextTimeline,
} from "./types";

export {
  addClip,
  allTextEffectIds,
  clipAt,
  freeRangeAt,
  moveClip,
  removeClip,
  resolveTextLayersAt,
  resizeClip,
  snapTime,
  sortClips,
  textTimelineFonts,
  updateLane,
} from "./resolve";
export type { ResolvedTextLayer } from "./resolve";

export { drawTextToCanvas, textSignature } from "./render-text-clip";
export { createTextHistory } from "./history.svelte";

/** Load every font the timeline needs, so an export doesn't start on a fallback face. */
export async function preloadTextTimelineFonts(
  timeline: TextTimeline | null | undefined,
): Promise<void> {
  await Promise.all(textTimelineFonts(timeline).map((f) => ensureFontLoaded(f)));
}
