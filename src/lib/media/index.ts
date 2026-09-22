export { createMediaHistory } from "./history.svelte";
export {
	applyBpmToMediaClips,
	clearMediaClips,
	dealMediaClipSources,
	fillMediaClipsFromPreset,
	restoreMediaClipMosh,
	rollMediaClips,
	setMediaClipsMode,
	syncMediaClipsToPreset,
} from "./chain";
export type { MediaClipboardEntry, MediaPasteResult } from "./clipboard";
export {
	copyMediaClips,
	pasteMediaClips,
	pasteMediaContentOnto,
} from "./clipboard";
export type {
	AnimatedKey,
	ChromaKey,
	CropRect,
	Keyframe,
	MaskKey,
	MaskTransform,
	SourceEdit,
	SourceEditAnim,
	SourceSpan,
} from "./source-edit";
export {
	createSourceEdit,
	DEFAULT_CHROMA_KEY,
	DEFAULT_SOURCE_EDIT,
	FULL_CROP,
	hasAnimation,
	IDENTITY_MASK_TRANSFORM,
	isFullCrop,
	isIdleSourceEdit,
	KEY_NEAR,
	keyCoverage,
	MASK_MAX,
	normalizeSourceEdits,
	putKeyframe,
	removeKeyframe,
	sampleSourceEdit,
	wrapSourceTime,
	clampSpan,
	sourcePlayLength,
	sourceSpan,
	sourceSpeed,
	SPAN_MIN,
	SPEED_MIN,
	SPEED_MAX,
} from "./source-edit";
export type { MediaChainSource, ResolvedMediaLayer } from "./resolve";
export {
	addClip,
	createMediaChainSource,
	clipSourceId,
	detachMediaSource,
	findMediaClip,
	findMediaClipLane,
	laneSourceIds,
	mediaTimelineSourceIds,
	newClipSpan,
	replaceMediaClip,
	resolveMediaLayersAt,
	setMediaClipSources,
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
	createMediaClip,
	createMediaLane,
	DEFAULT_MEDIA_STYLE,
	EMPTY_MEDIA_TIMELINE,
	fitMediaTimeline,
	MAX_MEDIA_LANES,
	MEDIA_FIT_OPTIONS,
	MIN_CLIP_LENGTH,
	normalizeMediaTimeline,
	splitMediaClipAt,
} from "./types";
