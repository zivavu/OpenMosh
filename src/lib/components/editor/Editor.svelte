<script lang="ts">
	import { onMount, untrack } from "svelte";
	import { hasKeyboard } from "../../input-device";
	import Checkbox from "../ui/Checkbox.svelte";
	import {
		ChevronsDownUp,
		ChevronsUpDown,
		Download,
		Camera,
		HelpCircle,
		Library,
		Stamp,
		Maximize,
		MicVocal,
		Pause,
		Play,
		Plus,
		Palette,
		TriangleAlert,
		Type,
		Zap,
		ZapOff,
	} from "lucide-svelte";
	import { fileDrop } from "../../actions/file-drop";
	import {
		createAudioGraph,
		createOutputAudioGraph,
	} from "../../audio/audio-controller";
	import { AudioManager } from "../../audio/audio-manager.svelte";
	import type { AudioLinkGroup } from "../../audio/audio-utils";
	import { downloadBlob } from "../../recorder";
	import type { AudioResponse } from "../../audio/auto-range";
	import { createTrackStore } from "../../audio/track-persistence";
	import { loadTimeline, saveTimeline } from "../../editor/timeline-store";
	import {
		loadRenderSettings,
		saveRenderSettings,
	} from "../../editor/render-settings";
	import { readJson, readRaw, writeJson, writeRaw } from "../../storage";
	import { addTrack, getTrack } from "../../audio/track-library";
	import { SequenceMixer } from "../../mix/mixer.svelte";
	import { SourceAudioBank } from "../../mix/source-audio.svelte";
	import {
		planMix,
		planSourceIds,
		trackClipRepeats,
		trackSourceEnds,
		videoClipRepeats,
		videoSourceEnds,
	} from "../../mix/plan";
	import { renderMix } from "../../mix/render";
	import {
		audioLanesEnd,
		createAudioClip,
		createAudioLane,
		MAX_AUDIO_LANES,
		nextAudioLaneName,
		removeAudioSource,
		retargetAudioSource,
		trackIdOf,
		trackSourceId,
		type AudioClip,
		type AudioLane,
	} from "../../mix/types";
	import { readProjectNames, setProjectName } from "../../editor/project-names";
	import { generateId } from "../../effects/types";
	import AudioLanes from "../timeline/AudioLanes.svelte";
	import { editorShortcutGroups } from "../../editor/shortcut-groups";
	import { createKeyboardHandler } from "../../editor/keyboard";
	import { clearEffects as clearEffectsFn } from "../../editor/mosh";
	import { executeRecording } from "../../editor/recording";
	import { createRecordingState } from "../../editor/recording-state.svelte";
	import { createMoshSession } from "../../editor/mosh-session";
	import { PanelBurstController } from "../../editor/panel-burst";
	import {
		DEFAULT_SETTINGS,
		loadSettings,
		updateSettings,
	} from "../../editor/settings";
	import { linkBand } from "../../editor/link-band.svelte";
	import { showSpectrum } from "../../editor/show-spectrum.svelte";
	import {
		cloneEffectInstance,
		loadInitialEffects,
		restoreEffects,
		setVolumeLink,
		type EffectInstance,
		type Preset,
	} from "../../effects";
	import {
		appendTextLane,
		applyBpmToTextClips,
		clearTextClips,
		createTextChainSource,
		createTextHistory,
		EMPTY_TEXT_TIMELINE,
		fillTextClipsFromPreset,
		findTextClip,
		fitTextTimeline,
		findTextClipLane,
		normalizeTextTimeline,
		applyLyricsToTimeline,
		replaceTextClip,
		resolveTextLayersAt,
		restoreTextClipMosh,
		rollTextClips,
		setTextClipsMode,
		syncTextClipsToPreset,
		toggledTextTimeline,
		updateLane,
		type TextClip,
		type TextLane,
		type TextTimeline,
	} from "../../text";
	import {
		handBuiltLabel,
		isHandBuiltLabel,
		type ChainMode,
	} from "../../editor/sequence";
	import {
		appendFxLane,
		applyBpmToFxLanes,
		clearFxClips,
		createFxLayerSource,
		findFxClip,
		fitFxLanes,
		flattenFxLayers,
		fxClipMoshSnapshot,
		laneAudioResponse,
		MAX_FX_LANES,
		restoreFxClipMosh,
		normalizeFxLanes,
		rollFxClips,
		setFxClipsMode,
		syncFxClipsToPreset,
		type FxClip,
		type FxLane,
		type FxLaneSettings,
	} from "../../editor/fx-lanes";
	import { fanOutEdit, fanOutNote } from "../../editor/chain-fanout";
	import {
		createSnapshotHistory,
		snapshotUndoSource,
	} from "../../timeline/snapshot-history.svelte";
	import { createSpanHistory } from "../../audio/span-history.svelte";
	import { PENDING_EDIT } from "../../editor/edit-clock";
	import {
		redoLatest,
		undoLatest,
		type UndoSource,
	} from "../../editor/undo-router";
	import { detectBpm } from "../../slideshow/bpm-detector";
	import {
		applyLayerMoves,
		combinedLayerOrder,
		nextLayerZ,
		moveLayerTo,
		startLayerRowDrag,
	} from "../../timeline/layer-order";
	import {
		clipAt,
		trimClipsAt,
		type ClipLane,
		type TimelineClip,
	} from "../../timeline/clips";
	import type { LayerPick } from "../../editor/layer-pick";
	import {
		SequenceSourceRegistry,
		type SequenceSource,
	} from "../../editor/sequence-sources.svelte";
	import { MediaLayerDriver } from "../../editor/media-layer-driver";
	import { needsProxy, startProxyJob, type ProxyJob } from "../../video/proxy";
	import { openVideoFrameSource } from "../../video/frame-source";
	import { proxyStatus } from "../../video/proxy-status";
	import {
		isProxyDisabled,
		setProxyDisabled,
	} from "../../video/proxy-preference";
	import {
		addClip,
		appendMediaLane,
		applyBpmToMediaClips,
		clearMediaClips,
		dealMediaClipSources,
		createMediaChainSource,
		createMediaClip,
		createMediaHistory,
		createMediaLane,
		detachMediaSource,
		EMPTY_MEDIA_TIMELINE,
		fillMediaClipsFromPreset,
		findMediaClip,
		findMediaClipLane,
		fitMediaTimeline,
		MAX_MEDIA_LANES,
		MIN_CLIP_LENGTH,
		clipSourceId,
		mediaTimelineSourceIds,
		newClipSpan,
		normalizeMediaTimeline,
		replaceMediaClip,
		resolveMediaLayersAt,
		restoreMediaClipMosh,
		rollMediaClips,
		setMediaClipsMode,
		setMediaClipSources,
		syncMediaClipsToPreset,
		updateMediaLane as updateMediaLaneIn,
		type MediaClip,
		type MediaLane,
		type MediaTimeline,
		type SourceEdit,
	} from "../../media";
	import { chainClipMoshSnapshot } from "../../editor/chain-clip";
	import {
		deleteSequenceMediaProxy,
		getSequenceMediaProxy,
		loadMediaPool,
		pruneSequenceMedia,
		putSequenceMediaProxy,
		saveMediaPool,
		stableSourceId,
	} from "../../editor/sequence-media-store";
	import { saveSession, type SingleSessionState } from "../../editor/sessions";
	import { rememberLastOpened } from "../../editor/last-opened";
	import {
		migrateLegacySegments,
		prependMediaLane,
	} from "../../editor/legacy-segments";
	import { MoshHistory, type MoshSnapshot } from "../../editor/mosh-history";
	import type { GlRenderer, SourceFit } from "../../gl/renderer";
	import { VideoPreviewPlayer } from "../../video-preview/preview-player.svelte";
	import AudioTimeline from "../ui/AudioTimeline.svelte";
	import SpeedControl from "../ui/SpeedControl.svelte";
	import TimelineStack from "../ui/TimelineStack.svelte";
	import type { TimelineStackState } from "../../editor/timeline-stack.svelte";
	import EffectsPanel from "../ui/EffectsPanel.svelte";
	import { setFeedbackChain } from "../ui/feedback.svelte";
	import ButtonGroup from "../ui/ButtonGroup.svelte";
	import MobileSheet from "../ui/MobileSheet.svelte";
	import NumberField from "../ui/NumberField.svelte";
	import ResizeSettings from "../ui/ResizeSettings.svelte";
	import TrackAddBar from "../ui/TrackAddBar.svelte";
	import TrackLibrary from "../ui/TrackLibrary.svelte";
	import TextTimelineLane from "../text/TextTimeline.svelte";
	import MediaTimelineLane from "../media/MediaTimeline.svelte";
	import MediaClipPanel from "../media/MediaClipPanel.svelte";
	import type { LyricsSyncProps } from "../text/LyricsSyncModal.svelte";
	import TextClipPanel from "../text/TextClipPanel.svelte";
	import GlCanvas from "./GlCanvas.svelte";
	import SequenceGridView from "./SequenceGridView.svelte";
	import MediaPoolActions from "../ui/MediaPoolActions.svelte";
	import TopBar from "../ui/TopBar.svelte";
	import SaveIndicator from "../ui/SaveIndicator.svelte";
	import { SaveTracker } from "../../editor/save-status.svelte";
	import SourceRail from "./SourceRail.svelte";
	import FxLanes from "./FxLanes.svelte";
	import MoshGroup from "./MoshGroup.svelte";
	import MoshSettingsPanel from "./MoshSettingsPanel.svelte";
	import RecordGroup from "./RecordGroup.svelte";
	import RecordOverlay from "./RecordOverlay.svelte";
	import ConfirmDialog from "../ui/ConfirmDialog.svelte";
	import { showToast } from "../ui/toast.svelte";
	import { isLiveFile, liveStreamOf, stopLiveFile } from "../../webcam/camera";
	import { lazy } from "../../lazy";
	import { GeneratedSizeSync, readGenerated } from "../../generators";

	const loadShortcutsModal = lazy(() => import("../ui/ShortcutsModal.svelte"));
	const loadGeneratePanel = lazy(
		() => import("../generators/GeneratePanel.svelte"),
	);

	interface Props {
		file: File;
		onfile: (f: File) => void;
		/** Sequence mode: the rest of the media pool. */
		extraFiles?: File[];
		initialAudioFile?: File | null;
		/** Library id of `initialAudioFile` from a saved sequence. */
		initialTrackId?: string | null;
		/** Sequence mode: the saved project being reopened. Absent starts a new one. */
		initialProjectKey?: string | null;
		/** Lane timeline is sequence-only. */
		mode?: "single" | "sequence";
		/** Single mode: work restored from a saved session. */
		initialSession?: SingleSessionState | null;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: import("../../gl/renderer").GlRenderer | null;
		onExit?: () => void;
	}

	let {
		file,
		onfile,
		extraFiles = [],
		initialAudioFile = null,
		initialTrackId = null,
		initialProjectKey = null,
		mode = "single",
		initialSession = null,
		warmCanvas = null,
		warmRenderer = null,
		onExit,
	}: Props = $props();

	let isSequenceMode = $derived(mode === "sequence");
	let dragging = $state(false);

	// Sequence mode never plays `file`; media comes from the pool.
	let isVideo = $derived(!isSequenceMode && file.type.startsWith("video/"));
	// Live webcam: a `<video>` on the camera stream stands in for the player.
	let isLive = $derived(!isSequenceMode && isLiveFile(file));
	let liveVideoEl = $state<HTMLVideoElement | null>(null);
	let liveStream = $state<MediaStream | null>(null);
	$effect(() => {
		if (!isLive) return;
		const f = file;
		let dropped = false;
		void liveStreamOf(f)
			.then((stream) => {
				if (dropped) return;
				liveStream = stream;
				if (!stream) showToast("The camera is gone", "error");
			})
			.catch((e) => {
				if (!dropped)
					showToast(e instanceof Error ? e.message : String(e), "error");
			});
		return () => {
			dropped = true;
			liveStream = null;
			// Swapped out for a file: release the camera.
			stopLiveFile(f);
		};
	});
	$effect(() => {
		if (liveVideoEl) liveVideoEl.srcObject = liveStream;
	});
	const isMobile = window.matchMedia("(pointer: coarse)").matches;
	let videoEl = $state<HTMLVideoElement | null>(null);
	let videoDuration = $state(0);
	let videoCurrentTime = $state(0);
	let videoSpanStart = $state(0);
	let videoSpanEnd = $state(0);
	let videoPlaying = $state(false);
	let videoSpeed = $state(1);
	// Positions this close to the span end count as "at the end".
	const VIDEO_END_EPSILON = 0.1;
	/** Video clock sits past its span end. */
	let videoPastSpan = $state(false);
	// Starts false: Firefox ignores playbackRate on element-captured audio (moz bug 1517199).
	let videoHasAudio = $state(false);

	// WebCodecs preview playback; replaces the <video> element as frame source.
	let previewPlayer = $state<VideoPreviewPlayer | null>(null);

	// Read-only view of the active video source; writes stay in the transport functions.
	let videoClock = $derived(
		previewPlayer ? previewPlayer.currentTime : videoCurrentTime,
	);
	let videoIsPlaying = $derived(
		previewPlayer ? previewPlayer.playing : videoPlaying,
	);

	// The file the current player was built for; plain, so the proxy swap can compare identity.
	let playerFile: File | null = null;

	$effect(() => {
		if (!isVideo) return;
		const proxy = singleProxyFor === file ? singleProxy : null;
		const previewFile = proxy ?? file;
		// Read untracked: tracking would rebuild the player.
		const media = proxy
			? untrack(() => ({
					width: previewPlayer?.width ?? naturalWidth ?? 0,
					height: previewPlayer?.height ?? naturalHeight ?? 0,
					duration: videoDuration,
				}))
			: undefined;
		const swap = playerFile === file && !!proxy;
		const resume = untrack(() => ({
			time: previewPlayer?.currentTime ?? 0,
			spanStart: videoSpanStart,
			spanEnd: videoSpanEnd,
			recordDuration: recordDuration,
		}));
		let cancelled = false;
		let player: VideoPreviewPlayer | null = null;
		VideoPreviewPlayer.create(previewFile, media).then((p) => {
			if (cancelled || !p) {
				p?.dispose();
				return;
			}
			player = p;
			playerFile = file;
			previewPlayer = p;
			videoEl?.pause();
			if (videoEl) videoEl.muted = true;
			videoDuration = p.duration;
			if (swap) {
				// Same media, cheaper decoder: keep the span and the playhead.
				videoSpanStart = resume.spanStart;
				videoSpanEnd = resume.spanEnd;
				recordDuration = resume.recordDuration;
				if (resume.time > 0.05) p.seek(resume.time);
			} else {
				videoSpanStart = 0;
				videoSpanEnd = p.duration;
				recordDuration = Math.round(p.duration * 10) / 10;
			}
			// The probe may have built an element-sourced graph first; rebuild it sourceless.
			if (audio.audioContext && !audio.trackFile) audio.disposeAudioGraph();
			ensureVideoAudioGraph();
			// Starts paused on purpose; see videoAudioUnlocked.
		});
		return () => {
			cancelled = true;
			player?.dispose();
			previewPlayer = null;
		};
	});

	// Single mode's file is not pooled, so its proxy has no registry: one job per file.
	let singleProxy = $state<File | null>(null);
	/** The file `singleProxy` belongs to; plain, so a stale proxy can't leak into the player. */
	let singleProxyFor: File | null = null;
	let singleJob: ProxyJob | null = null;
	let singleJobFor: File | null = null;
	/** Set on failure so it isn't retried in a loop; the toast's Retry clears it. */
	let singleProxyFailed = $state(false);
	/** Single mode has no proxy chip, so it keeps the fields a pooled source carries. */
	let singleProxyPending = $state(false);
	let singleProxyProgress = $state<number | undefined>(undefined);
	let singleProxySize = $state<{ width: number; height: number } | null>(null);
	let singleProxyReason = $state<string | undefined>(undefined);
	/** User asked to preview from the original; stored per file in video/proxy-preference.ts. */
	let singleProxyDisabled = $state(false);
	const singleProxyStatus = $derived(
		proxyStatus({
			width: previewPlayer?.width,
			height: previewPlayer?.height,
			proxyFile: singleProxy ?? undefined,
			proxyWidth: singleProxySize?.width,
			proxyHeight: singleProxySize?.height,
			proxyPending: singleProxyPending,
			proxyProgress: singleProxyProgress,
			proxyFailed: singleProxyFailed,
			proxyReason: singleProxyReason,
			// Only meaningful for media a proxy would be built for.
			proxyDisabled:
				singleProxyDisabled &&
				needsProxy(previewPlayer?.width ?? 0, previewPlayer?.height ?? 0),
		}),
	);

	/** Turn the single-mode preview proxy on or off; the preview badge is the entry point. */
	function setSingleProxyEnabled(enabled: boolean) {
		const f = file;
		if (!f) return;
		setProxyDisabled(f, !enabled);
		// Cleared, not set: the effect below re-reads the choice and decides.
		singleJob?.cancel();
		singleJob = null;
		singleJobFor = null;
		singleProxy = null;
		singleProxyFor = null;
		singleProxyFailed = false;
		singleProxyPending = false;
		singleProxyProgress = undefined;
		singleProxySize = null;
		singleProxyReason = undefined;
		singleProxyDisabled = !enabled;
	}

	$effect(() => {
		if (isSequenceMode || !isVideo) return;
		const f = file;
		if (singleJobFor !== f) {
			// Different media: drop the previous file's proxy and job.
			singleJob?.cancel();
			singleJob = null;
			singleJobFor = null;
			singleProxy = null;
			singleProxyFor = null;
			singleProxyFailed = false;
			singleProxyPending = false;
			singleProxyProgress = undefined;
			singleProxySize = null;
			singleProxyReason = undefined;
			singleProxyDisabled = isProxyDisabled(f);
		}
		// The player gates as well as sizes: files on the <video> fallback need no proxy.
		const player = previewPlayer;
		const w = player?.width ?? 0;
		const h = player?.height ?? 0;
		if (!player || !needsProxy(w, h)) return;
		// The user asked for the original: no job, and the badge says so.
		if (singleProxyDisabled) return;
		if (singleJobFor === f || singleProxyFor === f || singleProxyFailed) return;
		singleJobFor = f;
		singleProxyPending = true;
		void (async () => {
			const stored = await getSequenceMediaProxy(f);
			let proxy = stored;
			if (!stored) {
				const job = startProxyJob(f, {
					onProgress: (progress) => {
						if (f === file) singleProxyProgress = progress;
					},
					onSized: (width, height) => {
						if (f === file) singleProxySize = { width, height };
					},
					onFailed: (reason) => {
						if (f === file) singleProxyReason = reason;
					},
				});
				singleJob = job;
				proxy = await job.promise;
			}
			if (f !== file) return;
			// A proxy that won't open is worse than none, so it gets the same decodability check.
			let openedSize: { width: number; height: number } | null = null;
			if (proxy) {
				const opened = await openVideoFrameSource(proxy);
				if (opened) {
					// The finished file's real size; a stored proxy never announced one.
					openedSize = { width: opened.width, height: opened.height };
				}
				opened?.queue.dispose();
				if (!opened) {
					proxy = null;
					// A stored one that no longer opens has to go, or the retry finds it.
					if (stored) void deleteSequenceMediaProxy(f).catch(() => {});
				}
			}
			if (proxy) {
				// Persisted under the file's own id, so re-opening the same video skips the transcode.
				if (!stored) void putSequenceMediaProxy(f, proxy).catch(() => {});
				singleProxy = proxy;
				singleProxyFor = f;
				singleProxySize = openedSize;
				singleProxyPending = false;
				singleProxyProgress = undefined;
			} else {
				// Not auto-retried; a persistent failure would loop.
				singleProxyFailed = true;
				singleProxyPending = false;
				singleProxyProgress = undefined;
				singleProxySize = null;
				showToast(
					`No smaller copy of "${f.name}" could be made. The preview plays the` +
						" original, which may stutter. Export is unaffected.",
					"error",
					8000,
					{
						label: "Try again",
						run: () => {
							singleJobFor = null;
							singleProxyFailed = false;
							singleProxyReason = undefined;
						},
					},
				);
			}
		})();
	});

	$effect(() => {
		previewPlayer?.setSpeed(videoSpeed);
	});
	$effect(() => {
		if (previewPlayer) previewPlayer.loop = videoLoop;
	});
	$effect(() => {
		previewPlayer?.setSpan(videoSpanStart, videoSpanEnd);
	});
	$effect(() => {
		previewPlayer?.setMuted(!!audio.trackFile);
	});

	$effect(() => {
		if (videoEl) videoEl.playbackRate = videoSpeed;
	});

	// Probe for an audio track; gates the volume slider and Web Audio capture.
	$effect(() => {
		if (!isVideo) return;
		const probed = file;
		videoHasAudio = false;
		(async () => {
			try {
				const mb = await import("mediabunny");
				const input = new mb.Input({
					source: new mb.BlobSource(probed),
					formats: mb.ALL_FORMATS,
				});
				const track = await input.getPrimaryAudioTrack();
				if (file === probed) videoHasAudio = !!track;
			} catch {
				if (file === probed) videoHasAudio = true;
			}
		})();
	});

	// A lane timeline is a video, so sequence mode skips the still-image picker.
	let format = $state<"png" | "jpg" | "webm">(
		isMobile && untrack(() => mode) !== "sequence" ? "png" : "webm",
	);
	let isImageFormat = $derived(format === "png" || format === "jpg");
	let isVideoFormat = $derived(format === "webm");
	let imageSrc = $state("");
	$effect(() => {
		const url = URL.createObjectURL(file);
		imageSrc = url;
		return () => URL.revokeObjectURL(url);
	});

	// A generated file re-renders at output size; the preview reads that, `file` stays put.
	let generatedSrc = $state<string | null>(null);
	const primarySync = new GeneratedSizeSync((_, url) => {
		if (generatedSrc) URL.revokeObjectURL(generatedSrc);
		generatedSrc = url;
	});
	$effect(() => {
		if (isSequenceMode) return;
		const f = file;
		primarySync.untrack("primary");
		// Untracked: a re-render landing must not count as a change of file.
		untrack(() => {
			if (generatedSrc) URL.revokeObjectURL(generatedSrc);
			generatedSrc = null;
		});
		void readGenerated(f).then((info) => {
			if (info && f === file)
				primarySync.track("primary", info.spec, info.width, info.height);
		});
		return () => primarySync.untrack("primary");
	});
	$effect(() => {
		primarySync.resize(resizeWidth, resizeHeight);
		sourceRegistry.setOutputSize(resizeWidth, resizeHeight);
	});
	$effect(() => () => primarySync.dispose());

	let generateOpen = $state(false);

	// The take lands at the second it started, on the selected lane or a new one.
	const loadWebcamPanel = lazy(() => import("../webcam/WebcamPanel.svelte"));
	let webcamOpen = $state(false);
	let takeStart = 0;

	function takeTransport(playing: boolean) {
		if (playing) {
			takeStart = timelineAxis?.staticTime ?? seqMasterTime();
			playSpan();
		} else {
			pauseTrack();
		}
	}

	async function useTake(file: File) {
		const [source] = await addSequenceSources([file]);
		if (!source) return;
		const duration = seqMasterDuration;
		if (duration <= 0) return;
		const want = source.duration > 0 ? source.duration : MIN_CLIP_LENGTH;
		const start = Math.min(takeStart, Math.max(0, duration - MIN_CLIP_LENGTH));
		pushMediaHistory();
		const picked = selectedMediaLane;
		let laneId = picked?.id ?? null;
		let span = picked ? newClipSpan(picked, start, duration, want) : null;
		let next = mediaTimeline;
		if (!span) {
			if (next.lanes.length >= MAX_MEDIA_LANES) {
				showToast("No room for the take: every lane is full", "error");
				return;
			}
			next = appendMediaLane(next, source.id, nextLayerZ(layerOrder));
			const lane = next.lanes[next.lanes.length - 1]!;
			laneId = lane.id;
			span = newClipSpan(lane, start, duration, want);
			if (!span) return;
		}
		const clip = createMediaClip(span.start, span.end, 0, source.id);
		setMediaTimeline(
			updateMediaLaneIn(next, laneId!, (l) => addClip(l, clip, duration)),
		);
		selectedMediaClipId = clip.id;
		selectedMediaClipIds = [clip.id];
		showToast(
			`Take on ${next.lanes.find((l) => l.id === laneId)?.name}`,
			"info",
		);
	}

	function useGenerated(files: File[]) {
		generateOpen = false;
		if (isSequenceMode) void addSequenceSources(files);
		else onfile(files[0]);
	}
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let glRenderer: GlRenderer | null = $state(null);
	/** Restored instances whose definition no longer exists are dropped. */
	function restoredEffects(): EffectInstance[] | null {
		const saved = untrack(() => initialSession)?.effects;
		if (!Array.isArray(saved) || saved.length === 0) return null;
		const known = restoreEffects(saved);
		return known.length > 0 ? known : null;
	}

	let effects: EffectInstance[] = $state(
		restoredEffects() ?? loadInitialEffects(),
	);

	// The feedback modal is at the app root and has no other way to see the live chain.
	$effect(() => {
		setFeedbackChain(() => $state.snapshot(effects) as EffectInstance[]);
		return () => setFeedbackChain(null);
	});

	const saved = loadSettings();
	let moshMin = $state(saved.moshMin ?? DEFAULT_SETTINGS.moshMin);
	let moshMax = $state(saved.moshMax ?? DEFAULT_SETTINGS.moshMax);
	let moshStyle = $state(saved.moshStyle ?? DEFAULT_SETTINGS.moshStyle);
	let randomizeOrder = $state(
		saved.randomizeOrder ?? DEFAULT_SETTINGS.randomizeOrder,
	);
	let showMoshSettings = $state(false);
	let moshAudioLink = $state(
		saved.moshAudioLink ?? DEFAULT_SETTINGS.moshAudioLink,
	);
	let moshAudioLinkStrength = $state(
		saved.moshAudioLinkStrength ?? DEFAULT_SETTINGS.moshAudioLinkStrength,
	);
	let audioSmoothing = $state(
		saved.audioSmoothing ?? DEFAULT_SETTINGS.audioSmoothing,
	);
	let audioPunch = $state(saved.audioPunch ?? DEFAULT_SETTINGS.audioPunch);
	// One object so the preview tick and the export are fed the same thing.
	const audioResponse = $derived<AudioResponse>({
		smoothing: audioSmoothing,
		punch: audioPunch,
	});
	let showFps = $state(saved.showFps ?? DEFAULT_SETTINGS.showFps);
	let videoLoop = $state(saved.loopVideo ?? DEFAULT_SETTINGS.loopVideo);
	let sourceFit = $state<SourceFit>(
		saved.sourceFit ?? DEFAULT_SETTINGS.sourceFit,
	);
	let showShortcuts = $state(false);
	let previewFullscreen = $state(false);
	const fullscreenSupported =
		typeof document !== "undefined" && document.fullscreenEnabled;

	// Base chain and text layers follow the editor's response; each lane follows its own.
	const linkGroups = (): AudioLinkGroup[] => [
		{
			scope: "",
			effects,
			response: audioResponse,
		},
		...fxLayers.map((layer) => ({
			scope: layer.laneId,
			effects: layer.effects,
			response: fxLaneResponse(layer.laneId),
		})),
		// A media lane's chain is its clip's under the playhead, read off the resolved layers.
		...resolveMediaLayersAt(
			mediaTimeline,
			textTime,
			sourceRegistry.edits,
			previewMediaChains,
		).map((layer) => ({
			scope: layer.laneId,
			effects: layer.effects,
			response: layer.response ?? audioResponse,
		})),
		...resolveTextLayersAt(textTimeline, textTime, previewTextChains).map(
			(layer) => ({
				scope: layer.laneId,
				effects: layer.effects,
				response: audioResponse,
			}),
		),
	];

	const audio = new AudioManager({
		getLinkGroups: linkGroups,
		initialOutputVolume: saved.outputVolume ?? DEFAULT_SETTINGS.outputVolume,
		initialLoop: saved.loopAudio ?? DEFAULT_SETTINGS.loopAudio,
	});

	// Close the AudioContext on unmount so repeated visits don't leak contexts.
	$effect(() => () => audio.disposeAudioGraph());

	// Sequence mode: every lane's sound, from the song to a video's own, decoded per source.
	const audioBank = new SourceAudioBank(async (id) => {
		const trackId = trackIdOf(id);
		if (trackId) {
			if (trackId === currentTrackId && audio.trackFile) return audio.trackFile;
			const track = await getTrack(trackId).catch(() => null);
			return track
				? new File([track.blob], track.name, { type: track.blob.type })
				: null;
		}
		const source = sourceRegistry.get(id);
		return source?.kind === "video" ? source.file : null;
	});

	// Sequence mode's clock: the project sets the length, and the mix plays under it.
	const mixer = new SequenceMixer({
		bank: audioBank,
		getLinkGroups: linkGroups,
		initialOutputVolume: saved.outputVolume ?? DEFAULT_SETTINGS.outputVolume,
		initialLoop: saved.loopAudio ?? DEFAULT_SETTINGS.loopAudio,
	});
	$effect(() => () => {
		mixer.dispose();
		audioBank.dispose();
	});

	// Pull the element clock every frame while playing; ~4 Hz timeupdate alone makes it jump.
	$effect(() => {
		if (!audio.audioPlaying) return;
		let raf = requestAnimationFrame(function loop() {
			audio.tickCurrentTime();
			// Per frame, not per timeupdate: playback must turn round on the span end.
			audio.checkSpanEnd();
			raf = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(raf);
	});

	let audioEl = $state<HTMLAudioElement | undefined>(undefined);
	$effect(() => {
		audio.setAudioEl(audioEl);
	});

	// Once per file handed in: unloading the song later mustn't bring it back.
	$effect(() => {
		const initial = initialAudioFile;
		untrack(() => {
			if (!initial || audio.trackFile) return;
			audio.trackFile = initial;
			// Opened from a saved song: adopt its id and its stored timeline.
			if (initialTrackId) adoptLibraryTrack(initialTrackId);
		});
	});

	// Mute video when an explicit audio track is active; re-hook video audio when cleared.
	$effect(() => {
		if (!isVideo || !videoEl) return;
		if (audio.trackFile) {
			videoEl.muted = true;
		} else {
			ensureVideoAudioGraph();
		}
	});

	$effect(() => {
		moshMin;
		moshMax;
		moshStyle;
		randomizeOrder;
		moshAudioLink;
		moshAudioLinkStrength;
		linkBand.value;
		audioSmoothing;
		audioPunch;
		showFps;
		showSpectrum.value;
		const outputVolume = isSequenceMode
			? mixer.outputVolume
			: audio.outputVolume;
		const loopAudio = isSequenceMode ? mixer.loop : audio.loopAudio;
		videoLoop;
		// Merged, not replaced: the upload screen writes its mode under the same key.
		updateSettings({
			moshMin,
			moshMax,
			moshStyle,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			moshLinkBand: linkBand.value,
			audioSmoothing,
			audioPunch,
			showFps,
			showSpectrum: showSpectrum.value,
			outputVolume,
			loopAudio,
			loopVideo: videoLoop,
			sourceFit,
		});
	});
	let currentFps = $state(0);

	let naturalWidth = $state<number | undefined>(undefined);
	let naturalHeight = $state<number | undefined>(undefined);
	let resizeWidth = $state(0);
	let resizeHeight = $state(0);

	let currentTrackId = $state<string | null>(null);

	const spanStore = createTrackStore<{ spanStart: number; spanEnd: number }>(
		"openmosh-single-span",
	);
	/** Read-only now: output size moved into per-project render settings. */
	const sizeStore = createTrackStore<{ width: number; height: number }>(
		"openmosh-single-size",
	);

	// Persist span changes for library tracks; the span sits at 0/0 until duration is known.
	$effect(() => {
		const start = audio.spanStart;
		const end = audio.spanEnd;
		const restorePending = audio.pendingSpan !== null;
		if (!currentTrackId || restorePending || audio.trackDuration <= 0) return;
		if (end <= start) return;
		spanStore.save(currentTrackId, { spanStart: start, spanEnd: end });
	});

	// The span handles are an edit like any other; see span-history.svelte.ts.
	const spanHistory = createSpanHistory(audio);
	$effect(() => spanHistory.trackChanged(currentTrackId));
	const mixSpanHistory = createSpanHistory(mixer);

	let trackInput: HTMLInputElement;

	/** Latched when a track restores a size, so the default below can't overwrite it. */
	let sizeRestoredFromTrack = false;

	// New media defaults the output to its own size.
	$effect(() => {
		const nw = naturalWidth;
		const nh = naturalHeight;
		if (nw != null && nh != null && nw > 0 && nh > 0) {
			if (sizeRestoredFromTrack) {
				sizeRestoredFromTrack = false;
				return;
			}
			resizeWidth = nw;
			resizeHeight = nh;
		}
	});

	function openTrackPicker() {
		trackInput?.click();
	}

	function onTrackInputChange() {
		const files = Array.from(trackInput?.files ?? []);
		trackInput.value = "";
		if (files.length === 0) return;
		if (isSequenceMode) {
			void addAudioFiles(files);
			return;
		}
		clearTrack();
		audio.trackFile = files[0];
	}

	function clearTrack() {
		if (isSequenceMode) {
			removeSong();
			return;
		}
		// Before the key changes out from under them; see flushSequenceSave.
		flushSequenceSave();
		flushMediaPoolSave();
		audio.clearTrack();
		currentTrackId = null;
		sizeRestoredFromTrack = false;
		// Belongs to the song that just left; the next one restores or detects its own.
		sequenceBpm = 0;
	}

	/** Pull back whatever was stored against a song; every track-id path runs this. */
	async function applySavedTrackState(
		trackId: string,
		/** Moving between songs starts the new one clean when it has nothing saved. */
		clearOnMissing = false,
	): Promise<void> {
		const savedSpan = spanStore.load(trackId);
		// An empty span is left by the overwrite above, never a user choice.
		if (savedSpan !== null && savedSpan.spanEnd > savedSpan.spanStart) {
			audio.pendingSpan = {
				start: savedSpan.spanStart,
				end: savedSpan.spanEnd,
			};
		}
		const key = seqKeyPrefix + trackId;
		loadedTimelineKey = null;
		const savedSeq = await loadSeqEntry(trackId);
		// A later switch overtook this load; that one owns the state now.
		if (seqStoreKey !== key) return;
		loadedTimelineKey = key;
		if (savedSeq === null) {
			if (clearOnMissing) restoreFxLanes(undefined);
			return;
		}
		// BPM comes back in both modes; beat-synced effects read it in single mode too.
		restoreSequenceBpm(savedSeq.bpm ?? 0);
		if (isSequenceMode) restoreFxLanes(savedSeq.fx);
		restoreTextTimeline(savedSeq.text);
		restoreMediaTimeline(savedSeq.media);
		sourceRegistry.restoreEdits(savedSeq.sourceEdits);
		// Segments fold into the lanes once the song's length is known.
		legacySegments =
			isSequenceMode && savedSeq.segments?.length
				? { key, segments: savedSeq.segments }
				: null;
	}

	/** The editor learned a track's library id without being asked to load it. */
	function adoptLibraryTrack(trackId: string) {
		if (currentTrackId === trackId) return;
		currentTrackId = trackId;
		// The project, not its song, owns what's saved in sequence mode.
		if (isSequenceMode) return;
		void applySavedTrackState(trackId);
	}

	/** Give a song that arrived without a library id one; the id keys everything per-song. */
	let registeringTrack: File | null = null;
	$effect(() => {
		const f = audio.trackFile;
		if (!f || currentTrackId || registeringTrack === f) return;
		registeringTrack = f;
		void (async () => {
			try {
				const track = await addTrack(f);
				// Swapped or cleared while the lookup was out; that song owns the id now.
				if (audio.trackFile !== f) return;
				adoptLibraryTrack(track.id);
			} catch (e) {
				console.error("Failed to register track:", e);
			} finally {
				registeringTrack = null;
			}
		})();
	});

	function onLibraryLoadTrack(file: File, trackId: string, autoplay = false) {
		if (isSequenceMode) {
			replaceSong(file, trackId);
			return;
		}
		const switchingSongs = !!currentTrackId && currentTrackId !== trackId;
		clearTrack();
		currentTrackId = trackId;
		audio.trackFile = file;
		// The media pool is deliberately left alone on a switch.
		void applySavedTrackState(trackId, switchingSongs);
		if (autoplay) audio.autoplayOnLoad = true;
	}

	// An AudioContext created before a user gesture starts suspended and can't be resumed.
	let videoAudioUnlocked = $state(false);

	function ensureVideoAudioGraph() {
		if (!videoAudioUnlocked) return;
		// Skip silent videos: capturing them breaks the speed control in Firefox.
		if (audio.audioContext || audio.trackFile || !videoHasAudio) return;
		if (previewPlayer) {
			// WebCodecs preview: sourceless graph; the player connects its own source node.
			const state = createOutputAudioGraph();
			audio.applyAudioGraphState(state);
			previewPlayer.attachAudioOutput(state.context, state.normalizeGain);
			state.context.resume().catch(() => {});
			return;
		}
		if (!videoEl) return;
		videoEl.muted = false;
		const state = createAudioGraph(videoEl);
		audio.applyAudioGraphState(state);
		audio.audioContext!.resume().catch(() => {});
	}

	function playVideo() {
		// First play is a user gesture, so the graph can be created unblocked.
		videoAudioUnlocked = true;
		ensureVideoAudioGraph();
		audio.audioContext?.resume();
		// Start from the static marker when the video owns the clock.
		const fromMarker = !!timelineAxis && videoIsMaster;
		if (fromMarker && !videoIsPlaying) seekVideoTo(timelineAxis!.staticTime);
		// Past the span end is where the user put the marker, so it plays from there.
		const outOfSpan = (t: number) =>
			t < videoSpanStart ||
			(!fromMarker && t >= videoSpanEnd - VIDEO_END_EPSILON);
		if (previewPlayer) {
			if (outOfSpan(previewPlayer.currentTime))
				previewPlayer.seek(videoSpanStart);
			previewPlayer.play();
			return;
		}
		if (!videoEl) return;
		if (outOfSpan(videoEl.currentTime)) videoEl.currentTime = videoSpanStart;
		videoPastSpan = videoEl.currentTime >= videoSpanEnd - VIDEO_END_EPSILON;
		videoEl.play().catch(() => {});
	}

	function pauseVideo() {
		if (previewPlayer) {
			previewPlayer.pause();
			return;
		}
		videoEl?.pause();
	}

	function seekVideoTo(t: number) {
		if (!videoDuration) return;
		const tClamp = Math.max(0, Math.min(videoDuration, t));
		videoPastSpan = tClamp >= videoSpanEnd - VIDEO_END_EPSILON;
		if (previewPlayer) {
			previewPlayer.seek(tClamp);
			return;
		}
		if (!videoEl) return;
		videoEl.currentTime = tClamp;
		videoCurrentTime = tClamp;
	}

	// Not gated on audioContext: the graph is only built on first play.
	const hasAudio = $derived(
		isSequenceMode
			? mixer.hasDrive
			: !!audio.trackFile || (isVideo && videoHasAudio),
	);
	/** Whether the audio links have something to follow, for the panels' spectra. */
	let linksHaveAudio = $derived(
		isSequenceMode
			? mixer.hasDrive
			: !!audio.trackFile || (isVideo && !!audio.analyserNode),
	);
	let liveSpectrum = $derived(
		isSequenceMode ? mixer.spectrumData : audio.spectrumData,
	);

	function getMoshOptions() {
		return {
			moshMin,
			moshMax,
			moshStyle,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			moshLinkBand: linkBand.value,
			hasAudio,
		};
	}

	// Stacked effect lanes over the frame; chains run in lane order.
	let fxLanes = $state<FxLane[]>([]);
	let selectedFxClipId = $state<string | null>(null);
	let selectedFxClipIds = $state<string[]>([]);

	// Single mode: with an external track the audio is the master clock, matching export.
	// Loading the file makes it master, not "and its duration is known". Sequence mode's
	// clock is the mixer, whatever the lanes hold.
	let seqMasterIsAudio = $derived(!isSequenceMode && !!audio.trackFile);
	let seqMasterDuration = $derived(
		isSequenceMode
			? mixer.duration
			: seqMasterIsAudio
				? audio.trackDuration
				: videoDuration,
	);

	// Beats per minute, feeding the auto clips' re-roll spacing; 0 = not detected yet.
	let sequenceBpm = $state(0);

	interface SeqEntry {
		/** Absent on entries saved while the opening file was the segments' implicit media. */
		v?: number;
		/** The retired segment lane; folded into the fx and media lanes on load, never saved. */
		segments?: LegacySegmentEntry[];
		/** Absent on entries saved before BPM existed. */
		bpm?: number;
		/** Absent on entries saved before the text timeline existed. */
		text?: TextTimeline;
		/** Absent on entries saved before media layers existed. */
		media?: MediaTimeline;
		/** Absent on entries saved before fx lanes existed. */
		fx?: FxLane[];
		/** Per-source edits, keyed by source id. Sparse: only edited media. */
		sourceEdits?: Record<string, SourceEdit>;
		/** Sequence mode, from v3: the project's own length. Before, the song set it. */
		length?: number;
		/** The export span on the project timeline. */
		span?: { start: number; end: number };
		/** Library id of the song: the BPM source, and what the library shows as loaded. */
		song?: string | null;
	}

	/** Bumped when what a saved entry means changes; see SeqEntry.v. v3 moved the song
	 * onto an audio lane and gave the project its own length. */
	const SEQ_ENTRY_VERSION = 3;

	/** As much of a saved segment as the migration reads. */
	interface LegacySegmentEntry {
		sourceId?: string;
		[key: string]: unknown;
	}

	/** Segments waiting for the song's duration to be folded into the lanes. */
	let legacySegments = $state<{
		key: string;
		segments: LegacySegmentEntry[];
	} | null>(null);
	$effect(() => {
		const pending = legacySegments;
		if (!pending || pending.key !== seqStoreKey) return;
		const duration = seqMasterDuration;
		if (duration <= 0) return;
		legacySegments = null;
		const { fxLane, mediaLane } = migrateLegacySegments(
			pending.segments,
			duration,
		);
		untrack(() => {
			if (fxLane) setFxLanes([fxLane, ...fxLanes]);
			if (mediaLane) mediaTimeline = prependMediaLane(mediaTimeline, mediaLane);
			fxHistory.reset();
			mediaHistory.reset();
		});
	});

	// Keyed by master clock: clip times are relative to it.
	let videoSeqKey = $derived(
		isVideo ? `video:${file.name}:${file.size}:${file.lastModified}` : null,
	);
	/** Sequence mode's project id: the song's id for projects from before v3, else its own. */
	let projectKey = $state<string | null>(
		untrack(() =>
			mode === "sequence"
				? (initialProjectKey ?? initialTrackId ?? `proj-${generateId()}`)
				: null,
		),
	);

	// The song/video this editor saves against, before the mode prefix.
	let seqBaseKey = $derived(
		isSequenceMode
			? projectKey
			: seqMasterIsAudio
				? currentTrackId
				: (videoSeqKey ?? currentTrackId),
	);

	/** Single and sequence share this component, so the store is namespaced. */
	const seqKeyPrefix = $derived(isSequenceMode ? "seq:" : "single:");
	let seqStoreKey = $derived(seqBaseKey && seqKeyPrefix + seqBaseKey);

	/** The key whose stored timeline has landed; saving waits for the on-screen key to match. */
	let loadedTimelineKey: string | null = null;

	/** Read this mode's entry for a song, falling back to the legacy un-prefixed entry. */
	async function loadSeqEntry(baseKey: string): Promise<SeqEntry | null> {
		const entry =
			(await loadTimeline<SeqEntry>(seqKeyPrefix + baseKey)) ??
			(isSequenceMode ? await loadTimeline<SeqEntry>(baseKey) : null);
		// Before layers took the media over, a segment with no source drew the opened file.
		if (entry?.segments && !entry.v) {
			const opened = stableSourceId(file);
			for (const seg of entry.segments) seg.sourceId ??= opened;
		}
		return entry;
	}

	// Once per video; with a track loaded, onLibraryLoadTrack owns restoring.
	let restoredSeqKey: string | null = null;
	$effect(() => {
		const key = videoSeqKey;
		if (!key || key === restoredSeqKey) return;
		restoredSeqKey = key;
		if (untrack(() => seqMasterIsAudio)) return;
		const storeKey = seqKeyPrefix + key;
		loadedTimelineKey = null;
		void (async () => {
			const saved = await loadSeqEntry(key);
			// A song adopted while this was out owns the state now.
			if (seqStoreKey !== storeKey) return;
			// Marked even with nothing to restore: a video with no saved timeline still saves.
			loadedTimelineKey = storeKey;
			if (saved === null) return;
			restoreTextTimeline(saved.text);
			restoreMediaTimeline(saved.media);
			sourceRegistry.restoreEdits(saved.sourceEdits);
		})();
	});

	/** A restored BPM wins over any detection in flight: the clips were built against it. */
	function restoreSequenceBpm(bpm: number) {
		if (bpm > 0) bpmEpoch++;
		sequenceBpm = bpm;
	}

	/** Every autosave below reports here, for the top bar's saved/saving/failed word. */
	const saves = new SaveTracker();

	// Persist the sequence timeline per library track (deep snapshot read).
	// Skipped while playing: the volume-link tick mutates the chains each frame.
	let seqSaveTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const playing = audio.audioPlaying || videoIsPlaying || mixer.playing;
		if (playing) return;
		const entry = seqEntryNow();
		const key = seqStoreKey;
		if (!key || key !== loadedTimelineKey || !entry) return;
		clearTimeout(seqSaveTimer);
		untrack(() => saves.schedule("timeline"));
		seqSaveTimer = setTimeout(() => {
			void saves
				.track("timeline", saveTimeline(key, entry))
				.then(reportSeqSave);
		}, 300);
	});

	/** What gets saved, read deep; null while a project is still working out its length. */
	function seqEntryNow(): SeqEntry | null {
		if (isSequenceMode && !projectReady) return null;
		const entry: SeqEntry = {
			v: SEQ_ENTRY_VERSION,
			bpm: sequenceBpm,
			text: layersAsLoaded(
				$state.snapshot(textTimeline) as TextTimeline,
				"text",
			),
			media: $state.snapshot(mediaTimeline) as MediaTimeline,
			fx: $state.snapshot(fxLanes) as FxLane[],
			sourceEdits: $state.snapshot(sourceRegistry.edits) as Record<
				string,
				SourceEdit
			>,
		};
		if (isSequenceMode) {
			entry.length = mixer.duration;
			entry.span = { start: mixer.spanStart, end: mixer.spanEnd };
			entry.song = currentTrackId;
		}
		return entry;
	}

	/** Only the transition into failure is announced, or it would toast every tick. */
	let seqSaveFailed = false;
	function reportSeqSave(ok: boolean) {
		if (ok === !seqSaveFailed) return;
		seqSaveFailed = !ok;
		if (ok) return;
		showToast(
			"Couldn't save this timeline — your recent changes may not survive a reload.",
			"error",
			10000,
		);
	}

	/** Write the current timeline under the current key now; a track switch outruns the effect. */
	function flushSequenceSave() {
		clearTimeout(seqSaveTimer);
		const key = seqStoreKey;
		const entry = seqEntryNow();
		if (!key || key !== loadedTimelineKey || !entry) {
			saves.drop("timeline");
			return;
		}
		void saves.track("timeline", saveTimeline(key, entry)).then(reportSeqSave);
	}

	// Reloading or closing mid-playback would lose the session: no pause settles the debounce.
	onMount(() => {
		const onHide = () => {
			flushSequenceSave();
			flushMediaPoolSave();
			flushSingleSessionSave();
		};
		window.addEventListener("pagehide", onHide);
		return () => {
			window.removeEventListener("pagehide", onHide);
			onHide();
		};
	});

	// Pull the clip lanes back inside the master clock when it changes. Not in sequence
	// mode: a shorter project leaves clips past its end alone, to come back if it grows.
	$effect(() => {
		const duration = seqMasterDuration;
		if (duration <= 0 || isSequenceMode) return;
		untrack(() => {
			const media = fitMediaTimeline(mediaTimeline, duration);
			if (media !== mediaTimeline) mediaTimeline = media;
			const text = fitTextTimeline(textTimeline, duration);
			if (text !== textTimeline) textTimeline = text;
			const fx = fitFxLanes(fxLanes, duration);
			if (fx !== fxLanes) setFxLanes(fx);
		});
	});

	function seqMasterTime(): number {
		if (isSequenceMode) return mixer.currentTime;
		if (seqMasterIsAudio) return audio.trackCurrentTime;
		return videoClock;
	}

	// Their own undo stack, like the text timeline's; Ctrl+Z reaches it when newest.
	const fxHistory = createSnapshotHistory<FxLane[]>();

	function pushFxHistory(coalesceKey?: string) {
		fxHistory.push($state.snapshot(fxLanes) as FxLane[], coalesceKey);
	}

	function setFxLanes(next: FxLane[]) {
		fxLanes = next;
		// Splits, deletes and undo retire clip ids; drop their mosh stacks.
		fxMoshHistory.retain(next.flatMap((l) => l.clips.map((c) => c.id)));
	}

	/** Adopt saved lanes, or clear back to none when a song has none. */
	function restoreFxLanes(saved: FxLane[] | undefined) {
		fxLanes = normalizeFxLanes(saved);
		selectedFxClipId = null;
		selectedFxClipIds = [];
		selectedFxLaneId = null;
		fxHistory.reset();
	}

	/** What a new lane starts from: the editor's current settings, copied. */
	function currentFxLaneSettings(): FxLaneSettings {
		return {
			moshMin,
			moshMax,
			moshStyle,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			moshLinkBand: linkBand.value,
			audioResponse: { ...audioResponse },
		};
	}

	function addFxLane() {
		// Full timeline width, so a new lane arrives with one clean clip to work on.
		const next = appendFxLane(
			fxLanes,
			currentFxLaneSettings(),
			seqMasterDuration,
			nextLayerZ(layerOrder),
		);
		// At the cap this is a no-op; recording it would leave a Ctrl+Z that undoes nothing.
		if (next === fxLanes) return;
		pushFxHistory();
		fxLanes = next;
	}

	function fxModeChange(
		clipIds: string[],
		mode: ChainMode,
		intervalSec?: number,
		intervalBeats?: number | null,
	) {
		pushFxHistory();
		fxLanes = setFxClipsMode(
			fxLanes,
			new Set(clipIds),
			mode,
			intervalSec,
			intervalBeats,
		);
	}

	// Left/right walk one fx clip's moshes, one stack per clip keyed by clip id.
	const fxMoshHistory = new MoshHistory<MoshSnapshot>();

	/** The fx clip the mosh gestures act on: the selected one only. */
	function activeFxClip(): FxClip | null {
		return selectedFxClip;
	}

	/** Roll the given clips. Mosh history only, never the fx edit stack. */
	function fxRoll(clipIds: string[]) {
		const ids = new Set(clipIds);
		for (const clip of fxClipsById(ids)) {
			fxMoshHistory.seed(
				clip.id,
				fxClipMoshSnapshot($state.snapshot(clip) as FxClip),
			);
		}
		rollAlive(() => (fxLanes = rollFxClips(fxLanes, ids, getMoshOptions())));
		for (const clip of fxClipsById(ids)) {
			fxMoshHistory.push(
				clip.id,
				fxClipMoshSnapshot($state.snapshot(clip) as FxClip),
			);
		}
	}

	function fxClipsById(ids: Set<string>): FxClip[] {
		return fxLanes.flatMap((l) => l.clips.filter((c) => ids.has(c.id)));
	}

	function applyFxClipMosh(clipId: string, snap: MoshSnapshot) {
		fxLanes = restoreFxClipMosh(fxLanes, clipId, snap);
	}

	function fxClear(clipIds: string[]) {
		pushFxHistory();
		fxLanes = clearFxClips(fxLanes, new Set(clipIds));
	}

	/** The fx clip the effects panel is editing, if one is selected. */
	let selectedFxClip = $derived(
		isSequenceMode
			? (findFxClip(fxLanes, selectedFxClipId)?.clip ?? null)
			: null,
	);
	let fxChainNote = $derived(
		fanOutNote(
			selectedFxClip,
			fxClipsById(new Set(selectedFxClipIds)).filter(
				(c) => c.id !== selectedFxClipId,
			),
		),
	);

	// Same resolver the export builds, so interval rolls reproduce exactly.
	const previewFxSource = createFxLayerSource(() => fxLanes, getMoshOptions);

	/** The lane the settings panel is aimed at: the selected clip's, or one picked by name. */
	let selectedFxLaneId = $state<string | null>(null);
	let panelLane = $derived.by((): FxLane | MediaLane | null => {
		if (!isSequenceMode) return null;
		const byClip = findFxClip(fxLanes, selectedFxClipId)?.lane;
		if (byClip) return byClip;
		return fxLanes.find((l) => l.id === selectedFxLaneId) ?? selectedMediaLane;
	});

	/** Panel value: the lane's, or the editor's for lanes without settings yet. */
	function fxSetting<K extends keyof FxLaneSettings>(
		key: K,
		global: FxLaneSettings[K],
	): FxLaneSettings[K] {
		return panelLane?.settings?.[key] ?? global;
	}

	/** Panel edit: writes to the selected lane, else the editor's settings. */
	function setFxSetting<K extends keyof FxLaneSettings>(
		key: K,
		value: FxLaneSettings[K],
		setGlobal: (v: FxLaneSettings[K]) => void,
	) {
		const lane = panelLane;
		if (!lane) {
			setGlobal(value);
			return;
		}
		lane.settings = {
			...(lane.settings ?? currentFxLaneSettings()),
			[key]: value,
		};
	}

	/** Hand a lane back to the editor's settings, so the panel reads those again. */
	function followEditorSettings() {
		if (panelLane) panelLane.settings = undefined;
	}

	/** The three audio-response sliders, which sit one level down. */
	function fxResponse<K extends keyof AudioResponse>(
		key: K,
		global: number,
	): number {
		return panelLane?.settings?.audioResponse[key] ?? global;
	}

	function setFxResponse<K extends keyof AudioResponse>(
		key: K,
		value: number,
		setGlobal: (v: number) => void,
	) {
		const lane = panelLane;
		if (!lane) {
			setGlobal(value);
			return;
		}
		const settings = lane.settings ?? currentFxLaneSettings();
		lane.settings = {
			...settings,
			audioResponse: { ...settings.audioResponse, [key]: value },
		};
	}

	/** A lane's audio response, falling back to the editor's for older lanes. */
	function fxLaneResponse(laneId: string) {
		const lane = fxLanes.find((l) => l.id === laneId);
		return lane ? laneAudioResponse(lane, audioResponse) : audioResponse;
	}

	/** The stacked lanes for this frame, with fade weights. */
	let fxLayers = $derived(
		isSequenceMode ? previewFxSource(seqMasterTime()) : [],
	);

	/** The same effects flat, for the panel-facing chain and the audio tick. */
	let fxChain = $derived(flattenFxLayers(fxLayers));

	// Every piece of media the project can draw; sourceTick bumps when a late upload lands.
	let sourceTick = $state(0);
	const bumpSourceTick = () => {
		if (!seqPlaying()) sourceTick++;
	};

	const sourceRegistry = new SequenceSourceRegistry(bumpSourceTick);
	let sequenceSources = $derived(sourceRegistry.sources);
	/** The pool is empty until the opening file lands, so the placeholder waits for that. */
	let poolFilled = $state(false);
	let noSequenceMedia = $derived(
		isSequenceMode && poolFilled && sequenceSources.length === 0,
	);
	/** Held from mount until the opening files are in the pool; proxies are not waited on. */
	let openingMedia = $state(true);
	/** The mount-time adds (the opened file and its extras) have finished. */
	let mountMediaDone = $state(false);
	$effect(() => {
		if (!openingMedia) return;
		// A song being registered has no key yet, so the key is settled once there is one.
		const keySettled = !!seqBaseKey || !audio.trackFile;
		const settled =
			mountMediaDone &&
			keySettled &&
			(poolReady || !seqBaseKey) &&
			sourceRegistry.loadingTotal === 0 &&
			!sequenceSources.some((s) => s.thumbPending);
		if (settled) openingMedia = false;
	});
	/** Media is being probed and nothing has landed, so the canvas is black. */
	let mediaLoading = $derived(
		isSequenceMode &&
			(openingMedia ||
				(sourceRegistry.loadingTotal > 0 && sequenceSources.length === 0)),
	);

	onMount(() => {
		void (async () => {
			// Single mode has no pool: its one file is the frame.
			if (!isSequenceMode) return;
			try {
				// Opened from a saved project: these blobs came from storage, so don't write them back.
				const persist = !initialTrackId && !initialProjectKey;
				await sourceRegistry.add([file], { persist });
				poolFilled = true;
				const extras = extraFiles.filter((f) => f !== file);
				if (extras.length > 0) {
					await sourceRegistry.add(extras, { persist });
				}
			} finally {
				mountMediaDone = true;
			}
		})();
		return () => sourceRegistry.dispose();
	});

	// Keyed like the sequence timeline (seqBaseKey), so a track brings back both.
	let poolKey: string | null = null;
	let poolReady = $state(false);
	/** Clip source ids already looked for in storage; see the effect below. */
	const restoreAttempted = new Set<string>();

	$effect(() => {
		if (!isSequenceMode) return;
		const key = seqBaseKey;
		if (!key || key === poolKey) return;
		poolKey = key;
		poolReady = false;
		// A different song may reference media this session hasn't tried yet.
		restoreAttempted.clear();
		void (async () => {
			let ids: string[] | null = null;
			try {
				ids = await loadMediaPool(key);
			} catch {
				// Storage blocked: carry on with whatever is loaded.
			}
			if (poolKey !== key) return;
			// A song with a saved pool swaps to it; one with none keeps what's loaded.
			if (ids) await sourceRegistry.setPool(ids);
			if (poolKey === key) poolReady = true;
		})();
	});

	// Persist the pool for the current song. Debounced: a multi-file add appends in batches.
	let poolSaveTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (!isSequenceMode || !poolReady) return;
		const key = poolKey;
		const ids = sourceRegistry.sources.map((s) => s.id);
		if (!key) return;
		clearTimeout(poolSaveTimer);
		untrack(() => saves.schedule("pool"));
		poolSaveTimer = setTimeout(() => savePool(key, ids), 400);
	});

	function savePool(key: string, ids: string[]) {
		void saves
			.track(
				"pool",
				saveMediaPool(key, ids).then(() => true),
			)
			.then((ok) => {
				if (ok) void pruneSequenceMedia().catch(() => {});
			});
	}

	/** Pool counterpart to flushSequenceSave; same track-switch race. */
	function flushMediaPoolSave() {
		clearTimeout(poolSaveTimer);
		if (!isSequenceMode || !poolReady || !poolKey) {
			saves.drop("pool");
			return;
		}
		savePool(
			poolKey,
			sourceRegistry.sources.map((s) => s.id),
		);
	}

	// A restored timeline references sources by id; pull missing ones back out of IndexedDB.
	$effect(() => {
		if (!isSequenceMode) return;
		const missing = mediaTimelineSourceIds(mediaTimeline).filter(
			(id) => !sourceRegistry.get(id) && !restoreAttempted.has(id),
		);
		if (missing.length === 0) return;
		for (const id of missing) restoreAttempted.add(id);
		void sourceRegistry.restore(missing);
	});

	/** Add to the pool, then seat a source-less lane on the first file added. */
	async function addLayerSources(files: File[]) {
		const added = await addSequenceSources(files);
		const first = added[0];
		if (!first) return;
		// Nothing anywhere on the lane to draw; clips that each point somewhere already carry media.
		const unset = mediaTimeline.lanes.find(
			(l) => !l.sourceId && l.clips.every((c) => !c.sourceId),
		);
		if (!unset) return;
		pushMediaHistory();
		setMediaTimeline(
			updateMediaLaneIn(mediaTimeline, unset.id, (l) => ({
				...l,
				sourceId: first.id,
			})),
		);
	}

	async function addSequenceSources(files: File[]) {
		// Single mode's pool is session-scoped: no song to persist under.
		const added = await sourceRegistry.add(files, {
			persist: isSequenceMode,
		});
		const skipped = files.length - added.length;
		if (skipped > 0) {
			showToast(
				`Skipped ${skipped} file${skipped === 1 ? "" : "s"} that couldn't be decoded`,
				"error",
			);
		}
		return added;
	}

	let showClearSourcesConfirm = $state(false);

	/** Empty the pool; clips that drew from it lose their media, deleted from storage too. */
	function clearSequenceSources() {
		showClearSourcesConfirm = false;
		for (const src of sequenceSources) {
			setMediaTimeline(detachMediaSource(mediaTimeline, src.id));
		}
		sourceRegistry.clear();
		restoreAttempted.clear();
	}

	/** Clips pointing at a removed source draw nothing; an empty pool shows the placeholder. */
	function removeSequenceSource(id: string) {
		sourceRegistry.remove(id);
		setMediaTimeline(detachMediaSource(mediaTimeline, id));
	}

	/** Grid replaces the preview while the pool is arranged; the timeline stays under it. */
	let sequenceView = $state<"preview" | "grid">("preview");
	let sequenceGridOpen = $derived(isSequenceMode && sequenceView === "grid");

	// Starting playback from the grid means the user wants to watch it, so leave the grid.
	$effect(() => {
		if (isSequenceMode && seqPlaying()) sequenceView = "preview";
	});

	function seqPlaying(): boolean {
		if (isSequenceMode) return mixer.playing;
		return seqMasterIsAudio ? audio.audioPlaying : videoIsPlaying;
	}

	const mediaLayers = new MediaLayerDriver({
		registry: sourceRegistry,
		getRenderer: () => glRenderer,
		onUpload: bumpSourceTick,
	});

	/** Media length per pool source, for sampling keyed edits once a clip has looped. */
	let sourceDurations = $derived(
		Object.fromEntries(sequenceSources.map((s) => [s.id, s.duration])),
	);

	// A rebuilt renderer (context loss) has blank layer textures; make the driver re-upload.
	$effect(() => {
		glRenderer;
		mediaLayers.invalidate();
	});

	/** The frame's size; with no media of its own the base takes the first source's size. */
	let seqBaseSize = $state<{ width: number; height: number } | null>(null);
	$effect(() => {
		if (!isSequenceMode) return;
		if (sequenceSources.length === 0) {
			seqBaseSize = null;
			return;
		}
		if (seqBaseSize) return;
		const first = sequenceSources[0];
		if (first.width && first.height) {
			seqBaseSize = { width: first.width, height: first.height };
		}
	});
	/** Sequence mode: set once the project knows its length; nothing saves before. */
	let projectReady = $state(false);
	/** A project still working out its length, from its song and its opened media. */
	let pendingInit = $state<{ key: string; seed: boolean } | null>(null);
	/** Length a new project takes when nothing else gives it one. */
	const DEFAULT_PROJECT_LENGTH = 30;

	// Ready means it saves from here on, so a reload can come back to it.
	$effect(() => {
		if (isSequenceMode && projectReady && projectKey) {
			rememberLastOpened({ mode: "sequence", key: projectKey });
		}
	});

	// Opening a project: its saved timeline, or a fresh one seeded from the opened file.
	let projectLoadedFor: string | null = null;
	$effect(() => {
		if (!isSequenceMode) return;
		const key = projectKey;
		if (!key || key === projectLoadedFor) return;
		projectLoadedFor = key;
		void loadProject(key);
	});

	async function loadProject(key: string) {
		const storeKey = seqKeyPrefix + key;
		loadedTimelineKey = null;
		projectReady = false;
		const saved = await loadSeqEntry(key);
		if (seqStoreKey !== storeKey) return;
		loadedTimelineKey = storeKey;
		if (saved === null) {
			// Named after its song, else what it was opened with, until the user names it.
			if (key.startsWith("proj-") && !readProjectNames()[key]) {
				setProjectName(key, initialAudioFile?.name ?? file.name);
			}
			pendingInit = { key: storeKey, seed: true };
			return;
		}
		restoreSequenceBpm(saved.bpm ?? 0);
		restoreFxLanes(saved.fx);
		restoreTextTimeline(saved.text);
		restoreMediaTimeline(saved.media);
		sourceRegistry.restoreEdits(saved.sourceEdits);
		legacySegments = saved.segments?.length
			? { key: storeKey, segments: saved.segments }
			: null;
		const length = saved.length ?? 0;
		if ((saved.v ?? 0) < 3 || length <= 0) {
			// Saved while the song was the clock: it becomes a lane once its length is known.
			pendingInit = { key: storeKey, seed: false };
			return;
		}
		mixer.setDuration(length);
		if (saved.span && saved.span.end > saved.span.start) {
			mixer.spanStart = saved.span.start;
			mixer.spanEnd = Math.min(saved.span.end, length);
		}
		if (saved.song !== undefined && saved.song !== currentTrackId) {
			await loadSong(saved.song);
		}
		mixSpanHistory.reset();
		projectReady = true;
	}

	// The song's length and the opened file are what a project without one is sized by.
	$effect(() => {
		const pending = pendingInit;
		if (!pending || pending.key !== seqStoreKey) return;
		audioBank.version;
		// A song handed in without a library id gets one first; it's keyed by that.
		if (audio.trackFile && !currentTrackId) return;
		const songId = songSourceId;
		let songLength = 0;
		if (songId) {
			const buffer = audioBank.buffer(songId);
			if (!buffer && !audioBank.isSilent(songId)) return;
			songLength = buffer?.duration ?? 0;
		}
		const first = sourceRegistry.get(stableSourceId(file)) ?? null;
		// An opened file that never decoded won't seed anything; don't wait on it forever.
		if (pending.seed && !first && !mountMediaDone) return;
		pendingInit = null;
		untrack(() =>
			finishProjectInit(pending.seed ? first : null, songId, songLength),
		);
	});

	/** The latest clip end on any lane. */
	function timelineContentEnd(): number {
		let end = audioLanesEnd(mediaTimeline.audioLanes);
		for (const lane of [
			...mediaTimeline.lanes,
			...textTimeline.lanes,
			...fxLanes,
		]) {
			for (const clip of lane.clips) end = Math.max(end, clip.end);
		}
		return end;
	}

	function finishProjectInit(
		seedFrom: SequenceSource | null,
		songId: string | null,
		songLength: number,
	) {
		const contentEnd = timelineContentEnd();
		const length =
			songLength > 0
				? songLength
				: contentEnd > 0
					? contentEnd
					: seedFrom && seedFrom.duration > 0
						? seedFrom.duration
						: DEFAULT_PROJECT_LENGTH;
		mixer.setDuration(length);
		// Before v3 the span was kept per song.
		const savedSpan = currentTrackId ? spanStore.load(currentTrackId) : null;
		if (savedSpan && savedSpan.spanEnd > savedSpan.spanStart) {
			mixer.spanStart = Math.min(savedSpan.spanStart, length);
			mixer.spanEnd = Math.min(savedSpan.spanEnd, length);
		} else {
			mixer.spanStart = 0;
			mixer.spanEnd = length;
		}
		let next = mediaTimeline;
		const lanes = next.audioLanes ?? [];
		if (
			songId &&
			songLength > 0 &&
			!lanes.some((l) => l.clips.some((c) => c.sourceId === songId))
		) {
			const lane = createAudioLane(nextAudioLaneName(lanes), true);
			lane.clips = [createAudioClip(0, Math.min(songLength, length), songId)];
			next = { ...next, audioLanes: [lane, ...lanes] };
		}
		if (seedFrom && next.lanes.length === 0) {
			const lane = createMediaLane("Layer 1", seedFrom.id, 0);
			lane.underEffects = true;
			lane.clips = [createMediaClip(0, length)];
			// Under a song the opened video is a backdrop; its own sound would fight it.
			if (songId && lane.audio) lane.audio = { ...lane.audio, muted: true };
			next = { ...next, enabled: true, lanes: [lane] };
		}
		mediaTimeline = next;
		mediaHistory.reset();
		mixSpanHistory.reset();
		projectReady = true;
	}

	// Every lane's sound, planned once for the mixer, the waveforms and the export.
	/** Pool videos and their length: the sources that can carry sound. */
	let videoLengths = $derived(
		Object.fromEntries(
			sequenceSources
				.filter((s) => s.kind === "video" && s.duration > 0)
				.map((s) => [s.id, s.duration]),
		),
	);
	/** Decoded library tracks on the audio lanes, by length: looping clips wrap there. */
	let trackLengths = $derived.by(() => {
		audioBank.version;
		const lengths: Record<string, number> = {};
		for (const lane of mediaTimeline.audioLanes ?? []) {
			for (const clip of lane.clips) {
				const id = clip.sourceId;
				const buffer = id && trackIdOf(id) ? audioBank.buffer(id) : null;
				if (id && buffer) lengths[id] = buffer.duration;
			}
		}
		return lengths;
	});
	let songSourceId = $derived(
		isSequenceMode && currentTrackId ? trackSourceId(currentTrackId) : null,
	);
	let mixPlan = $derived.by(() =>
		isSequenceMode
			? planMix({
					timeline: mediaTimeline,
					edits: sourceRegistry.edits,
					videos: videoLengths,
					tracks: trackLengths,
					// The library's loudness match applies to the song, as it did when it played alone.
					sourceGains: songSourceId
						? { [songSourceId]: audio.normalizeGain }
						: undefined,
				})
			: [],
	);
	$effect(() => {
		if (isSequenceMode) mixer.setPlan(mixPlan);
	});
	$effect(() => {
		if (!isSequenceMode) return;
		const ids = planSourceIds(mixPlan);
		if (songSourceId) ids.push(songSourceId);
		audioBank.ensure(ids);
	});

	const peaksOf = (id: string) => audioBank.peaks(id);

	/** Names of library tracks on the lanes, filled in as they're looked up. */
	let audioTrackNames = $state<Record<string, string>>({});
	$effect(() => {
		for (const lane of mediaTimeline.audioLanes ?? []) {
			for (const clip of lane.clips) {
				const trackId = clip.sourceId ? trackIdOf(clip.sourceId) : null;
				if (!trackId || untrack(() => audioTrackNames[trackId])) continue;
				void getTrack(trackId).then((t) => {
					if (t) audioTrackNames = { ...audioTrackNames, [trackId]: t.name };
				});
			}
		}
	});

	/** Where an audio clip's sound starts over: a video's always wraps, a track's when looped. */
	function audioClipRepeats(clip: AudioClip): number[] {
		const id = clip.sourceId;
		if (!id) return [];
		const videoLength = videoLengths[id];
		if (videoLength) {
			return videoClipRepeats(sourceRegistry.edits[id], videoLength, clip);
		}
		const trackLength = trackLengths[id];
		return clip.loop && trackLength ? trackClipRepeats(clip, trackLength) : [];
	}

	/** Where an audio clip's sound runs out, for its edges to snap to. */
	function audioSourceEnds(clip: AudioClip, until: number): number[] {
		const id = clip.sourceId;
		if (!id) return [];
		const videoLength = videoLengths[id];
		if (videoLength) {
			return videoSourceEnds(
				sourceRegistry.edits[id],
				videoLength,
				clip,
				until,
			);
		}
		return trackSourceEnds(clip, trackLengths[id] ?? 0, until);
	}

	/** A lane-ready name for an audio source. */
	function audioSourceName(id: string | null): string {
		if (!id) return "No sound";
		const trackId = trackIdOf(id);
		if (trackId) return audioTrackNames[trackId] ?? "Audio";
		return sourceRegistry.get(id)?.name ?? "Missing media";
	}

	/** Load a library track as the song, or drop the song for null. */
	async function loadSong(trackId: string | null) {
		if (!trackId) {
			dropSong();
			return;
		}
		const track = await getTrack(trackId).catch(() => null);
		if (!track) return;
		setSong(
			new File([track.blob], track.name, { type: track.blob.type }),
			trackId,
		);
	}

	/** The project's song: the BPM source, and the track the library shows as loaded. */
	function setSong(songFile: File, trackId: string) {
		audio.trackFile = songFile;
		currentTrackId = trackId;
	}

	function dropSong() {
		audio.clearTrack();
		currentTrackId = null;
		sequenceBpm = 0;
	}

	/** Sequence mode: sound files onto lanes. The first becomes the song when there's none. */
	async function addAudioFiles(files: File[]) {
		const at = timelineAxis?.staticTime ?? 0;
		for (const f of files) {
			let track;
			try {
				track = await addTrack(f);
			} catch (e) {
				console.error("Failed to store track:", e);
				showToast(`Couldn't store "${f.name}"`, "error");
				continue;
			}
			const sourceId = trackSourceId(track.id);
			const isSong = !audio.trackFile;
			if (isSong) setSong(f, track.id);
			await audioBank.settle([sourceId]);
			const buffer = audioBank.buffer(sourceId);
			if (!buffer) {
				showToast(`"${f.name}" has no sound that could be decoded`, "error");
				if (isSong) dropSong();
				continue;
			}
			placeAudio(sourceId, buffer.duration, isSong ? 0 : at, isSong);
		}
	}

	/** A new lane holding one clip of `sourceId` from `at`. The first music into a project
	 * with no sound yet grows it to fit, and stretches a backdrop that filled it. */
	function placeAudio(
		sourceId: string,
		length: number,
		at: number,
		drives: boolean,
	) {
		const lanes = mediaTimeline.audioLanes ?? [];
		if (lanes.length >= MAX_AUDIO_LANES) {
			showToast(`${MAX_AUDIO_LANES} audio lanes is the limit`, "error");
			return;
		}
		pushMediaHistory();
		let next = mediaTimeline;
		const before = mixer.duration;
		if (drives && lanes.length === 0 && length > before) {
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
		}
		const duration = mixer.duration;
		const start = Math.min(at, Math.max(0, duration - MIN_CLIP_LENGTH));
		const lane = createAudioLane(nextAudioLaneName(lanes), drives);
		lane.clips = [
			createAudioClip(start, Math.min(duration, start + length), sourceId),
		];
		setMediaTimeline({
			...next,
			audioLanes: drives ? [lane, ...lanes] : [...lanes, lane],
		});
		selectedAudioClipId = lane.clips[0].id;
		selectedAudioClipIds = [lane.clips[0].id];
	}

	/** A lane with no sound yet, for clips pasted or dragged in from another. */
	function addEmptyAudioLane() {
		const lanes = mediaTimeline.audioLanes ?? [];
		if (lanes.length >= MAX_AUDIO_LANES) return;
		pushMediaHistory();
		setMediaTimeline({
			...mediaTimeline,
			audioLanes: [...lanes, createAudioLane(nextAudioLaneName(lanes))],
		});
	}

	/** The library picked a song: it takes the old one's clips, or a lane of its own. */
	function replaceSong(songFile: File, trackId: string) {
		if (trackId === currentTrackId) return;
		const from = songSourceId;
		const to = trackSourceId(trackId);
		sequenceBpm = 0;
		setSong(songFile, trackId);
		const lanes = mediaTimeline.audioLanes ?? [];
		if (from && lanes.some((l) => l.clips.some((c) => c.sourceId === from))) {
			pushMediaHistory();
			setMediaTimeline({
				...mediaTimeline,
				audioLanes: retargetAudioSource(lanes, from, to),
			});
			return;
		}
		void audioBank.settle([to]).then(() => {
			const buffer = audioBank.buffer(to);
			if (buffer && currentTrackId === trackId) {
				placeAudio(to, buffer.duration, 0, true);
			}
		});
	}

	/** A track already on the lanes becomes the song, the one the BPM is measured from.
	 * Unlike replaceSong, every clip stays where it is. */
	async function setBpmSource(sourceId: string) {
		const trackId = trackIdOf(sourceId);
		if (!trackId || trackId === currentTrackId) return;
		const track = await getTrack(trackId).catch(() => null);
		if (!track) {
			showToast("That track is no longer in the library", "error");
			return;
		}
		// Zero, so the new song is measured rather than keeping the old one's tempo.
		sequenceBpm = 0;
		setSong(
			new File([track.blob], track.name, { type: track.blob.type }),
			trackId,
		);
	}

	/** Unloading the song takes its clips off the lanes too. */
	function removeSong() {
		const id = songSourceId;
		const lanes = mediaTimeline.audioLanes ?? [];
		if (id && lanes.some((l) => l.clips.some((c) => c.sourceId === id))) {
			pushMediaHistory();
			setMediaTimeline({
				...mediaTimeline,
				audioLanes: removeAudioSource(lanes, id),
			});
		}
		dropSong();
	}

	/** The project's length, set by hand. Shorter cuts clips straddling the new end
	 * back to it, undoably, so their edge stays in reach; clips wholly past it are kept. */
	function setProjectLength(length: number) {
		pauseTrack();
		const next = Math.max(1, length);
		if (next < mixer.duration) {
			const trim = <L extends ClipLane<TimelineClip>>(lanes: L[]) =>
				lanes.map((l) => trimClipsAt<TimelineClip, L>(l, next));
			const media = trim(mediaTimeline.lanes);
			const audioLanes = trim(mediaTimeline.audioLanes ?? []);
			if (
				media.some((l, i) => l !== mediaTimeline.lanes[i]) ||
				audioLanes.some((l, i) => l !== mediaTimeline.audioLanes?.[i])
			) {
				pushMediaHistory();
				setMediaTimeline({ ...mediaTimeline, lanes: media, audioLanes });
			}
			const text = trim(textTimeline.lanes);
			if (text.some((l, i) => l !== textTimeline.lanes[i])) {
				pushTextHistory();
				setTextTimeline({ ...textTimeline, lanes: text });
			}
			const fx = trim(fxLanes);
			if (fx.some((l, i) => l !== fxLanes[i])) {
				pushFxHistory();
				setFxLanes(fx);
			}
		}
		mixer.setDuration(next);
	}

	/** Detach a video clip's sound onto an audio lane of its own. */
	function detachClipAudio(clipId: string) {
		const lane = findMediaClipLane(mediaTimeline, clipId);
		const clip = lane?.clips.find((c) => c.id === clipId);
		const sourceId = lane && clip ? clipSourceId(lane, clip) : null;
		if (!lane || !clip || !sourceId) return;
		const lanes = mediaTimeline.audioLanes ?? [];
		// The first free-standing lane with room takes it; otherwise a new one does.
		const fits = (l: AudioLane) =>
			l.clips.every((c) => c.end <= clip.start || c.start >= clip.end);
		const target = lanes.find((l) => !l.drives && fits(l));
		if (!target && lanes.length >= MAX_AUDIO_LANES) {
			showToast(`${MAX_AUDIO_LANES} audio lanes is the limit`, "error");
			return;
		}
		const detached = {
			...createAudioClip(clip.start, clip.end, sourceId, clip.sourceStart),
			gain: clip.gain,
			fadeInSec: clip.fadeInSec,
			fadeOutSec: clip.fadeOutSec,
		};
		const audioLanes = target
			? lanes.map((l) =>
					l.id === target.id
						? {
								...l,
								clips: [...l.clips, detached].sort((a, b) => a.start - b.start),
							}
						: l,
				)
			: [
					...lanes,
					{ ...createAudioLane(nextAudioLaneName(lanes)), clips: [detached] },
				];
		pushMediaHistory();
		setMediaTimeline({
			...updateMediaLaneIn(mediaTimeline, lane.id, (l) => ({
				...l,
				clips: l.clips.map((c) =>
					c.id === clipId ? { ...c, audioDetached: true } : c,
				),
			})),
			audioLanes,
		});
	}

	/** What is on screen now: the main chain, then each fx lane's in lane order. */
	let renderedEffects = $derived.by(() =>
		fxChain.length === 0 ? effects : [...effects, ...fxChain],
	);
	// A preset overwritten in the panel; overwriting never re-assigns it, so this isn't an edit.
	function seqSyncPreset(preset: Preset) {
		mediaTimeline = syncMediaClipsToPreset(mediaTimeline, preset);
		textTimeline = syncTextClipsToPreset(textTimeline, preset);
		fxLanes = syncFxClipsToPreset(fxLanes, preset);
	}

	// A hand-edit to a preset-filled fx clip: the label gains a "*".
	function markPanelClipEdited() {
		const target = selectedFxClip;
		if (!target) return;
		// A hand-built chain takes its name from what it switches on.
		if (isHandBuiltLabel(target)) target.label = handBuiltLabel(target.effects);
		else if (!target.modified) target.modified = true;
	}

	/** The selected fx clip's chain, or single mode's main chain. */
	function getPanelEffects(): EffectInstance[] {
		return selectedFxClip?.effects ?? effects;
	}

	/** Sequence mode only: with nothing selected the rack has no chain to edit. */
	let panelNoTarget = $derived.by(() => {
		if (!isSequenceMode || selectedFxClip) return null;
		return {
			title: "Nothing selected",
			hint: "Click a layer clip or an FX clip on the timeline to edit its chain.",
		};
	});

	/** The selected fx clip when it rolls its own chain (interval mode). */
	let panelIntervalClip = $derived(
		selectedFxClip?.mode === "interval" ? selectedFxClip : null,
	);

	/** An interval clip rolls its own chain, so the switches would be overwritten next tick. */
	let panelRolledNote = $derived(
		panelIntervalClip
			? "Auto clip re-rolls its own mosh on an interval, so the switches follow it. Lock an effect to keep it through every roll, hide one to keep it out, or switch the clip to Static in the clip bar to build a chain by hand."
			: null,
	);

	function setPanelEffects(v: EffectInstance[]) {
		const clip = selectedFxClip;
		if (clip) clip.effects = v;
		else effects = v;
	}

	/** Extra tries a curated roll gets when the preview comes out dead. */
	const DEAD_ROLL_RETRIES = 4;
	let glCanvasRef: GlCanvas | undefined = $state(undefined);

	/** Roll; in curated style, roll again while the preview comes out black, white,
	 * flat or noise. The last try stands either way. */
	function rollAlive(roll: () => void) {
		glCanvasRef?.dismissHighlight();
		roll();
		if (moshStyle !== "curated") return;
		for (let i = 0; i < DEAD_ROLL_RETRIES; i++) {
			if (!glCanvasRef?.frameLooksDeadNow()) return;
			roll();
		}
	}

	const moshSession = createMoshSession({
		getEffects: () => effects,
		setEffects: (v) => (effects = v),
		getMoshOptions,
		rollAlive,
		cancelBurst: () => panelBurst.cancel(),
		endBurst: () => panelBurst.end(),
	});

	// An fx clip edit records into the fx stack, any other into the single-mode history.
	/** Which stack the open burst will land on. */
	let burstOwner: "fx" | "chain" | null = null;
	const panelBurst = new PanelBurstController({
		onEditStart: () => {
			// An fx clip edit belongs to the fx stack, so Ctrl+Z steps back the tweak.
			if (selectedFxClip) {
				burstOwner = "fx";
				pushFxHistory();
				return;
			}
			burstOwner = "chain";
			return () => moshSession.pushEdit(effects);
		},
	});
	const endPanelBurst = () => panelBurst.end();
	/** The fx clip as it stood before the panel's current edit, to replay it on the rest of the selection. */
	let fxEditBase: FxClip | null = null;
	const panelBeforeEdit = (coalesceKey?: string) => {
		fxEditBase = selectedFxClip
			? ($state.snapshot(selectedFxClip) as FxClip)
			: null;
		panelBurst.beforeEdit(coalesceKey);
	};

	/** The panel edits the fx clip in place; carry the edit to the other selected clips. */
	function fanOutFxEdit() {
		const clip = selectedFxClip;
		const base = fxEditBase;
		if (!clip || base?.id !== clip.id) return;
		const after = $state.snapshot(clip) as FxClip;
		fxEditBase = after;
		const others = fxClipsById(new Set(selectedFxClipIds)).filter(
			(c) => c.id !== clip.id,
		);
		const fanned = fanOutEdit(base, after, $state.snapshot(others) as FxClip[]);
		if (fanned.length === 0) return;
		const byId = new Map(fanned.map((c) => [c.id, c]));
		fxLanes = fxLanes.map((l) => ({
			...l,
			clips: l.clips.map((c) => byId.get(c.id) ?? c),
		}));
	}

	// Same detector the slideshow uses: essentia's RhythmExtractor2013 in a shared worker.
	let bpmDetecting = $state(false);
	let bpmDetectAbort: AbortController | null = null;
	let bpmDetectFile: File | null = null;
	/** Bumped when the BPM is settled elsewhere; a detection that started before yields to it. */
	let bpmEpoch = 0;
	/** The track the automatic pass has already been spent on. */
	let autoBpmFor: File | null = null;

	// A new track detects its own tempo: clip timing and beat-synced effects need it.
	$effect(() => {
		const file = audio.trackFile;
		if (!file) return;
		untrack(() => {
			if (autoBpmFor === file) return;
			autoBpmFor = file;
			// A song reopened from the library brings its own BPM back.
			if (sequenceBpm > 0) return;
			void runSequenceBpmDetection(true);
		});
	});

	async function runSequenceBpmDetection(auto = false) {
		const file = audio.trackFile;
		if (!file || (bpmDetecting && bpmDetectFile === file)) return;
		// A pass still measuring the previous song is moot.
		bpmDetectAbort?.abort();
		const abort = new AbortController();
		bpmDetectAbort = abort;
		bpmDetectFile = file;
		const epoch = bpmEpoch;
		bpmDetecting = true;
		try {
			const result = await detectBpm(file, abort.signal);
			// The automatic pass never overrules what landed while it ran.
			if (auto && (bpmEpoch !== epoch || audio.trackFile !== file)) return;
			setSequenceBpm(Math.round(result.bpm));
		} catch (e) {
			if (!(e instanceof DOMException && e.name === "AbortError")) {
				console.error("BPM detection failed:", e);
				showToast(
					"Couldn't detect the BPM for this track. Set it by hand instead.",
					"error",
					6000,
				);
			}
		} finally {
			if (bpmDetectAbort === abort) {
				bpmDetecting = false;
				bpmDetectAbort = null;
				bpmDetectFile = null;
			}
		}
	}

	/** Correcting the BPM retimes every clip whose spacing was set in beats. */
	function setSequenceBpm(bpm: number) {
		bpmEpoch++;
		sequenceBpm = bpm;
		const retimedFx = applyBpmToFxLanes(fxLanes, bpm);
		if (retimedFx !== fxLanes) {
			pushFxHistory();
			fxLanes = retimedFx;
		}
		const retimedMedia = applyBpmToMediaClips(mediaTimeline, bpm);
		if (retimedMedia !== mediaTimeline) {
			pushMediaHistory();
			mediaTimeline = retimedMedia;
		}
		const retimedText = applyBpmToTextClips(textTimeline, bpm);
		if (retimedText !== textTimeline) {
			pushTextHistory();
			textTimeline = retimedText;
		}
	}

	function playSpan() {
		if (isSequenceMode) {
			// Playback starts at the static marker, not wherever the clock last stopped.
			if (timelineAxis && !mixer.playing) mixer.seek(timelineAxis.staticTime);
			mixer.play();
			return;
		}
		if (timelineAxis && !audio.audioPlaying)
			audio.seekTo(timelineAxis.staticTime);
		audio.playAudio();
		if (isVideo) playVideo();
	}

	/** Clips of any lane kind the preview goes round, spanning first start to last end. */
	let repeatClipIds = $state<string[]>([]);
	let repeatRange = $derived.by(() => {
		if (repeatClipIds.length === 0) return null;
		const ids = new Set(repeatClipIds);
		let start = Infinity;
		let end = -Infinity;
		const lanes: { clips: TimelineClip[] }[] = [
			...mediaTimeline.lanes,
			...(mediaTimeline.audioLanes ?? []),
			...textTimeline.lanes,
			...fxLanes,
		];
		for (const lane of lanes) {
			for (const c of lane.clips) {
				if (!ids.has(c.id)) continue;
				start = Math.min(start, c.start);
				end = Math.max(end, c.end);
			}
		}
		end = Math.min(end, seqMasterDuration);
		return end > start ? { start, end } : null;
	});
	$effect(() => {
		mixer.repeat = isSequenceMode ? repeatRange : null;
	});
	// Clips deleted or moved past the end take the repeat with them.
	$effect(() => {
		if (repeatClipIds.length > 0 && !repeatRange) repeatClipIds = [];
	});
	// Single mode's clocks have no range of their own: pull them back into it.
	$effect(() => {
		const range = repeatRange;
		if (isSequenceMode || !range) return;
		const t = seqMasterTime();
		if (t < range.start - 0.05 || t >= range.end) seekMaster(range.start);
	});

	function masterPlaying(): boolean {
		if (isSequenceMode) return mixer.playing;
		if (textNeedsTransport) return stillPlaying;
		return seqMasterIsAudio ? audio.audioPlaying : videoIsPlaying;
	}

	/** Repeat these clips, or stop if they're the ones repeating. Starts playback there. */
	function toggleRepeat(clipIds: string[]) {
		const same =
			clipIds.length === repeatClipIds.length &&
			clipIds.every((id) => repeatClipIds.includes(id));
		if (same || clipIds.length === 0) {
			repeatClipIds = [];
			return;
		}
		repeatClipIds = [...clipIds];
		const range = repeatRange;
		if (!range) return;
		// Ahead of the effect, so play() already clamps to the range.
		if (isSequenceMode) mixer.repeat = range;
		seekMaster(range.start);
		if (!masterPlaying()) toggleMasterPlay();
	}

	/** R: the selection, whichever lane it's on. */
	function toggleSelectionRepeat() {
		const ids =
			selectedMediaClipIds.length > 0
				? selectedMediaClipIds
				: selectedTextClipIds.length > 0
					? selectedTextClipIds
					: selectedFxClipIds.length > 0
						? selectedFxClipIds
						: selectedAudioClipIds;
		// R with nothing picked still stops a repeat.
		toggleRepeat(ids.length > 0 ? ids : repeatClipIds);
	}

	function pauseTrack() {
		if (isSequenceMode) {
			mixer.pause();
			return;
		}
		audio.pauseAudio();
		if (isVideo) pauseVideo();
	}

	/** True while the media edit modal is up. */
	let sourceEditOpen = $state(false);

	/** The modal has its own transport, so the preview stops while it is up. */
	function onSourceEditingChange(open: boolean) {
		sourceEditOpen = open;
		if (open) pauseTrack();
	}

	function seekTo(t: number) {
		if (isSequenceMode) mixer.seek(t);
		else audio.seekTo(t);
	}

	let moshGroupRef: MoshGroup | undefined = $state(undefined);
	// svelte-ignore non_reactive_update
	let recordGroupRef: RecordGroup | undefined = undefined;
	let trackLibraryRef: TrackLibrary | undefined = undefined;

	/** → : forward through the mosh history, rolling a new mosh at its top. */
	function mosh() {
		glCanvasRef?.dismissHighlight();
		// A layer's panel has taken the sidebar over, so the arrows belong to its chain.
		const mediaClip = selectedMediaClip;
		if (mediaClip) {
			const snap = mediaMoshHistory.redo(mediaClip.id);
			if (snap) applyMediaClipMosh(mediaClip.id, snap);
			else mediaRoll([mediaClip.id]);
			return;
		}
		const textClip = selectedTextClip;
		if (textClip) {
			const snap = textMoshHistory.redo(textClip.id);
			if (snap) applyTextClipMosh(textClip.id, snap);
			else textRoll([textClip.id]);
			return;
		}
		// A selected fx clip is what every panel action aims at, so a mosh means it.
		const clip = activeFxClip();
		if (clip) {
			const snap = fxMoshHistory.redo(clip.id);
			if (snap) applyFxClipMosh(clip.id, snap);
			else fxRoll([clip.id]);
			return;
		}
		// Sequence mode: every chain lives on a clip, so with nothing selected the arrows do nothing.
		if (isSequenceMode) return;
		moshSession.forward();
	}

	/** ← : back through the mosh history. Never touches the edit history. */
	function undoMosh() {
		glCanvasRef?.dismissHighlight();
		const mediaClip = selectedMediaClip;
		if (mediaClip) {
			const snap = mediaMoshHistory.undo(mediaClip.id);
			if (snap) applyMediaClipMosh(mediaClip.id, snap);
			return;
		}
		const textClip = selectedTextClip;
		if (textClip) {
			const snap = textMoshHistory.undo(textClip.id);
			if (snap) applyTextClipMosh(textClip.id, snap);
			return;
		}
		const clip = activeFxClip();
		if (clip) {
			const snap = fxMoshHistory.undo(clip.id);
			if (snap) applyFxClipMosh(clip.id, snap);
			return;
		}
		if (isSequenceMode) return;
		moshSession.back();
	}

	// Ctrl+Z/Y: hand-edits only, across every stack the editor owns; the newest edit wins.
	const fxUndo = snapshotUndoSource(
		fxHistory,
		() => $state.snapshot(fxLanes) as FxLane[],
		setFxLanes,
		() => burstOwner === "fx" && panelBurst.open,
	);
	// Built per press: the text and media stacks are declared further down.
	const undoSources = (): UndoSource[] => [
		isSequenceMode ? mixSpanHistory.undoSource : spanHistory.undoSource,
		snapshotUndoSource(
			textHistory,
			() => $state.snapshot(textTimeline) as TextTimeline,
			setTextTimeline,
		),
		snapshotUndoSource(
			mediaHistory,
			() => $state.snapshot(mediaTimeline) as MediaTimeline,
			setMediaTimeline,
		),
		{
			...fxUndo,
			undo: () => {
				endPanelBurst();
				fxUndo.undo();
			},
		},
		{
			get undoSeq() {
				// A burst inside its coalescing window hasn't reached its stack yet.
				return burstOwner === "chain" && panelBurst.open
					? PENDING_EDIT
					: moshSession.undoSeq;
			},
			get redoSeq() {
				return moshSession.redoSeq;
			},
			undo: () => moshSession.undoEdit(),
			redo: () => moshSession.redoEdit(),
		},
	];

	function undo() {
		undoLatest(undoSources());
	}

	function redo() {
		redoLatest(undoSources());
	}

	function clearEffects() {
		// A selected fx clip is what the panel shows, so it is what a clear means.
		const clip = selectedFxClip;
		if (clip) {
			panelBeforeEdit();
			clearEffectsFn(clip.effects);
			if (isHandBuiltLabel(clip)) clip.label = handBuiltLabel(clip.effects);
			else clip.modified = true;
			fanOutFxEdit();
			return;
		}
		clearEffectsFn(effects);
		moshSession.pushEdit(effects);
	}

	function handleExit() {
		if (!onExit) return;
		if (recordingState.recording) {
			showToast(
				"Cancel or wait for the recording to finish before exiting",
				"error",
			);
			return;
		}
		// No confirm: the work survives the exit either way.
		flushSingleSessionSave();
		onExit();
	}

	/** The preview renders at display resolution, so re-render at the real output size. */
	function captureAtOutputRes(
		time: number,
		capture: (done: () => void) => void,
	) {
		if (!canvasEl || !glRenderer) return;
		const r = glRenderer;
		const prevW = canvasEl.width;
		const prevH = canvasEl.height;
		const needsResize =
			resizeWidth > 0 &&
			resizeHeight > 0 &&
			(resizeWidth !== prevW || resizeHeight !== prevH);
		if (needsResize) {
			r.resize(resizeWidth, resizeHeight);
			r.render(renderedEffects, time);
		}
		capture(() => {
			if (needsResize) {
				r.resize(prevW, prevH);
				r.render(renderedEffects, time);
			}
		});
	}

	/** Bake the current frame into a new source file; destructive, so it hands back an Undo. */
	function reInput() {
		if (!canvasEl) return;
		// Single mode only: sequence draws from a pool of sources through its layers.
		if (isSequenceMode) return;
		const prevFile = file;
		const prevEffects = $state.snapshot(effects) as EffectInstance[];
		captureAtOutputRes(performance.now() / 1000, (done) => {
			canvasEl!.toBlob((blob) => {
				if (!blob) {
					done();
					return;
				}
				const newFile = new File([blob], `openmosh-reinput-${Date.now()}.png`, {
					type: "image/png",
				});
				effects.forEach((e) => (e.enabled = false));
				moshSession.resetEdits(effects);
				// No restore: loading the new file re-initializes the renderer
				onfile(newFile);
				showToast("Using this frame as the new source", "info", 8000, {
					label: "Undo",
					run: () => {
						effects = prevEffects.map(cloneEffectInstance);
						moshSession.resetEdits(effects);
						onfile(prevFile);
					},
				});
			}, "image/png");
		});
	}

	/** The timeline's shared axis, once a stack is mounted. */
	let timelineAxis = $state<TimelineStackState | undefined>(undefined);

	/** The lane list, so the width its own scrollbar takes can be measured. */
	let laneListEl = $state<HTMLElement | null>(null);
	/** What the lane list's vertical scrollbar costs it; zero where scrollbars overlay. */
	let laneScrollbar = $state(0);

	$effect(() => {
		const el = laneListEl;
		if (!el) return;
		const measure = () => (laneScrollbar = el.offsetWidth - el.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(el);
		return () => observer.disconnect();
	});

	/** Which side of the column gets the room is the user's call, and remembered. */
	const SPLIT_KEY = "openmosh-timeline-split";
	/** Enough for the toolbar, the ruler, the selection bar and a lane or two. */
	const SPLIT_MIN = 150;
	/** A lane row is 30px, and the split never leaves less than one of them. */
	const LANE_MIN_H = 30;
	/** What the preview keeps however far the split is dragged. */
	const PREVIEW_MIN = 200;

	function loadSplit(): number | null {
		const raw = readRaw(SPLIT_KEY);
		const px = raw === null ? Number.NaN : Number(raw);
		return Number.isFinite(px) && px > 0 ? px : null;
	}

	/** null is automatic: the stack's own height, under its cap. */
	let timelineSplit = $state<number | null>(loadSplit());
	let splitDragging = $state(false);
	let mainAreaEl = $state<HTMLElement | null>(null);
	let previewSlotEl = $state<HTMLElement | null>(null);

	function splitStack(): HTMLElement | null {
		return mainAreaEl?.querySelector<HTMLElement>(".tl-stack") ?? null;
	}

	/** The tallest the timeline may go: its share of the column, leaving the preview something. */
	function splitCeiling(startSplit: number): number {
		const area = mainAreaEl;
		if (!area) return startSplit;
		const cap = area.clientHeight * 0.45;
		const preview = previewSlotEl;
		const previewH =
			preview && !preview.classList.contains("hidden")
				? preview.getBoundingClientRect().height
				: 0;
		// With the preview away in grid mode there is no floor to keep.
		const byPreview =
			previewH > 0 ? startSplit + Math.max(0, previewH - PREVIEW_MIN) : cap;
		return Math.max(SPLIT_MIN, Math.min(cap, byPreview));
	}

	/** The shortest the timeline may go: its fixed chrome plus one lane showing. */
	function splitFloor(startSplit: number): number {
		const lanes = mainAreaEl?.querySelector<HTMLElement>(".tl-layers");
		const lanesH = lanes?.getBoundingClientRect().height ?? 0;
		return Math.max(SPLIT_MIN, startSplit - lanesH + LANE_MIN_H);
	}

	function commitSplit() {
		writeRaw(SPLIT_KEY, timelineSplit === null ? "" : String(timelineSplit));
	}

	function beginSplitDrag(e: PointerEvent) {
		if (e.button !== 0) return;
		const stack = splitStack();
		if (!stack) return;
		e.preventDefault();
		const startY = e.clientY;
		const startSplit = stack.getBoundingClientRect().height;
		const ceiling = splitCeiling(startSplit);
		const floor = splitFloor(startSplit);
		splitDragging = true;

		const move = (ev: PointerEvent) => {
			const next = startSplit - (ev.clientY - startY);
			timelineSplit = Math.round(Math.min(ceiling, Math.max(floor, next)));
		};
		const up = () => {
			splitDragging = false;
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", up);
			commitSplit();
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", up);
	}

	function resetSplit() {
		timelineSplit = null;
		commitSplit();
	}

	function onSplitKeydown(e: KeyboardEvent) {
		const stack = splitStack();
		if (!stack) return;
		const current = stack.getBoundingClientRect().height;
		const step = e.shiftKey ? 48 : 16;
		const floor = splitFloor(current);
		if (e.key === "ArrowUp") {
			timelineSplit = Math.round(
				Math.min(splitCeiling(current), Math.max(floor, current + step)),
			);
		} else if (e.key === "ArrowDown") {
			timelineSplit = Math.round(Math.max(floor, current - step));
		} else if (e.key === "Home") {
			e.preventDefault();
			resetSplit();
			return;
		} else {
			return;
		}
		e.preventDefault();
		commitSplit();
	}

	/** Lanes folded to a strip; a view choice like solo, not saved. */
	const FOLD_KEY = "openmosh-folded-lanes";
	let foldedLaneIds = $state<Set<string>>(
		new Set(readJson<string[]>(FOLD_KEY, [])),
	);

	function toggleLaneFold(laneId: string) {
		const next = new Set(foldedLaneIds);
		if (next.has(laneId)) next.delete(laneId);
		else next.add(laneId);
		foldedLaneIds = next;
		writeJson(FOLD_KEY, [...next]);
	}

	const handleKeydown = createKeyboardHandler({
		save,
		mosh,
		undoMosh,
		undo,
		redo,
		reInput,
		toggleFullscreen: () => (previewFullscreen = !previewFullscreen),
		toggleFollowPlayhead: () => {
			if (timelineAxis)
				timelineAxis.followPlayhead = !timelineAxis.followPlayhead;
		},
		togglePlay: toggleMasterPlay,
		toggleRepeat: toggleSelectionRepeat,
		splitAtPlayhead: () =>
			timelineAxis?.activeLaneSplitAt?.(timelineAxis.currentTime),
		zoomTimeline: (inward) => timelineAxis?.vp.zoomStep(inward),
	});

	function save() {
		if (!canvasEl) return;
		if (noSequenceMedia) {
			showToast("Add media before saving a frame", "info");
			return;
		}
		const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
		const ext = format === "jpg" ? "jpg" : "png";
		// Image formats render frozen at time 0 (matches the preview's drawFrame)
		captureAtOutputRes(0, (done) => {
			canvasEl!.toBlob(
				(blob) => {
					done();
					if (blob) downloadBlob(blob, ext);
				},
				mimeType,
				format === "jpg" ? 0.92 : undefined,
			);
		});
	}

	let showRecordSettings = $state(false);
	let recordDuration = $state(5);
	let recordFps = $state(60);
	/** Seconds. A ceiling on typos, not a format limit: the encoder has no cap. */
	const MAX_RECORD_DURATION = 600;
	/** A ceiling on typos for the editor's project length. */
	const MAX_PROJECT_LENGTH = 3600;
	/** One click for the lengths people actually reach for. */
	const RECORD_DURATION_PRESETS = [5, 10, 30, 60, 120];

	/** Which project the export settings belong to; `seqStoreKey` carries the mode prefix. */
	let renderKey = $derived(
		seqStoreKey ??
			(isSequenceMode
				? null
				: `single:file:${file.name}:${file.size}:${file.lastModified}`),
	);

	/** The project whose settings are loaded; the save effect waits for it. */
	let renderKeyLoaded = $state<string | null>(null);

	$effect(() => {
		const key = renderKey;
		if (!key || untrack(() => renderKeyLoaded) === key) return;
		untrack(() => {
			renderKeyLoaded = key;
			const saved = loadRenderSettings(key);
			if (saved?.fps) recordFps = saved.fps;
			if (saved?.duration) recordDuration = saved.duration;
			// Falls back to the per-track size store used before the output size lived here.
			const size =
				saved?.width && saved?.height
					? { width: saved.width, height: saved.height }
					: currentTrackId
						? sizeStore.load(currentTrackId)
						: null;
			if (size && size.width > 0 && size.height > 0) {
				resizeWidth = size.width;
				resizeHeight = size.height;
				// Media finishing its load after this would otherwise default the output back to its own size.
				sizeRestoredFromTrack = true;
			}
		});
	});

	$effect(() => {
		const key = renderKey;
		const fps = recordFps;
		const duration = recordDuration;
		const width = resizeWidth;
		const height = resizeHeight;
		// Before this project's values are in, the live ones belong to what was open before.
		if (!key || renderKeyLoaded !== key) return;
		saveRenderSettings(key, {
			fps,
			duration,
			...(width > 0 && height > 0 ? { width, height } : {}),
		});
	});

	// Optional lanes of text clips over the master clock, off until turned on.

	/** Layer lanes are desktop work: the buttons that turn them on aren't offered on a phone. */
	const loadedLayerFlags = { text: false };
	function layersOffOnMobile<T extends { enabled: boolean }>(
		timeline: T,
		kind: keyof typeof loadedLayerFlags,
	): T {
		if (!isMobile) return timeline;
		loadedLayerFlags[kind] = timeline.enabled;
		return { ...timeline, enabled: false };
	}
	function layersAsLoaded<T extends { enabled: boolean }>(
		timeline: T,
		kind: keyof typeof loadedLayerFlags,
	): T {
		if (!isMobile) return timeline;
		return { ...timeline, enabled: loadedLayerFlags[kind] };
	}

	// Seed only: a later change to the prop shouldn't overwrite live edits.
	let textTimeline = $state<TextTimeline>(
		untrack(() =>
			initialSession?.text
				? layersOffOnMobile(normalizeTextTimeline(initialSession.text), "text")
				: { ...EMPTY_TEXT_TIMELINE },
		),
	);
	let selectedTextClipId = $state<string | null>(null);
	let selectedTextClipIds = $state<string[]>([]);
	let lyricsOpen = $state(false);

	// Lanes of media over the master clock, each clip with its own chain; sequence mode only.
	let mediaTimeline = $state<MediaTimeline>(
		untrack(() => ({ ...EMPTY_MEDIA_TIMELINE, enabled: isSequenceMode })),
	);
	let selectedMediaClipId = $state<string | null>(null);
	/** The layer-clip selection, so the media rail can assign to all of it. */
	let selectedMediaClipIds = $state<string[]>([]);

	/** Lane shown by itself on the canvas; not timeline data, so it never persists or exports. */
	let soloMediaLaneId = $state<string | null>(null);

	function toggleMediaSolo(laneId: string) {
		soloMediaLaneId = soloMediaLaneId === laneId ? null : laneId;
	}

	/** Every lane on the stack, whatever kind: the fold-all control works on the lot. */
	let laneIds = $derived([
		...mediaTimeline.lanes.map((lane) => lane.id),
		...(mediaTimeline.audioLanes ?? []).map((lane) => lane.id),
		...textTimeline.lanes.map((lane) => lane.id),
		...fxLanes.map((lane) => lane.id),
	]);

	let allLanesFolded = $derived(
		laneIds.length > 0 && laneIds.every((id) => foldedLaneIds.has(id)),
	);

	function toggleAllFolds() {
		const next = new Set(foldedLaneIds);
		for (const id of laneIds) {
			if (allLanesFolded) next.delete(id);
			else next.add(id);
		}
		foldedLaneIds = next;
		writeJson(FOLD_KEY, [...next]);
	}

	// Solo only counts while its lane is on the stack; the id is kept so undo brings it back.
	let soloLaneId = $derived(
		mediaTimeline.lanes.some((l) => l.id === soloMediaLaneId)
			? soloMediaLaneId
			: null,
	);

	// Sequence mode resumes from its song's pool; single mode saves file and work together.
	let sessionSaveTimer: ReturnType<typeof setTimeout> | undefined;

	/** Single mode keeps an edit once there's something in it; a camera never. Lane
	 * presence, not `enabled`: keying off the visibility toggle would discard hidden timelines. */
	let singleSessionKept = $derived(
		!isSequenceMode &&
			!isLive &&
			(moshSession.touched || textTimeline.lanes.length > 0),
	);

	function saveSingleSession() {
		if (!singleSessionKept) {
			saves.drop("session");
			return;
		}
		const hasText = textTimeline.lanes.length > 0;
		const source = file;
		const state: SingleSessionState = {
			effects: $state.snapshot(effects) as EffectInstance[],
			text: hasText
				? layersAsLoaded($state.snapshot(textTimeline) as TextTimeline, "text")
				: null,
		};
		// Keyed by the song when there is one, alongside the text timeline and span.
		const write = saveSession("single", [source], state, currentTrackId).catch(
			(e) => {
				// Logged, not swallowed: a silent failure here is invisible.
				if (import.meta.env.DEV) console.error("Session save failed:", e);
				return false;
			},
		);
		void saves.track("session", write).then((ok) => {
			if (ok) void pruneSequenceMedia().catch(() => {});
		});
	}

	$effect(() => {
		if (isSequenceMode) return;
		// Skipped while playing, like the sequence save: the volume-link tick mutates `effects`.
		if (audio.audioPlaying || videoIsPlaying) return;
		// Deep-read, discarded: naming `effects` alone subscribes to the reference, not its contents.
		$state.snapshot(effects);
		$state.snapshot(textTimeline);
		file;
		// Loading a different song re-keys the session, so it has to re-save.
		currentTrackId;
		if (!singleSessionKept) return;
		clearTimeout(sessionSaveTimer);
		untrack(() => saves.schedule("session"));
		sessionSaveTimer = setTimeout(saveSingleSession, 600);
		return () => clearTimeout(sessionSaveTimer);
	});

	/** Why the top bar says this edit isn't kept, when it isn't. */
	let notSaved = $derived.by(() => {
		if (isSequenceMode) return null;
		if (isLive) {
			return {
				reason:
					"A live camera feed isn't saved. Take a snapshot to keep working on a frame.",
				warn: true,
			};
		}
		if (!singleSessionKept) {
			return {
				reason:
					"Nothing to keep yet. Change an effect or add text and this edit is saved in this browser.",
				warn: false,
			};
		}
		return null;
	});

	/** Backing out shouldn't race the debounce and lose the last edit. */
	function flushSingleSessionSave() {
		clearTimeout(sessionSaveTimer);
		saveSingleSession();
	}

	const shortcutGroups = $derived(
		editorShortcutGroups({
			sequence: isSequenceMode,
			text: textTimeline.enabled,
			media: mediaTimeline.enabled,
		}),
	);

	// A still image with no track has no clock, so the text timeline supplies one.
	let stillClock = $state(0);
	let stillPlaying = $state(false);
	/** Bumped on every seek, so the running loop re-anchors on the new time. */
	let stillSeekTick = $state(0);

	let textDuration = $derived(
		seqMasterDuration > 0 ? seqMasterDuration : recordDuration,
	);
	/** True when nothing else owns a playhead, so the text ruler grows one. */
	let textNeedsTransport = $derived(!isSequenceMode && seqMasterDuration <= 0);
	let textTime = $derived(textNeedsTransport ? stillClock : seqMasterTime());
	// An export's frame 0 is not the master clock's zero; it starts at the audio span.
	let textTimeOffset = $derived(
		isSequenceMode
			? mixer.spanStart
			: audio.trackFile && audio.trackDuration > 0
				? audio.spanStart
				: isVideo && videoDuration > 0
					? videoSpanStart
					: 0,
	);
	let textTimeScale = $derived(
		!audio.trackFile && isVideo && videoDuration > 0 ? videoSpeed : 1,
	);
	let textClockRunning = $derived(
		isSequenceMode
			? mixer.playing
			: textNeedsTransport
				? stillPlaying
				: audio.audioPlaying || videoIsPlaying,
	);

	// Every lane shares the master clock's axis; a video under its own span is a second clock.
	let showVideoBar = $derived(
		isVideo && videoDuration > 0 && !(isSequenceMode && seqMasterIsAudio),
	);
	let videoIsMaster = $derived(showVideoBar && !seqMasterIsAudio);
	let audioIsMaster = $derived(audio.trackFile && audio.trackDuration > 0);
	let showStack = $derived(
		isSequenceMode
			? seqMasterDuration > 0
			: textDuration > 0 &&
					(textTimeline.enabled ||
						mediaTimeline.enabled ||
						videoIsMaster ||
						audioIsMaster),
	);

	function toggleMasterPlay() {
		if (isSequenceMode) {
			if (mixer.playing) pauseTrack();
			else playSpan();
		} else if (textNeedsTransport) {
			stillPlaying = !stillPlaying;
		} else if (seqMasterIsAudio) {
			if (audio.audioPlaying) pauseTrack();
			else playSpan();
		} else if (videoIsPlaying) {
			pauseVideo();
		} else {
			playVideo();
		}
	}

	function seekMaster(t: number) {
		if (isSequenceMode) {
			mixer.seek(t);
		} else if (textNeedsTransport) {
			stillClock = t;
			stillSeekTick++;
		} else if (seqMasterIsAudio) seekTo(t);
		else seekVideoTo(t);
	}

	function toggleMasterLoop() {
		if (isSequenceMode) mixer.loop = !mixer.loop;
		else if (seqMasterIsAudio) audio.loopAudio = !audio.loopAudio;
		else videoLoop = !videoLoop;
	}

	// The lanes' own actions, gathered into one toolbar rather than a header row each.
	let sourceInput = $state<HTMLInputElement | undefined>(undefined);

	function addTextLane() {
		pushTextHistory();
		setTextTimeline(appendTextLane(textTimeline, nextLayerZ(layerOrder)));
	}

	$effect(() => {
		if (!stillPlaying) return;
		// Tracked, so a seek mid-run restarts the loop on the new position.
		stillSeekTick;
		const span = Math.max(0.1, textDuration);
		const started = performance.now() - untrack(() => stillClock) * 1000;
		let raf = requestAnimationFrame(function loop(now) {
			stillClock = ((now - started) / 1000) % span;
			raf = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(raf);
	});

	/** Every layer in both timelines, front first; one order spans the two kinds. */
	let layerOrder = $derived(
		combinedLayerOrder(mediaTimeline.lanes, textTimeline.lanes, fxLanes),
	);

	/** Drop a layer at `toIndex` in the shared stack, whichever timeline holds it. */
	function reorderLayer(laneId: string, toIndex: number, coalesceKey?: string) {
		const moves = moveLayerTo(layerOrder, laneId, toIndex);
		if (!moves) return;
		if (fxLanes.some((l) => moves.some((m) => m.id === l.id))) {
			pushFxHistory(coalesceKey);
			setFxLanes(applyLayerMoves(fxLanes, moves));
		}
		if (mediaTimeline.lanes.length > 0) {
			pushMediaHistory(coalesceKey);
			setMediaTimeline({
				...mediaTimeline,
				lanes: applyLayerMoves(mediaTimeline.lanes, moves),
			});
		}
		if (textTimeline.lanes.length > 0) {
			pushTextHistory(coalesceKey);
			setTextTimeline({
				...textTimeline,
				lanes: applyLayerMoves(textTimeline.lanes, moves),
			});
		}
	}

	// Owned here rather than by either lane component: a drag crosses between text and media rows.
	let draggingLaneId = $state<string | null>(null);

	function startLayerDrag(laneId: string, e: PointerEvent) {
		startLayerRowDrag(e, laneId, {
			order: () => layerOrder,
			reorder: reorderLayer,
			setDragging: (id) => (draggingLaneId = id),
		});
	}

	let selectedTextClip = $derived(
		findTextClip(textTimeline, selectedTextClipId),
	);
	let textChainNote = $derived(
		fanOutNote(
			selectedTextClip,
			textClipsById(new Set(selectedTextClipIds)).filter(
				(c) => c.id !== selectedTextClipId,
			),
		),
	);
	/** The lane holding the selected clip; the panel edits its style. */
	let selectedTextLane = $derived(
		findTextClipLane(textTimeline, selectedTextClipId),
	);

	// Its own undo stack: the chain stacks are typed to effect arrays.
	const textHistory = createTextHistory();

	// A restored timeline is the baseline, so the stack starts seeded with EMPTY.
	if (untrack(() => initialSession?.text)) {
		textHistory.reset();
	}

	function pushTextHistory(coalesceKey?: string) {
		textHistory.push(
			$state.snapshot(textTimeline) as TextTimeline,
			coalesceKey,
		);
	}

	function setTextTimeline(next: TextTimeline) {
		textTimeline = next;
		retainLaneMoshes();
	}

	/** A chain edit also reaches the other selected clips, when they run the same effects. */
	function updateTextClip(next: TextClip) {
		const others = textClipsById(new Set(selectedTextClipIds)).filter(
			(c) => c.id !== next.id,
		);
		const fanned = fanOutEdit(
			findTextClip(textTimeline, next.id),
			next,
			$state.snapshot(others) as TextClip[],
		);
		textTimeline = [next, ...fanned].reduce(replaceTextClip, textTimeline);
	}

	function updateTextLane(next: TextLane) {
		textTimeline = updateLane(textTimeline, next.id, () => next);
	}

	/** Adopt a saved timeline, or clear back to empty when a track has none. */
	function restoreTextTimeline(saved: TextTimeline | undefined) {
		textTimeline = saved
			? layersOffOnMobile(normalizeTextTimeline(saved), "text")
			: { ...EMPTY_TEXT_TIMELINE };
		selectedTextClipId = null;
		textHistory.reset();
	}

	/** Its own stack, for the same reason the text timeline has one. */
	const mediaHistory = createMediaHistory();

	function pushMediaHistory(coalesceKey?: string) {
		mediaHistory.push(
			$state.snapshot(mediaTimeline) as MediaTimeline,
			coalesceKey,
		);
	}

	function setMediaTimeline(next: MediaTimeline) {
		mediaTimeline = next;
		retainLaneMoshes();
	}

	/** See updateTextClip. */
	function updateMediaClip(next: MediaClip) {
		const others = mediaClipsById(new Set(selectedMediaClipIds)).filter(
			(c) => c.id !== next.id,
		);
		const fanned = fanOutEdit(
			findMediaClip(mediaTimeline, next.id),
			next,
			$state.snapshot(others) as MediaClip[],
		);
		mediaTimeline = [next, ...fanned].reduce(replaceMediaClip, mediaTimeline);
	}

	function updateMediaLane(next: MediaLane) {
		mediaTimeline = updateMediaLaneIn(mediaTimeline, next.id, () => next);
	}

	/** Adopt a saved timeline, or clear back to empty. Always on in sequence mode. */
	function restoreMediaTimeline(saved: MediaTimeline | undefined) {
		mediaTimeline = {
			...(saved ? normalizeMediaTimeline(saved) : EMPTY_MEDIA_TIMELINE),
			enabled: isSequenceMode,
		};
		selectedMediaClipId = null;
		mediaHistory.reset();
	}

	/** What a new lane starts on: the first thing in the pool. */
	function defaultLayerSourceId(): string | null {
		return sequenceSources[0]?.id ?? null;
	}

	function addMediaLane() {
		if (mediaTimeline.lanes.length >= MAX_MEDIA_LANES) return;
		const sourceId = defaultLayerSourceId();
		pushMediaHistory();
		setMediaTimeline(
			appendMediaLane(mediaTimeline, sourceId, nextLayerZ(layerOrder)),
		);
		// Nothing in the pool to draw, so ask for the file.
		if (!sourceId) sourceInput?.click();
	}

	/** The rail is the media pool: sequence mode's layers draw from it. */
	let showSourceRail = $derived(
		isSequenceMode && !sequenceGridOpen && sequenceSources.length > 0,
	);

	let selectedAudioClipId = $state<string | null>(null);
	let selectedAudioClipIds = $state<string[]>([]);

	// One selection across the whole stack: filling any lane's selection empties every other's.
	type SelectionKind = "fx" | "media" | "text" | "audio";

	function keepOnlySelection(keep: SelectionKind) {
		untrack(() => {
			if (keep !== "fx") {
				selectedFxClipId = null;
				selectedFxClipIds = [];
				// A lane picked by name aims the settings panel at it.
				selectedFxLaneId = null;
			}
			if (keep !== "media") selectedMediaClipId = null;
			if (keep !== "text") selectedTextClipId = null;
			if (keep !== "audio") selectedAudioClipId = null;
		});
	}

	$effect(() => {
		if (selectedFxClipId || selectedFxLaneId) keepOnlySelection("fx");
	});
	$effect(() => {
		if (selectedMediaClipId) keepOnlySelection("media");
	});
	$effect(() => {
		if (selectedTextClipId) keepOnlySelection("text");
	});
	$effect(() => {
		if (selectedAudioClipId) keepOnlySelection("audio");
	});

	/** Select what the preview was clicked on; clicking past every layer lands on the base. */
	function pickLayer(pick: LayerPick | null) {
		if (pick?.kind === "media") {
			const lane = mediaTimeline.lanes.find((l) => l.id === pick.laneId);
			const clip = lane ? clipAt(lane, textTime) : null;
			if (!clip) return;
			selectedMediaClipId = clip.id;
			selectedMediaClipIds = [clip.id];
			return;
		}
		if (pick?.kind === "text") {
			const lane = textTimeline.lanes.find((l) => l.id === pick.laneId);
			const clip = lane ? clipAt(lane, textTime) : null;
			if (clip) selectedTextClipId = clip.id;
			return;
		}
		selectedMediaClipId = null;
		selectedMediaClipIds = [];
		selectedTextClipId = null;
	}

	// Fill, mosh, clear and static/auto on a text clip: the same gestures a media clip takes.
	const previewTextChains = createTextChainSource(getMoshOptions);

	/** ←/→ walk one text clip's moshes, keyed by clip id. */
	const textMoshHistory = new MoshHistory<MoshSnapshot>();

	/** Deleting a clip retires its id, so drop the stack. */
	function retainLaneMoshes() {
		textMoshHistory.retain(
			textTimeline.lanes.flatMap((l) => l.clips.map((c) => c.id)),
		);
		mediaMoshHistory.retain(
			mediaTimeline.lanes.flatMap((l) => l.clips.map((c) => c.id)),
		);
	}

	function textClipsById(ids: Set<string>): TextClip[] {
		return textTimeline.lanes.flatMap((l) =>
			l.clips.filter((c) => ids.has(c.id)),
		);
	}

	/** Mosh history only, never the text edit stack; see fxRoll. */
	function textRoll(clipIds: string[]) {
		const ids = new Set(clipIds);
		for (const clip of textClipsById(ids)) {
			textMoshHistory.seed(
				clip.id,
				chainClipMoshSnapshot($state.snapshot(clip) as TextClip),
			);
		}
		rollAlive(
			() => (textTimeline = rollTextClips(textTimeline, ids, getMoshOptions())),
		);
		for (const clip of textClipsById(ids)) {
			textMoshHistory.push(
				clip.id,
				chainClipMoshSnapshot($state.snapshot(clip) as TextClip),
			);
		}
	}

	function applyTextClipMosh(clipId: string, snap: MoshSnapshot) {
		textTimeline = restoreTextClipMosh(textTimeline, clipId, snap);
	}

	function textClear(clipIds: string[]) {
		pushTextHistory();
		textTimeline = clearTextClips(textTimeline, new Set(clipIds));
	}

	function textApplyPreset(clipIds: string[], preset: Preset) {
		pushTextHistory();
		textTimeline = fillTextClipsFromPreset(
			textTimeline,
			new Set(clipIds),
			preset,
		);
	}

	function textModeChange(
		clipIds: string[],
		mode: ChainMode,
		intervalSec?: number,
		intervalBeats?: number | null,
	) {
		pushTextHistory();
		textTimeline = setTextClipsMode(
			textTimeline,
			new Set(clipIds),
			mode,
			intervalSec,
			intervalBeats,
		);
	}

	// Fill, mosh, clear and static/auto on a media clip: the same gestures an fx clip takes.
	const previewMediaChains = createMediaChainSource(getMoshOptions);

	/** ←/→ walk one media clip's moshes, keyed by clip id. */
	const mediaMoshHistory = new MoshHistory<MoshSnapshot>();

	function mediaClipsById(ids: Set<string>): MediaClip[] {
		return mediaTimeline.lanes.flatMap((l) =>
			l.clips.filter((c) => ids.has(c.id)),
		);
	}

	/** Mosh history only, never the media edit stack; see fxRoll. */
	function mediaRoll(clipIds: string[]) {
		const ids = new Set(clipIds);
		for (const clip of mediaClipsById(ids)) {
			mediaMoshHistory.seed(
				clip.id,
				chainClipMoshSnapshot($state.snapshot(clip) as MediaClip),
			);
		}
		rollAlive(
			() =>
				(mediaTimeline = rollMediaClips(mediaTimeline, ids, getMoshOptions())),
		);
		for (const clip of mediaClipsById(ids)) {
			mediaMoshHistory.push(
				clip.id,
				chainClipMoshSnapshot($state.snapshot(clip) as MediaClip),
			);
		}
	}

	function applyMediaClipMosh(clipId: string, snap: MoshSnapshot) {
		mediaTimeline = restoreMediaClipMosh(mediaTimeline, clipId, snap);
	}

	function mediaClear(clipIds: string[]) {
		pushMediaHistory();
		mediaTimeline = clearMediaClips(mediaTimeline, new Set(clipIds));
	}

	function mediaApplyPreset(clipIds: string[], preset: Preset) {
		pushMediaHistory();
		mediaTimeline = fillMediaClipsFromPreset(
			mediaTimeline,
			new Set(clipIds),
			preset,
		);
	}

	function mediaModeChange(
		clipIds: string[],
		mode: ChainMode,
		intervalSec?: number,
		intervalBeats?: number | null,
	) {
		pushMediaHistory();
		mediaTimeline = setMediaClipsMode(
			mediaTimeline,
			new Set(clipIds),
			mode,
			intervalSec,
			intervalBeats,
		);
	}

	let selectedMediaClip = $derived(
		findMediaClip(mediaTimeline, selectedMediaClipId),
	);
	let selectedMediaLane = $derived(
		findMediaClipLane(mediaTimeline, selectedMediaClipId),
	);
	let mediaChainNote = $derived(
		fanOutNote(
			selectedMediaClip,
			mediaClipsById(new Set(selectedMediaClipIds)).filter(
				(c) => c.id !== selectedMediaClipId,
			),
		),
	);
	/** What the selected layer clip draws, and plays. */
	let selectedMediaSourceId = $derived(
		selectedMediaLane && selectedMediaClip
			? clipSourceId(selectedMediaLane, selectedMediaClip)
			: null,
	);

	/** The source the selected layer clips draw; null when they disagree. */
	let mediaSelectedSourceId = $derived.by(() => {
		if (selectedMediaClipIds.length === 0) return null;
		const picked = new Set(selectedMediaClipIds);
		const drawn: (string | null)[] = [];
		for (const lane of mediaTimeline.lanes) {
			for (const clip of lane.clips) {
				if (picked.has(clip.id)) drawn.push(clipSourceId(lane, clip));
			}
		}
		if (drawn.length === 0) return null;
		return drawn.every((id) => id && id === drawn[0]) ? drawn[0] : null;
	});

	/** The thumb the rail lights up; falls back to the lane behind the primary clip. */
	let railSourceId = $derived(
		mediaSelectedSourceId ?? selectedMediaLane?.sourceId ?? null,
	);

	/** How many clips a rail click assigns to. */
	let railTargetCount = $derived(selectedMediaClipIds.length);

	/** Point the selected layer clips at this source, fanned out over the selection. */
	function assignMediaClipSource(sourceId: string) {
		if (selectedMediaClipIds.length === 0) return;
		pushMediaHistory();
		setMediaTimeline(
			setMediaClipSources(mediaTimeline, selectedMediaClipIds, sourceId),
		);
	}

	/** Deal the pool across the selected layer clips, or every layer clip. */
	function dealMediaSources() {
		const pool = sequenceSources.map((s) => s.id);
		if (pool.length < 2) return;
		const ids =
			selectedMediaClipIds.length > 0
				? selectedMediaClipIds
				: mediaTimeline.lanes.flatMap((l) => l.clips.map((c) => c.id));
		if (ids.length === 0) return;
		pushMediaHistory();
		setMediaTimeline(dealMediaClipSources(mediaTimeline, new Set(ids), pool));
	}

	function toggleTextTimeline() {
		pushTextHistory();
		textTimeline = toggledTextTimeline(textTimeline, nextLayerZ(layerOrder));
		if (!textTimeline.enabled) {
			selectedTextClipId = null;
			lyricsOpen = false;
		}
	}

	/** Transport for the lyrics-sync modal, on whichever clock owns the master timeline. */
	let lyricsSync = $derived<LyricsSyncProps | null>(
		textTimeline.enabled && isSequenceMode
			? {
					isPlaying: mixer.playing,
					spanStart: mixer.spanStart,
					spanEnd: mixer.spanEnd,
					getCurrentTime: () => mixer.currentTime,
					onPlay: playSpan,
					onPause: pauseTrack,
					onSeek: (t) => mixer.seek(t),
					onApply: applyLyrics,
				}
			: textTimeline.enabled
				? {
						isPlaying: textNeedsTransport
							? stillPlaying
							: audio.audioPlaying || videoIsPlaying,
						spanStart: textNeedsTransport
							? 0
							: seqMasterIsAudio
								? audio.spanStart
								: videoSpanStart,
						spanEnd: textNeedsTransport
							? textDuration
							: seqMasterIsAudio
								? audio.spanEnd
								: videoSpanEnd,
						getCurrentTime: () =>
							textNeedsTransport
								? stillClock
								: seqMasterIsAudio
									? audio.trackCurrentTime
									: videoClock,
						onPlay: textNeedsTransport
							? () => (stillPlaying = true)
							: seqMasterIsAudio
								? playSpan
								: playVideo,
						onPause: textNeedsTransport
							? () => (stillPlaying = false)
							: seqMasterIsAudio
								? pauseTrack
								: pauseVideo,
						onSeek: textNeedsTransport
							? (t) => (stillClock = t)
							: seqMasterIsAudio
								? seekTo
								: seekVideoTo,
						onApply: applyLyrics,
					}
				: null,
	);

	/** Drop the synced lines into the lyrics lane and select the first one. */
	function applyLyrics(clips: TextClip[]) {
		if (clips.length === 0) return;
		pushTextHistory();
		textTimeline = applyLyricsToTimeline(
			textTimeline,
			clips,
			nextLayerZ(layerOrder),
		);
		selectedTextClipId = clips[0].id;
	}
	let effectiveDuration = $derived(
		isSequenceMode
			? mixer.spanEnd - mixer.spanStart
			: audio.trackFile &&
				  audio.trackDuration > 0 &&
				  audio.spanEnd - audio.spanStart > 0
				? audio.spanEnd - audio.spanStart
				: isVideo && videoDuration > 0
					? (videoSpanEnd - videoSpanStart) / videoSpeed
					: recordDuration,
	);
	const recordingState = createRecordingState();

	async function startRecording() {
		if (!canvasEl || !glRenderer || recordingState.recording) return;
		if (noSequenceMedia) {
			showToast("Add media before recording", "info");
			return;
		}
		showRecordSettings = false;
		// The record overlay lives outside the fullscreen element, so staying in it would hide it.
		previewFullscreen = false;

		audio.pauseAudio();
		mixer.pause();
		previewPlayer?.pause();
		if (isVideo && videoEl) videoEl.pause();
		if (isLive && !liveVideoEl?.srcObject) {
			showToast("The camera isn't open", "error");
			return;
		}

		// Generated sources may still be catching up with a size change.
		await primarySync.settle();
		await sourceRegistry.settleGenerated();

		// Preview runs at display resolution, so export at the real output size.
		if (resizeWidth > 0 && resizeHeight > 0) {
			glRenderer.resize(resizeWidth, resizeHeight);
		}

		// The editor's sound is mixed up front, from the same plan the preview plays.
		const plan = mixPlan;
		const span = { start: mixer.spanStart, end: mixer.spanEnd };
		const mixSound = async () => {
			await audioBank.settle(planSourceIds(plan));
			return renderMix(
				plan,
				(id) => audioBank.buffer(id),
				span.start,
				span.end,
			);
		};

		await recordingState.run(
			async (signal) =>
				executeRecording({
					fps: recordFps,
					recordDuration,
					canvas: canvasEl!,
					renderer: glRenderer!,
					effects,
					trackFile: isSequenceMode ? null : audio.trackFile,
					trackDuration: audio.trackDuration,
					spanStart: audio.spanStart,
					spanEnd: audio.spanEnd,
					isVideo,
					videoHasAudio,
					videoEl,
					videoDuration,
					videoSpanStart,
					videoSpanEnd,
					videoSpeed,
					file,
					live: isLive ? liveVideoEl : null,
					// A live export is a performance: the song must be heard from the span it exports.
					onLiveStart: () => {
						if (!audio.trackFile) return;
						audio.seekTo(audio.spanStart);
						audio.playAudio();
					},
					normalizeGain: audio.normalizeGain,
					audioResponse,
					textTimeline: textTimeline.enabled
						? ($state.snapshot(textTimeline) as TextTimeline)
						: null,
					mediaTimeline: mediaTimeline.enabled
						? ($state.snapshot(mediaTimeline) as MediaTimeline)
						: null,
					moshOptions: getMoshOptions(),
					layerSources: sourceRegistry.sources,
					sourceEdits: $state.snapshot(sourceRegistry.edits) as Record<
						string,
						SourceEdit
					>,
					textTimeOffset,
					textTimeScale,
					bpm: sequenceBpm,
					sequence: isSequenceMode
						? {
								moshOptions: getMoshOptions(),
								duration: seqMasterDuration,
								masterIsAudio: true,
								fxLanes: $state.snapshot(fxLanes) as FxLane[],
								span,
								mix: await mixSound(),
							}
						: null,
					onProgress: (p) => {
						recordingState.recordProgress = p;
					},
					onFinalizing: () => {
						recordingState.recordFinalizing = true;
					},
					signal,
				}),
			{
				onError: (message) => showToast(message, "error"),
				fallbackErrorMessage:
					"Recording failed. Check the browser console for details.",
			},
		);

		// Left paused: an export ends with the file saved and a toast to read.
		if (isLive) audio.pauseAudio();
		if (canvasEl && glRenderer) {
			glRenderer.render(renderedEffects, performance.now() / 1000);
		}
	}

	function cancelRecording() {
		recordingState.cancel();
	}

	/** Audio sets the track; media replaces the file in single mode, joins the pool in sequence. */
	function handleDroppedFiles(files: FileList) {
		const all = Array.from(files);
		const audioFiles = all.filter((f) => f.type.startsWith("audio/"));
		if (isSequenceMode && audioFiles.length > 0) {
			void addAudioFiles(audioFiles);
		} else if (audioFiles[0]) {
			clearTrack();
			audio.trackFile = audioFiles[0];
		}
		const media = all.filter(
			(f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
		);
		if (media.length === 0) return;
		if (isSequenceMode) void addSequenceSources(media);
		else onfile(media[0]);
	}
</script>

<svelte:window
	onkeydown={handleKeydown}
	onpointerdown={(e) => {
		audio.audioContext?.resume();
		moshGroupRef?.handleClickOutside(e);
		recordGroupRef?.handleClickOutside(e);
	}}
/>

{#if audio.trackObjectUrl && !isSequenceMode}
	<audio
		bind:this={audioEl}
		src={audio.trackObjectUrl}
		onloadedmetadata={() => audio.onAudioLoadedMetadata()}
		onerror={() => showToast("Could not load this audio track", "error")}
		ontimeupdate={() => audio.onAudioTimeUpdate()}
		onended={() => audio.onAudioEnded()}
		onplay={() => (audio.audioPlaying = true)}
		onpause={() => (audio.audioPlaying = false)}
		hidden
	></audio>
{/if}

<div
	class="editor"
	class:drag-over={dragging}
	{@attach fileDrop({
		onDraggingChange: (d) => (dragging = d),
		onDrop: handleDroppedFiles,
	})}
>
	<TrackLibrary
		bind:this={trackLibraryRef}
		activeTrackName={audio.trackFile?.name ?? null}
		activeTrackId={currentTrackId}
		onLoadTrack={onLibraryLoadTrack}
		onUnloadTrack={clearTrack}
		onPlay={isSequenceMode ? playSpan : () => audio.playAudio()}
		onPause={isSequenceMode ? pauseTrack : () => audio.pauseAudio()}
		mainPlaying={isSequenceMode ? mixer.playing : audio.audioPlaying}
		pendingTrack={audio.trackFile}
		onNormalizeChange={(gain) => audio.setNormalizeGain(gain)}
		onAutoAdded={adoptLibraryTrack}
	/>
	<div
		class="main-area"
		bind:this={mainAreaEl}
		style="--tl-vscroll: {laneScrollbar}px"
	>
		<TopBar onExit={onExit ? handleExit : undefined}>
			{#snippet status()}
				<SaveIndicator
					state={saves.state}
					lastSavedAt={saves.lastSavedAt}
					{notSaved}
				/>
			{/snippet}
			{#if isSequenceMode}
				<div class="output-group">
					<ButtonGroup
						buttons={[
							{ label: "Preview", value: "preview" },
							{ label: "Grid", value: "grid" },
						]}
						value={sequenceView}
						onchange={(v) => (sequenceView = v as "preview" | "grid")}
					/>
				</div>
				<!-- Scoped by the selection: with layer clips picked it deals across those. -->
				<MediaPoolActions
					count={sequenceSources.length}
					shuffleScope={selectedMediaClipIds.length}
					shuffleTitle={selectedMediaClipIds.length > 0
						? "Deal the pool at random across the selected layer clips"
						: "Deal the pool at random across every layer clip"}
					recordTitle="Record a webcam take to the song, from the playhead"
					onShuffle={dealMediaSources}
					onAdd={() => sourceInput?.click()}
					onGenerate={() => (generateOpen = true)}
					onRecord={() => (webcamOpen = true)}
					onClear={() => (showClearSourcesConfirm = true)}
				/>
			{:else}
				<button
					class="help-btn"
					title="Generate a new source image"
					onclick={() => (generateOpen = true)}
				>
					<Palette size={14} />
				</button>
				<div class="output-group">
					<span class="rack-label">Output</span>
					<ButtonGroup
						buttons={[
							{ label: "PNG", value: "png" },
							{ label: "JPG", value: "jpg" },
							{ label: "WebM", value: "webm" },
						]}
						value={format}
						onchange={(v) => (format = v)}
					/>
				</div>
			{/if}
		</TopBar>

		{#snippet loadingOverlay()}
			<div class="no-media">
				<div class="media-spinner"></div>
				<span class="no-media-label">LOADING MEDIA</span>
				<p class="no-media-text">
					Decoding what you dropped in. High-resolution videos take a moment —
					the preview starts once everything is in.
				</p>
				{#if sourceRegistry.loadingTotal > 1}
					<span class="no-media-hint">
						{Math.min(
							sourceRegistry.loadingDone + 1,
							sourceRegistry.loadingTotal,
						)} / {sourceRegistry.loadingTotal} FILES
					</span>
				{/if}
			</div>
		{/snippet}

		{#snippet noMediaOverlay()}
			<div class="no-media">
				<span class="no-media-label">NO MEDIA</span>
				<p class="no-media-text">
					Every source is gone from this song. Add an image or a video and the
					layers have something to show again.
				</p>
				<div class="no-media-actions">
					<button class="no-media-btn" onclick={() => sourceInput?.click()}>
						<Plus size={14} /> ADD MEDIA
					</button>
					<button class="no-media-btn" onclick={() => (generateOpen = true)}>
						<Palette size={14} /> GENERATE
					</button>
					<button class="no-media-btn" onclick={() => (webcamOpen = true)}>
						<Camera size={14} /> RECORD
					</button>
				</div>
				<span class="no-media-hint">or drop files anywhere</span>
			</div>
		{/snippet}

		{#if isLive}
			<video
				bind:this={liveVideoEl}
				autoplay
				muted
				playsinline
				style="display:none"
			></video>
		{/if}

		{#if isVideo}
			<video
				bind:this={videoEl}
				src={imageSrc}
				muted
				autoplay={!previewPlayer}
				playsinline
				onloadedmetadata={() => {
					// Player owns duration/span/audio when active; the element is only the recording fallback then
					if (previewPlayer) return;
					const dur = videoEl!.duration;
					videoDuration = dur;
					videoSpanStart = 0;
					videoSpanEnd = dur;
					videoPastSpan = false;
					recordDuration = Math.round(dur * 10) / 10;
					ensureVideoAudioGraph();
				}}
				ontimeupdate={() => {
					if (previewPlayer) return;
					videoCurrentTime = videoEl?.currentTime ?? 0;
					// Span-loop: skip during recording (export seeks the video directly)
					if (
						!recordingState.recording &&
						!videoPastSpan &&
						videoEl &&
						videoCurrentTime >= videoSpanEnd
					) {
						videoEl.currentTime = videoSpanStart;
						if (!videoLoop) videoEl.pause();
					}
				}}
				onended={() => {
					// Natural end can fire before timeupdate reaches spanEnd
					if (
						!previewPlayer &&
						!recordingState.recording &&
						!videoPastSpan &&
						videoEl &&
						videoLoop
					) {
						videoEl.currentTime = videoSpanStart;
						videoEl.play().catch(() => {});
					}
				}}
				onplay={() => (videoPlaying = true)}
				onpause={() => (videoPlaying = false)}
				onseeking={() => {
					audio.audioContext?.resume();
				}}
				style="display:none"
			></video>
		{/if}

		{#if sequenceGridOpen}
			<SequenceGridView
				sources={sequenceSources}
				selectedCount={selectedMediaClipIds.length}
				selectedSourceId={railSourceId}
				onAddFiles={(files) => void addSequenceSources(files)}
				onGenerate={() => (generateOpen = true)}
				onRecord={() => (webcamOpen = true)}
				onRemove={removeSequenceSource}
				onReorder={(from, to) => sourceRegistry.reorder(from, to)}
				onAssign={assignMediaClipSource}
				onProxyAction={(id, action) => {
					if (action === "retry") sourceRegistry.retryProxy(id);
					else sourceRegistry.setProxyEnabled(id, action === "enable");
				}}
			/>
		{/if}
		<!-- Hidden, never unmounted: tearing the canvas down would take the renderer with it. -->
		<div
			class="preview-slot"
			class:hidden={sequenceGridOpen}
			bind:this={previewSlotEl}
		>
			{#if !isSequenceMode && isVideo && singleProxyStatus.kind !== "none"}
				<!-- Single mode has no source chip, so this says what would otherwise be silent. -->
				<button
					class="preview-proxy"
					class:ok={singleProxyStatus.kind === "ready"}
					class:warn={singleProxyStatus.kind === "failed"}
					class:off={singleProxyStatus.kind === "off"}
					title={`${singleProxyStatus.title} ${singleProxyStatus.action.hint}`}
					onclick={() => {
						const action = singleProxyStatus.action.kind;
						if (action === "retry") {
							singleJobFor = null;
							singleProxyFailed = false;
							singleProxyReason = undefined;
						} else {
							setSingleProxyEnabled(action === "enable");
						}
					}}
				>
					{#if singleProxyStatus.kind === "ready"}
						<Zap size={9} fill="currentColor" />
					{:else if singleProxyStatus.kind === "off"}
						<ZapOff size={9} />
					{:else if singleProxyStatus.kind === "failed"}
						<TriangleAlert size={9} />
					{/if}
					{singleProxyStatus.kind === "failed" ? "" : singleProxyStatus.badge}
				</button>
			{/if}
			<GlCanvas
				bind:this={glCanvasRef}
				imageSrc={generatedSrc ?? imageSrc}
				effects={renderedEffects}
				postLayers={fxLayers}
				canvasWidth={resizeWidth || undefined}
				canvasHeight={resizeHeight || undefined}
				bind:canvasEl
				bind:glRenderer
				bind:naturalWidth
				bind:naturalHeight
				bind:fps={currentFps}
				bind:fullscreen={previewFullscreen}
				showFps={showFps && !isImageFormat}
				videoEl={isLive
					? liveVideoEl
					: isVideo && !previewPlayer
						? videoEl
						: null}
				frameSource={previewPlayer}
				sourceKey={String(sourceTick)}
				freezeAnimation={isImageFormat}
				suspended={recordingState.recording ||
					noSequenceMedia ||
					sequenceGridOpen ||
					sourceEditOpen}
				{warmCanvas}
				{warmRenderer}
				textTimeline={textTimeline.enabled ? textTimeline : null}
				mediaTimeline={mediaTimeline.enabled ? mediaTimeline : null}
				selectedMediaLane={mediaTimeline.enabled ? selectedMediaLane : null}
				selectedTextClipId={textTimeline.enabled ? selectedTextClipId : null}
				soloMediaLaneId={mediaTimeline.enabled ? soloLaneId : null}
				mediaDriver={(layers) => mediaLayers.advance(layers)}
				mediaChains={previewMediaChains}
				textChains={previewTextChains}
				baseSize={isSequenceMode ? seqBaseSize : null}
				{textTime}
				bpm={sequenceBpm}
				forceAnimation={isLive ||
					((textTimeline.enabled || mediaTimeline.enabled) && textClockRunning)}
				overlay={mediaLoading
					? loadingOverlay
					: noSequenceMedia
						? noMediaOverlay
						: undefined}
				spectrum={isSequenceMode ? mixer.frequencyData : audio.frequencyData}
				{sourceFit}
				sourceEdits={sourceRegistry.edits}
				{sourceDurations}
				onPickLayer={pickLayer}
				onLayerDragStart={() => pushMediaHistory()}
				onTextDragStart={() => pushTextHistory()}
				onTextMove={(clipId, x, y) => {
					const clip = findTextClip(textTimeline, clipId);
					if (clip) updateTextClip({ ...clip, x, y });
				}}
				onLayerStyleChange={(id, style) =>
					(mediaTimeline = updateMediaLaneIn(mediaTimeline, id, (l) => ({
						...l,
						style,
					})))}
			/>
		</div>

		<div class="action-bar">
			<!-- The pool lives in a sheet on a phone; this is the way into it. -->
			<div class="bar-cluster library-cluster">
				<button
					class="bar-icon"
					onclick={() => trackLibraryRef?.openLibrary()}
					title="Track library"
					aria-label="Track library"
				>
					<Library size={13} />
				</button>
			</div>
			<!-- Layer lanes are off on a phone (see layersOffOnMobile), so their switches go too. -->
			{#if !isMobile || fullscreenSupported}
				<div class="bar-cluster">
					{#if hasKeyboard}
						<button
							class="bar-icon"
							onclick={() => (showShortcuts = true)}
							title="Keyboard shortcuts"
							aria-label="Keyboard shortcuts"
						>
							<HelpCircle size={14} />
						</button>
					{/if}
					{#if fullscreenSupported}
						<button
							class="bar-icon"
							class:on={previewFullscreen}
							onclick={() => (previewFullscreen = !previewFullscreen)}
							title="Fullscreen preview (F)"
							aria-label="Fullscreen preview"
						>
							<Maximize size={14} />
						</button>
					{/if}
					{#if !isMobile}
						<button
							class="bar-icon"
							class:on={textTimeline.enabled}
							onclick={toggleTextTimeline}
							title="Text timeline: timed text layers with their own effects"
							aria-label="Text timeline"
						>
							<Type size={14} />
						</button>
					{/if}
				</div>
				<div class="bar-sep"></div>
			{/if}
			<MoshGroup
				bind:this={moshGroupRef}
				onMosh={mosh}
				onClear={clearEffects}
				onUndo={undoMosh}
				canUndo={moshSession.canUndoMosh}
				canClear={moshSession.touched}
				hideActions={isSequenceMode && seqMasterDuration > 0}
				bind:showSettings={showMoshSettings}
			>
				{#snippet settingsContent()}
					{#if !isSequenceMode}
						<ButtonGroup
							buttons={[
								{ label: "PNG", value: "png" },
								{ label: "JPG", value: "jpg" },
								{ label: "WebM", value: "webm" },
							]}
							value={format}
							onchange={(v) => (format = v)}
						/>
						<div class="settings-divider"></div>
					{/if}
					<div class="mosh-setting-row">
						<label for="show-fps">Show FPS</label>
						<Checkbox id="show-fps" bind:checked={showFps} />
					</div>
					<div class="mosh-setting-row">
						<label
							for="show-spectrum"
							title="Draw the live spectrum under each audio link"
						>
							Show spectrum
						</label>
						<Checkbox id="show-spectrum" bind:checked={showSpectrum.value} />
					</div>
					<div class="mosh-setting-row">
						<label
							for="source-fit"
							title="How to fit sources that don't match the output aspect"
						>
							Fit sources
						</label>
						<select id="source-fit" bind:value={sourceFit}>
							<option value="contain">Contain</option>
							<option value="cover">Cover</option>
							<option value="stretch">Stretch</option>
						</select>
					</div>
					<div class="settings-divider"></div>
					<ResizeSettings
						bind:width={resizeWidth}
						bind:height={resizeHeight}
						{naturalWidth}
						{naturalHeight}
					/>
				{/snippet}
			</MoshGroup>
			{#if !isSequenceMode}
				<!-- Re-input is a bare V on a keyboard; a phone has no other way to it. -->
				<div class="bar-cluster">
					<button
						class="bar-icon"
						onclick={reInput}
						disabled={mediaLoading || recordingState.recording}
						title="Re-input: use this frame as the new source (V)"
						aria-label="Use this frame as the new source"
					>
						<Stamp size={14} />
					</button>
				</div>
			{/if}
			{#if showStack}
				<!-- The same transport as the timeline toolbar's, at the size the slideshow gives it. -->
				<button class="bar-key live" onclick={toggleMasterPlay}>
					{#if textClockRunning}
						<Pause size={14} fill="currentColor" stroke="none" />
						STOP
					{:else}
						<Play size={14} fill="currentColor" stroke="none" />
						PLAY
					{/if}
				</button>
			{/if}
			{#if isImageFormat}
				<button class="bar-key live" onclick={save}>
					<Download size={14} />
					SAVE
				</button>
			{/if}

			{#if isVideoFormat && !isMobile}
				<RecordGroup
					bind:this={recordGroupRef}
					recording={recordingState.recording}
					bind:showSettings={showRecordSettings}
				>
					{#snippet settingsContent()}
						{#if !isSequenceMode && !audio.trackFile && !isVideo}
							<div class="mosh-setting-row">
								<label for="rec-duration">Duration</label>
								<NumberField
									id="rec-duration"
									value={recordDuration}
									min={1}
									max={MAX_RECORD_DURATION}
									step={1}
									fineStep={0.5}
									allowEmpty={false}
									unit="duration"
									upTitle="Longer (shift for half a second)"
									downTitle="Shorter (shift for half a second)"
									onChange={(v) => (recordDuration = v)}
								/>
								<span class="rec-duration-unit">sec</span>
							</div>
							<div class="rec-duration-presets">
								{#each RECORD_DURATION_PRESETS as preset (preset)}
									<button
										class="rec-preset-btn"
										class:active={recordDuration === preset}
										onclick={() => (recordDuration = preset)}
									>
										{preset}s
									</button>
								{/each}
							</div>
						{:else}
							<div class="mosh-setting-row">
								<span class="rec-duration-label">Duration</span>
								<span class="mosh-setting-val"
									>{effectiveDuration.toFixed(1)}s</span
								>
							</div>
						{/if}
						<div class="mosh-setting-row">
							<label for="rec-fps">FPS</label>
							<select id="rec-fps" bind:value={recordFps}>
								<option value={15}>15</option>
								<option value={24}>24</option>
								<option value={30}>30</option>
								<option value={60}>60</option>
								<option value={120}>120</option>
							</select>
						</div>
						<button class="rec-start-btn" onclick={startRecording}>
							Start Recording
						</button>
					{/snippet}
				</RecordGroup>
			{/if}
		</div>
		{#if showSourceRail}
			<!-- The pool, on hand while the preview is up. -->
			<SourceRail
				sources={sequenceSources}
				selectedCount={railTargetCount}
				selectedSourceId={railSourceId}
				onAssign={assignMediaClipSource}
				onAdd={() => sourceInput?.click()}
				onReorder={(from, to) => sourceRegistry.reorder(from, to)}
				edits={sourceRegistry.edits}
				onEditChange={(id, edit) => sourceRegistry.setEdit(id, edit)}
				onEditingChange={onSourceEditingChange}
			/>
		{/if}
		{#if showVideoBar && !videoIsMaster}
			<!-- A second clock: the video runs its own span while the track drives the timeline. -->
			<AudioTimeline
				label="VID"
				trackDuration={videoDuration}
				trackCurrentTime={videoClock}
				spanStart={videoSpanStart}
				spanEnd={videoSpanEnd}
				isPlaying={videoIsPlaying}
				loopEnabled={videoLoop}
				onToggleLoop={() => (videoLoop = !videoLoop)}
				onPlay={playVideo}
				onPause={pauseVideo}
				onSeek={seekVideoTo}
				onSpanStartChange={(t) => (videoSpanStart = t)}
				onSpanEndChange={(t) => (videoSpanEnd = t)}
				speed={videoSpeed}
				onSpeedChange={(s) => (videoSpeed = s)}
				ariaLabel="Video timeline"
				outputVolume={audio.outputVolume}
				onVolumeChange={videoHasAudio && audio.analyserNode && !audio.trackFile
					? (v) => audio.setOutputVolume(v)
					: undefined}
			/>
		{/if}
		{#if showStack}
			<!-- The split between the output and the lanes; its hit area is taller than the grip. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="tl-split" class:held={splitDragging}>
				<span
					class="tl-split-grip"
					role="separator"
					aria-orientation="horizontal"
					aria-label="Resize the timeline"
					title="Drag to resize the timeline · double-click to reset"
					tabindex="0"
					onpointerdown={beginSplitDrag}
					ondblclick={resetSplit}
					onkeydown={onSplitKeydown}
				></span>
			</div>
			<TimelineStack
				height={timelineSplit}
				bind:axis={timelineAxis}
				trackDuration={textDuration}
				currentTime={textTime}
				isPlaying={textClockRunning}
				onTogglePlay={toggleMasterPlay}
				onSeek={seekMaster}
				spanStart={textTimeOffset}
				bpm={isSequenceMode ? sequenceBpm : 0}
				selectionHint={isSequenceMode
					? "Click a layer clip or an FX clip to edit it"
					: null}
				loopEnabled={isSequenceMode
					? mixer.loop
					: seqMasterIsAudio
						? audio.loopAudio
						: videoLoop}
				onToggleLoop={isSequenceMode || audioIsMaster || videoIsMaster
					? toggleMasterLoop
					: null}
				{repeatRange}
				onStopRepeat={() => (repeatClipIds = [])}
				{repeatClipIds}
				onToggleRepeat={toggleRepeat}
				onGrow={isSequenceMode ? (length) => mixer.setDuration(length) : null}
				maxLength={MAX_PROJECT_LENGTH}
			>
				{#snippet toolbar()}
					<!-- Each button names the lane it adds: "+ Lane" read as the same button three times. -->
					{#if textTimeline.enabled}
						<div class="tl-tool-sep"></div>
						<button
							class="tl-tool-btn"
							title="Add a lane of timed text over the frame"
							onclick={addTextLane}
						>
							<Plus size={12} /> Text lane
						</button>
						{#if lyricsSync}
							<button
								class="tl-tool-btn"
								class:active={lyricsOpen}
								title="Sync lyrics to the song: paste them, then press Space as it plays"
								onclick={() => (lyricsOpen = true)}
							>
								<MicVocal size={12} /> Lyrics
							</button>
						{/if}
					{/if}
					<!-- Read bottom to top, the way the frame is built. -->
					{#if mediaTimeline.enabled}
						<div class="tl-tool-sep"></div>
						<button
							class="tl-tool-btn"
							disabled={mediaTimeline.lanes.length >= MAX_MEDIA_LANES}
							title={mediaTimeline.lanes.length >= MAX_MEDIA_LANES
								? `${MAX_MEDIA_LANES} layers is the limit`
								: "Add a layer of images or videos from the pool, each clip with its own effects"}
							onclick={addMediaLane}
						>
							<Plus size={12} /> Media layer
						</button>
					{/if}
					{#if isSequenceMode && seqMasterDuration > 0}
						<div class="tl-tool-sep"></div>
						<button
							class="tl-tool-btn"
							disabled={(mediaTimeline.audioLanes?.length ?? 0) >=
								MAX_AUDIO_LANES}
							title="Add music, a voice-over or any sound, on a lane of its own from the start marker"
							onclick={openTrackPicker}
						>
							<Plus size={12} /> Audio file
						</button>
						<button
							class="tl-tool-btn"
							disabled={(mediaTimeline.audioLanes?.length ?? 0) >=
								MAX_AUDIO_LANES}
							title="Add an empty audio lane, to paste or drag clips onto from another"
							onclick={addEmptyAudioLane}
						>
							<Plus size={12} /> Audio lane
						</button>
						<div class="tl-tool-sep"></div>
						<button
							class="tl-tool-btn"
							disabled={fxLanes.length >= MAX_FX_LANES}
							title={fxLanes.length >= MAX_FX_LANES
								? `${MAX_FX_LANES} lanes is the limit`
								: "Add a lane of extra effects that run over the whole frame, layers included"}
							onclick={addFxLane}
						>
							<Plus size={12} /> FX lane
						</button>
					{/if}
					{#if laneIds.length > 0}
						<div class="tl-tool-sep"></div>
						<button
							class="tl-tool-btn"
							title={allLanesFolded
								? "Unfold every lane"
								: "Fold every lane to a strip"}
							onclick={toggleAllFolds}
						>
							{#if allLanesFolded}
								<ChevronsUpDown size={12} /> Unfold all
							{:else}
								<ChevronsDownUp size={12} /> Fold all
							{/if}
						</button>
					{/if}
					{#if isSequenceMode && seqMasterDuration > 0}
						<div class="tl-tool-sep"></div>
						<span
							class="tl-tool-label"
							title="How long the project runs. Shorter cuts clips crossing the new end back to it; clips wholly past it are kept for when it grows."
							>Length</span
						>
						<NumberField
							value={Math.round(mixer.duration * 10) / 10}
							min={1}
							max={MAX_PROJECT_LENGTH}
							step={1}
							fineStep={0.1}
							allowEmpty={false}
							unit="duration"
							upTitle="Longer (shift for a tenth of a second)"
							downTitle="Shorter (shift for a tenth of a second)"
							commitOnBlur
							onChange={setProjectLength}
						/>
						<button
							class="tl-tool-btn"
							title="Fit the project to its clips: end where the last one does"
							disabled={timelineContentEnd() <= 0}
							onclick={() => setProjectLength(timelineContentEnd())}
						>
							Fit
						</button>
					{/if}
					{#if videoIsMaster}
						<div class="tl-tool-sep"></div>
						<SpeedControl
							speed={videoSpeed}
							onSpeedChange={(s) => (videoSpeed = s)}
						/>
					{/if}
				{/snippet}
				<!-- Read bottom to top: the transports at the foot are the inputs. -->
				<div class="tl-layers" bind:this={laneListEl}>
					{#if mediaTimeline.enabled}
						<MediaTimelineLane
							timeline={mediaTimeline}
							{foldedLaneIds}
							onToggleFold={toggleLaneFold}
							{layerOrder}
							{draggingLaneId}
							onLaneDragStart={startLayerDrag}
							sources={sequenceSources}
							edits={sourceRegistry.edits}
							bind:selectedClipId={selectedMediaClipId}
							bind:selectedClipIds={selectedMediaClipIds}
							{soloLaneId}
							onToggleSolo={toggleMediaSolo}
							onChange={setMediaTimeline}
							onBeforeEdit={pushMediaHistory}
							bpm={sequenceBpm}
							onApplyPreset={mediaApplyPreset}
							onRoll={mediaRoll}
							onClear={mediaClear}
							onModeChange={mediaModeChange}
							plan={isSequenceMode ? mixPlan : undefined}
							{peaksOf}
							audioVersion={audioBank.version}
						/>
					{/if}
					{#if textTimeline.enabled}
						<TextTimelineLane
							timeline={textTimeline}
							{foldedLaneIds}
							onToggleFold={toggleLaneFold}
							{layerOrder}
							{draggingLaneId}
							onLaneDragStart={startLayerDrag}
							bind:selectedClipId={selectedTextClipId}
							bind:selectedClipIds={selectedTextClipIds}
							onChange={setTextTimeline}
							onBeforeEdit={pushTextHistory}
							bpm={sequenceBpm}
							onApplyPreset={textApplyPreset}
							onRoll={textRoll}
							onClear={textClear}
							onModeChange={textModeChange}
							{lyricsSync}
							bind:lyricsOpen
						/>
					{/if}
					{#if isSequenceMode && fxLanes.length > 0}
						<FxLanes
							lanes={fxLanes}
							{foldedLaneIds}
							onToggleFold={toggleLaneFold}
							{layerOrder}
							{draggingLaneId}
							onLaneDragStart={startLayerDrag}
							bind:selectedClipId={selectedFxClipId}
							bind:selectedClipIds={selectedFxClipIds}
							onChange={setFxLanes}
							onBeforeEdit={pushFxHistory}
							bpm={sequenceBpm}
							bind:selectedLaneId={selectedFxLaneId}
							onModeChange={fxModeChange}
							onRoll={fxRoll}
							onClear={fxClear}
						/>
					{/if}
					{#if isSequenceMode && (mediaTimeline.audioLanes?.length ?? 0) > 0}
						<AudioLanes
							lanes={mediaTimeline.audioLanes ?? []}
							bind:selectedClipId={selectedAudioClipId}
							bind:selectedClipIds={selectedAudioClipIds}
							onChange={(audioLanes) =>
								setMediaTimeline({ ...mediaTimeline, audioLanes })}
							onBeforeEdit={pushMediaHistory}
							plan={mixPlan}
							{peaksOf}
							version={audioBank.version}
							sourceName={audioSourceName}
							bpmSourceId={songSourceId}
							onSetBpmSource={setBpmSource}
							repeatsOf={audioClipRepeats}
							sourceEndsOf={audioSourceEnds}
							orderBase={layerOrder.length}
							{foldedLaneIds}
							onToggleFold={toggleLaneFold}
						/>
					{/if}
				</div>
				{#if videoIsMaster}
					<AudioTimeline
						layout="lane"
						label="VID"
						trackDuration={videoDuration}
						trackCurrentTime={videoClock}
						spanStart={videoSpanStart}
						spanEnd={videoSpanEnd}
						isPlaying={videoIsPlaying}
						onPlay={playVideo}
						onPause={pauseVideo}
						onSeek={seekVideoTo}
						onSpanStartChange={(t) => (videoSpanStart = t)}
						onSpanEndChange={(t) => (videoSpanEnd = t)}
						ariaLabel="Video timeline"
						outputVolume={audio.outputVolume}
						onVolumeChange={videoHasAudio &&
						audio.analyserNode &&
						!audio.trackFile
							? (v) => audio.setOutputVolume(v)
							: undefined}
					/>
				{/if}
				{#if isSequenceMode}
					<!-- The export span over the whole project, and the master volume. -->
					<AudioTimeline
						layout="lane"
						label="OUT"
						trackDuration={mixer.duration}
						trackCurrentTime={mixer.currentTime}
						spanStart={mixer.spanStart}
						spanEnd={mixer.spanEnd}
						isPlaying={mixer.playing}
						outputVolume={mixer.outputVolume}
						onPlay={playSpan}
						onPause={pauseTrack}
						onSeek={seekTo}
						onSpanCommit={mixSpanHistory.push}
						onSpanStartChange={(t) => (mixer.spanStart = t)}
						onSpanEndChange={(t) => (mixer.spanEnd = t)}
						onVolumeChange={(v) => mixer.setOutputVolume(v)}
						ariaLabel="Export span"
					/>
				{:else if audioIsMaster}
					<AudioTimeline
						layout="lane"
						label="AUD"
						trackDuration={audio.trackDuration}
						trackCurrentTime={audio.trackCurrentTime}
						spanStart={audio.spanStart}
						spanEnd={audio.spanEnd}
						isPlaying={audio.audioPlaying}
						outputVolume={audio.outputVolume}
						onPlay={playSpan}
						onPause={pauseTrack}
						onSeek={seekTo}
						onSpanCommit={spanHistory.push}
						onSpanStartChange={(t) => (audio.spanStart = t)}
						onSpanEndChange={(t) => (audio.spanEnd = t)}
						onVolumeChange={(v) => audio.setOutputVolume(v)}
					/>
				{/if}
			</TimelineStack>
		{/if}
		{#if isSequenceMode ? !audio.trackFile && !mediaTimeline.audioLanes?.length : !audio.trackFile}
			<TrackAddBar
				onOpenPicker={openTrackPicker}
				hintText="Add music to make effects react to the beat"
			/>
		{/if}
		<input
			bind:this={trackInput}
			type="file"
			accept="audio/*"
			multiple={isSequenceMode}
			onchange={onTrackInputChange}
			hidden
		/>
		<!-- Outside the timeline stack, which is hidden while there's no clock. -->
		<input
			bind:this={sourceInput}
			type="file"
			accept="image/*,video/*"
			multiple
			hidden
			onchange={(e) => {
				const picked = Array.from(e.currentTarget.files ?? []);
				if (picked.length > 0) void addLayerSources(picked);
				e.currentTarget.value = "";
			}}
		/>
	</div>
	{#snippet moshSettings()}
		<div class="mosh-settings-wrapper">
			<MoshSettingsPanel
				bind:moshMin={
					() => fxSetting("moshMin", moshMin),
					(v) => setFxSetting("moshMin", v, (g) => (moshMin = g))
				}
				bind:moshMax={
					() => fxSetting("moshMax", moshMax),
					(v) => setFxSetting("moshMax", v, (g) => (moshMax = g))
				}
				bind:moshStyle={
					() => fxSetting("moshStyle", moshStyle),
					(v) => setFxSetting("moshStyle", v, (g) => (moshStyle = g))
				}
				bind:randomizeOrder={
					() => fxSetting("randomizeOrder", randomizeOrder),
					(v) => setFxSetting("randomizeOrder", v, (g) => (randomizeOrder = g))
				}
				bind:moshAudioLink={
					() => fxSetting("moshAudioLink", moshAudioLink),
					(v) => setFxSetting("moshAudioLink", v, (g) => (moshAudioLink = g))
				}
				bind:moshAudioLinkStrength={
					() => fxSetting("moshAudioLinkStrength", moshAudioLinkStrength),
					(v) =>
						setFxSetting(
							"moshAudioLinkStrength",
							v,
							(g) => (moshAudioLinkStrength = g),
						)
				}
				bind:moshLinkBand={
					() => fxSetting("moshLinkBand", linkBand.value),
					(v) => setFxSetting("moshLinkBand", v, (g) => (linkBand.value = g))
				}
				bind:audioSmoothing={
					() => fxResponse("smoothing", audioSmoothing),
					(v) => setFxResponse("smoothing", v, (g) => (audioSmoothing = g))
				}
				bind:audioPunch={
					() => fxResponse("punch", audioPunch),
					(v) => setFxResponse("punch", v, (g) => (audioPunch = g))
				}
				targetLabel={panelLane?.name ?? null}
				targetOwnsSettings={!!panelLane?.settings}
				onFollowEditor={followEditorSettings}
				labelEditorScope={isSequenceMode}
				{hasAudio}
				showTiming={isSequenceMode || !!audio.trackFile}
				bpm={sequenceBpm}
				{bpmDetecting}
				hasTrack={!!audio.trackFile}
				onDetectBpm={runSequenceBpmDetection}
				onBpmChange={setSequenceBpm}
			/>
		</div>
	{/snippet}

	<!-- Passed only while a clip is selected. -->
	{#snippet layerPanel(section: "clip" | "chain")}
		{#if selectedMediaClip}
			<MediaClipPanel
				lane={selectedMediaLane}
				clip={selectedMediaClip}
				sources={sequenceSources}
				onLaneChange={updateMediaLane}
				onClipChange={updateMediaClip}
				onBeforeEdit={pushMediaHistory}
				onClose={() => (selectedMediaClipId = null)}
				hasTrack={linksHaveAudio}
				spectrumData={liveSpectrum}
				response={selectedMediaLane
					? laneAudioResponse(selectedMediaLane, audioResponse)
					: audioResponse}
				edits={sourceRegistry.edits}
				onEditChange={(id, edit) => sourceRegistry.setEdit(id, edit)}
				onEditingChange={onSourceEditingChange}
				{section}
				chainNote={mediaChainNote}
				sourceHasAudio={!selectedMediaSourceId ||
					!audioBank.isSilent(selectedMediaSourceId)}
				onDetachAudio={isSequenceMode && selectedMediaClip
					? () => detachClipAudio(selectedMediaClip!.id)
					: undefined}
			/>
		{:else if selectedTextClip}
			<TextClipPanel
				lane={selectedTextLane}
				clip={selectedTextClip}
				onLaneChange={updateTextLane}
				onClipChange={updateTextClip}
				onBeforeEdit={pushTextHistory}
				onClose={() => (selectedTextClipId = null)}
				hasTrack={linksHaveAudio}
				spectrumData={liveSpectrum}
				response={audioResponse}
				{section}
				chainNote={textChainNote}
				bpm={sequenceBpm}
			/>
		{/if}
	{/snippet}

	<MobileSheet
		topPanel={selectedMediaClip || selectedTextClip ? layerPanel : undefined}
		settingsLabel="Mosh"
		topPanelLabel={selectedMediaClip ? "Media clip" : "Text clip"}
	>
		{#snippet settings()}
			{@render moshSettings()}
		{/snippet}
		{#snippet effectsPanel()}
			<!-- A selected layer is edited by the top panel instead; the main chain would be a second list. -->
			{#if !selectedMediaClip && !selectedTextClip}
				<EffectsPanel
					headless
					note={fxChainNote}
					bind:effects={getPanelEffects, setPanelEffects}
					noTarget={panelNoTarget}
					rolledNote={panelRolledNote}
					rolledChain={!!panelIntervalClip}
					rolledScope="moshable"
					hasTrack={linksHaveAudio}
					spectrumData={liveSpectrum}
					response={audioResponse}
					onVolumeLinkChange={(index, paramKey, link) => {
						panelBeforeEdit(`link:${index}:${paramKey}`);
						setPanelEffects(
							setVolumeLink(getPanelEffects(), index, paramKey, link),
						);
						markPanelClipEdited();
						fanOutFxEdit();
					}}
					onEffectsReplaced={() => {
						fanOutFxEdit();
						endPanelBurst();
					}}
					onPresetUpdated={seqSyncPreset}
					onPresetApplied={(preset) => {
						const target = selectedFxClip;
						if (target) {
							target.label = preset.name;
							target.presetName = preset.name;
							target.modified = false;
							fanOutFxEdit();
						}
					}}
					onUserEdit={() => {
						markPanelClipEdited();
						fanOutFxEdit();
					}}
					onBeforeUserEdit={panelBeforeEdit}
				/>
			{/if}
		{/snippet}
	</MobileSheet>

	<RecordOverlay
		recording={recordingState.recording}
		recordProgress={recordingState.recordProgress}
		recordFinalizing={recordingState.recordFinalizing}
		onCancel={cancelRecording}
	/>

	{#if dragging}
		<div class="drop-overlay">
			<span
				>{isSequenceMode
					? "Drop images or videos into the pool · Drop audio onto a lane"
					: "Drop image/video to replace · Drop audio to set track"}</span
			>
		</div>
	{/if}

	{#if webcamOpen}
		{#await loadWebcamPanel() then WebcamPanel}
			<WebcamPanel
				mode="record"
				onTransport={takeTransport}
				onTake={(file) => void useTake(file)}
				onClose={() => (webcamOpen = false)}
			/>
		{/await}
	{/if}

	{#if generateOpen}
		{#await loadGeneratePanel() then GeneratePanel}
			<GeneratePanel
				single={!isSequenceMode}
				size={resizeWidth > 0 && resizeHeight > 0
					? { width: resizeWidth, height: resizeHeight }
					: null}
				onUse={useGenerated}
				onClose={() => (generateOpen = false)}
			/>
		{/await}
	{/if}

	{#if showShortcuts}
		{#await loadShortcutsModal() then ShortcutsModal}
			<ShortcutsModal
				groups={shortcutGroups}
				onClose={() => (showShortcuts = false)}
			/>
		{/await}
	{/if}

	{#if showClearSourcesConfirm}
		<ConfirmDialog
			title="Clear all sources?"
			message="Every source is removed from this song, and its layer clips are left with nothing to show until media is added back. Media that other songs still use is kept."
			confirmLabel="Clear sources"
			cancelLabel="Cancel"
			danger
			onConfirm={clearSequenceSources}
			onCancel={() => (showClearSourcesConfirm = false)}
		/>
	{/if}
</div>

<style>
	.editor {
		display: flex;
		height: 100%;
		width: 100%;
		overflow: hidden;
		position: relative;
		background: var(--ink);
	}

	.main-area {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		position: relative;
		min-width: 0;
	}

	/* The extra pixel up top pays for the bottom border, which sits below the padding. */
	.tl-layers {
		display: flex;
		flex-direction: column;
		gap: 2px;
		/* The stack caps its own height, so past a screenful the lanes scroll under the axis. */
		flex: 0 1 auto;
		min-height: 0;
		overflow-y: auto;
		/* Reserved whether or not it scrolls, so the axis doesn't jump sideways when a lane is added. */
		scrollbar-gutter: stable;
		/* The same thumb the horizontal scrollbar below the lanes uses. */
		scrollbar-width: thin;
		scrollbar-color: var(--live-dim) var(--sunken);
	}

	.output-group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		line-height: 1;
		flex-shrink: 0;
	}

	/* Holds the canvas's place so the grid can take the box without tearing the preview down. */
	.preview-slot {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.preview-proxy {
		position: absolute;
		border: none;
		cursor: pointer;
		z-index: 2;
		top: 6px;
		left: 6px;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 5px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.65);
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.55rem;
		line-height: 1.6;
		pointer-events: auto;
	}

	.preview-proxy.ok {
		color: var(--live);
	}

	.preview-proxy.warn {
		color: var(--start);
	}

	.preview-proxy.off {
		color: var(--text-4);
	}

	.preview-slot.hidden {
		display: none;
	}

	@media (max-width: 800px) {
		.output-group :global(.rack-label) {
			display: none;
		}
	}

	/* Below this the strip's controls overrun the viewport; wrapping is the last resort. */
	@media (max-width: 450px) {
		.action-bar {
			flex-wrap: wrap;
			gap: 0.3rem;
			padding: 0.4rem 0.5rem;
		}
	}

	.settings-divider {
		height: 1px;
		background: var(--line);
		margin: 0.15rem 0;
	}

	/* The strip under the preview: a hairline off the canvas, then the switch clusters. */
	.action-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 0.45rem 0.75rem;
		border-top: 1px solid var(--line);
		flex-shrink: 0;
	}

	/* The timeline's top edge, grabbed to rebalance the column; the band costs no height. */
	.tl-split {
		position: relative;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		height: 9px;
		margin-bottom: -9px;
		/* Only the grip takes the pointer, so the band can't shadow the toolbar it lies over. */
		pointer-events: none;
	}

	.tl-split-grip {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 132px;
		height: 9px;
		pointer-events: auto;
		cursor: ns-resize;
		touch-action: none;
	}

	.tl-split-grip::before {
		content: "";
		width: 44px;
		height: 2px;
		border-radius: 1px;
		background: var(--text-4);
		transition:
			width var(--t-fast),
			background var(--t-fast);
	}

	.tl-split-grip:hover::before,
	.tl-split-grip:focus-visible::before,
	.tl-split.held .tl-split-grip::before {
		width: 68px;
		background: var(--live);
	}

	/* The sheet owns the layout on a phone; there is no split to drag. */
	@media (max-width: 800px) {
		.tl-split {
			display: none;
		}
	}

	/* Stands in for the preview while the sequence pool is empty. */
	.no-media {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.7rem;
		max-width: 26rem;
		padding: 2rem;
		border: 1px dashed var(--line-strong);
		border-radius: var(--r-3);
		background: var(--surface);
		text-align: center;
	}

	.media-spinner {
		width: 18px;
		height: 18px;
		border: 2px solid var(--line);
		border-top-color: var(--mosh);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.no-media-label {
		color: var(--mosh);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.16em;
	}

	.no-media-text {
		margin: 0;
		color: var(--text-3);
		font-size: 0.82rem;
		line-height: 1.5;
	}

	.no-media-actions {
		display: flex;
		gap: 0.5rem;
	}

	.no-media-btn {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-2);
		background: var(--raised);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 0.68rem;
		letter-spacing: 0.12em;
		cursor: pointer;
		transition:
			border-color var(--t-fast),
			color var(--t-fast);
	}

	.no-media-btn:hover {
		border-color: var(--mosh);
		color: var(--mosh);
	}

	.no-media-hint {
		color: var(--text-4);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
	}

	.library-cluster {
		display: none;
	}

	@media (max-width: 800px) {
		.action-bar {
			gap: 0.4rem;
			padding: 0.5rem;
		}

		.library-cluster {
			display: inline-flex;
		}
	}

	.mosh-setting-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.mosh-setting-row label,
	.rec-duration-label {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-3);
		min-width: 72px;
		flex-shrink: 0;
	}

	.rec-duration-unit {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	/* Under the field, aligned past the label so the row still reads as one. */
	.rec-duration-presets {
		display: flex;
		gap: 4px;
		margin: -0.25rem 0 0 calc(72px + 0.5rem);
	}

	.rec-preset-btn {
		padding: 0.15rem 0.4rem;
		background: var(--sunken);
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		cursor: pointer;
	}

	.rec-preset-btn:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}

	.rec-preset-btn.active {
		color: var(--live);
		border-color: var(--live-dim);
	}

	.mosh-setting-row select {
		flex: 1;
		background: var(--sunken);
		color: var(--text-2);
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		padding: 0.2rem 0.4rem;
		font-family: var(--font-mono);
		font-size: 0.66rem;
		cursor: pointer;
		outline: none;
	}

	.mosh-setting-row select:focus {
		border-color: var(--line-strong);
	}

	.mosh-setting-val {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--text-2);
		min-width: 20px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.editor.drag-over::before {
		content: "";
		position: absolute;
		inset: 0;
		z-index: 99;
		border: 2px dashed var(--line-strong);
		border-radius: var(--r-3);
		pointer-events: none;
	}

	.rec-start-btn {
		margin-top: 0.25rem;
		padding: 0.45rem 1rem;
		border: 1.5px solid var(--rec-dim);
		border-radius: var(--r-2);
		background: rgba(255, 95, 86, 0.1);
		color: var(--rec);
		font-family: var(--font-mono);
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			background var(--t-fast),
			color var(--t-fast);
	}

	.rec-start-btn:hover {
		background: rgba(255, 95, 86, 0.2);
		color: #ffa8a2;
	}

	.drop-overlay {
		position: absolute;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(6, 6, 8, 0.72);
		backdrop-filter: blur(2px);
		pointer-events: none;
	}

	.drop-overlay span {
		font-family: var(--font-mono);
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--text);
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	@media (max-width: 800px) {
		.main-area {
			padding-bottom: 44px;
		}
	}
</style>
