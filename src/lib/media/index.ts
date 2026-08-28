export { createMediaHistory } from "./history.svelte";
export type { MediaClipboardEntry, MediaPasteResult } from "./clipboard";
export { copyMediaClips, pasteMediaClips } from "./clipboard";
export type { ChromaKey, SourceEdit } from "./source-edit";
export {
  createSourceEdit,
  DEFAULT_CHROMA_KEY,
  DEFAULT_SOURCE_EDIT,
  isIdleSourceEdit,
  normalizeSourceEdit,
  normalizeSourceEdits,
} from "./source-edit";
export { MEDIA_LAYER_SHORTCUTS } from "./shortcuts";
export type { ResolvedMediaLayer } from "./resolve";
export {
  addClip,
  allMediaEffectIds,
  clipAt,
  clipRange,
  clipSourceId,
  detachMediaSource,
  findMediaClip,
  findMediaClipLane,
  freeRangeAt,
  laneSourceIds,
  mediaTimelineSourceIds,
  moveClip,
  moveClips,
  removeClip,
  resizeBoundary,
  resizeClip,
  resolveMediaLayersAt,
  setMediaClipSources,
  sortClips,
  updateMediaLane,
} from "./resolve";
export type {
  MediaClip,
  MediaFit,
  MediaLane,
  MediaStyle,
  MediaTimeline,
} from "./types";
export {
  appendMediaLane,
  createFullSpanLane,
  createMediaClip,
  createMediaLane,
  createMediaTimeline,
  DEFAULT_MEDIA_STYLE,
  EMPTY_MEDIA_TIMELINE,
  fitMediaTimeline,
  MAX_MEDIA_LANES,
  MEDIA_FIT_OPTIONS,
  mediaClipWeight,
  MIN_CLIP_LENGTH,
  normalizeMediaTimeline,
  splitMediaClipAt,
} from "./types";
