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
		Sparkles,
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
	import { addTrack } from "../../audio/track-library";
	import { editorShortcutGroups } from "../../editor/shortcut-groups";
	import { createKeyboardHandler } from "../../editor/keyboard";
	import {
		clearEffects as clearEffectsFn,
		generateMosh,
	} from "../../editor/mosh";
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
		type FreqBand,
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
	import { clipAt } from "../../timeline/clips";
	import type { LayerPick } from "../../editor/layer-pick";
	import { SequenceSourceRegistry } from "../../editor/sequence-sources.svelte";
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

	// An overlay behind a key; its chunk waits until someone asks for help.
	const loadShortcutsModal = lazy(() => import("../ui/ShortcutsModal.svelte"));
	const loadGeneratePanel = lazy(
		() => import("../generators/GeneratePanel.svelte"),
	);

	interface Props {
		file: File;
		onfile: (f: File) => void;
		/** Sequence mode: the rest of the media pool, alongside `file`. */
		extraFiles?: File[];
		initialAudioFile?: File | null;
		/** Library id of `initialAudioFile`, when it came from a saved sequence. */
		initialTrackId?: string | null;
		/** The lane timeline belongs to 'sequence' alone — 'single' is one
		 * source and one effect chain, and the two persist separately. */
		mode?: "single" | "sequence";
		/** Single mode: work restored from a saved session, if reopened from one. */
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
		mode = "single",
		initialSession = null,
		warmCanvas = null,
		warmRenderer = null,
		onExit,
	}: Props = $props();

	let isSequenceMode = $derived(mode === "sequence");
	let dragging = $state(false);
	let _mobileSheetRef: MobileSheet | undefined = undefined;

	// Sequence mode never plays `file` itself: the media there all comes from
	// the pool, through the frame drivers, and the frame starts black. So the
	// editor's own player — and everything that hangs off it, from the span
	// bar to the export's decode loop — is single mode's alone.
	let isVideo = $derived(!isSequenceMode && file.type.startsWith("video/"));
	// The webcam, live: a `<video>` on the camera stream stands in for the file's
	// player. No span, no seeking, no session — the export runs in real time
	// off whatever the camera shows while it records.
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
			// Swapped out for a file — re-input's frame, a drop: the camera is let
			// go. Undo hands the live file back, and its lookup re-opens it.
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
	// Treat positions this close to the span end as "at the end" when deciding
	// whether play should restart from the span start
	const VIDEO_END_EPSILON = 0.1;
	/** Set while the video clock sits past the end of its span — the element
	 * path's copy of what VideoPreviewPlayer tracks for itself. */
	let videoPastSpan = $state(false);
	// Whether the video file has an audio track. Starts false so we don't hook a
	// silent video into Web Audio before the probe confirms it — Firefox pins any
	// element captured via createMediaElementSource to realtime, ignoring
	// playbackRate (mozilla bug 1517199), which breaks the speed control.
	let videoHasAudio = $state(false);

	// WebCodecs-driven preview playback. When non-null it replaces the <video>
	// element as the frame source (the element stays mounted but inert, kept as
	// the recording fallback). Null when the file can't be demuxed/decoded or
	// has rotation metadata — those keep the element-driven preview.
	let previewPlayer = $state<VideoPreviewPlayer | null>(null);

	// Single read-side view of the active video source (WebCodecs player when
	// present, else the fallback <video> element's tracked state), so callers
	// don't repeat the `previewPlayer ? … : …` fork. The write side stays in
	// playVideo/pauseVideo/seekVideoTo. These read reactive state, so avoid them
	// inside untrack() blocks that deliberately sample the live element clock.
	let videoClock = $derived(
		previewPlayer ? previewPlayer.currentTime : videoCurrentTime,
	);
	let videoIsPlaying = $derived(
		previewPlayer ? previewPlayer.playing : videoPlaying,
	);

	// The file the current preview player was built for — plain, so the proxy
	// swap below can tell "same media, better decoder" from "new media".
	let playerFile: File | null = null;

	$effect(() => {
		if (!isVideo) return;
		// The file's proxy, once one has landed — see the single-mode proxy
		// below.
		const proxy = singleProxyFor === file ? singleProxy : null;
		const previewFile = proxy ?? file;
		// Frames arrive at the proxy's size, but the media's own size and
		// duration are what the UI reports and what the output defaults to —
		// anchored to the original so the swap moves nothing. Read untracked:
		// these describe the outgoing player, and tracking them would rebuild
		// the player each time the swap writes them back.
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
			// Player owns the preview now — the element is only a recording fallback
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
			// If the videoHasAudio probe finished first, ensureVideoAudioGraph
			// already built an element-sourced graph for the now-inert element —
			// tear it down and rebuild sourceless for the player.
			if (audio.audioContext && !audio.trackFile) audio.disposeAudioGraph();
			ensureVideoAudioGraph();
			// Starts paused on purpose — see videoAudioUnlocked.
		});
		return () => {
			cancelled = true;
			player?.dispose();
			previewPlayer = null;
		};
	});

	// ── Single-mode preview proxy ──────────────────────────────────────────
	// Single mode keeps its file out of the pool, so its proxy has no registry
	// to live in: one job per file, swapped into the player when it lands.
	let singleProxy = $state<File | null>(null);
	/** The file `singleProxy` belongs to — plain, so a stale proxy can't leak
	 * into the player effect after the file changed under it. */
	let singleProxyFor: File | null = null;
	let singleJob: ProxyJob | null = null;
	let singleJobFor: File | null = null;
	/** Set when optimization failed, so it isn't retried in a loop; the toast's
	 * Retry action clears it. */
	let singleProxyFailed = $state(false);
	/** Single mode has no chip to hang the proxy's state on, so it keeps the
	 * same fields a pooled source carries and shows them over the preview. */
	let singleProxyPending = $state(false);
	let singleProxyProgress = $state<number | undefined>(undefined);
	let singleProxySize = $state<{ width: number; height: number } | null>(null);
	let singleProxyReason = $state<string | undefined>(undefined);
	/** The user asked this video to preview from the original — see
	 * video/proxy-preference.ts. Read back from there per file, so the choice
	 * survives a reload and follows the file into the other modes. */
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
			// Only meaningful for media a proxy would be built for; a smaller
			// video says nothing either way.
			proxyDisabled:
				singleProxyDisabled &&
				needsProxy(previewPlayer?.width ?? 0, previewPlayer?.height ?? 0),
		}),
	);

	/**
	 * Turn the preview proxy for the single-mode file on or off — the badge over
	 * the preview is the entry point. Off drops the proxy the player is on, so
	 * the next frame comes from the original; the choice is remembered for this
	 * file across sessions and modes.
	 */
	function setSingleProxyEnabled(enabled: boolean) {
		const f = file;
		if (!f) return;
		setProxyDisabled(f, !enabled);
		// Cleared rather than set directly: the effect below re-runs off the back
		// of this and reads the choice back out, which is the one place that
		// decides whether a job starts.
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
		// The player is the gate as well as the size source: files on the
		// <video>-element fallback (rotation metadata, undecodable) decode
		// through the browser's own hardware stack and don't need a proxy.
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
			// A proxy that won't open is worse than none — the preview would freeze
			// instead of grinding through the original — so it gets the same
			// decodability check an added file gets before it is trusted.
			let openedSize: { width: number; height: number } | null = null;
			if (proxy) {
				const opened = await openVideoFrameSource(proxy);
				if (opened) {
					// The real size of the finished file, which is what the preview
					// reports: a stored proxy never announced one, and a fresh one only
					// announced the size it was aiming at.
					openedSize = { width: opened.width, height: opened.height };
				}
				opened?.queue.dispose();
				if (!opened) {
					proxy = null;
					// A stored one that no longer opens has to go, or the retry would
					// find it again and fail the same way.
					if (stored) void deleteSequenceMediaProxy(f).catch(() => {});
				}
			}
			if (proxy) {
				// Persisted under the file's own id, so re-opening the same video
				// skips the transcode even though single mode saves no session until
				// it has been edited.
				if (!stored) void putSequenceMediaProxy(f, proxy).catch(() => {});
				singleProxy = proxy;
				singleProxyFor = f;
				singleProxySize = openedSize;
				singleProxyPending = false;
				singleProxyProgress = undefined;
			} else {
				// Not auto-retried: a persistent failure would loop. The toast's
				// action is the explicit way back.
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

	// Push editor state into the player
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

	// Probe the video file for an audio track. Gates both the volume slider and
	// the Web Audio capture in ensureVideoAudioGraph. On demux failure assume
	// audio is present so exotic-but-playable files keep their sound.
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

	// Sequence mode has no still to save — a lane timeline is a video by
	// definition — so it skips the picker and stays on WebM.
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

	// A generated file re-renders at the output size; the preview reads the
	// re-render while `file` (the identity sessions key on) stays put. Sequence
	// mode's pool does the same for its own entries — this is only for the file
	// the editor's own player shows.
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

	// ── Webcam take ──
	// A take is a performance to the song: the panel counts in, the song plays
	// from the playhead while the camera records, and the take lands on the
	// timeline at the second it started — on the selected lane if it has room
	// there, else on a lane of its own. From then on it is any other clip.
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
	/**
	 * Restored instances are dropped if their definition no longer exists —
	 * a session can outlive an effect being renamed or retired, and a stale
	 * defId would render as a hole in the chain.
	 */
	function restoredEffects(): EffectInstance[] | null {
		const saved = untrack(() => initialSession)?.effects;
		if (!Array.isArray(saved) || saved.length === 0) return null;
		const known = restoreEffects(saved);
		return known.length > 0 ? known : null;
	}

	let effects: EffectInstance[] = $state(
		restoredEffects() ?? loadInitialEffects(),
	);

	// Hand the live chain to the feedback modal, which is mounted at the app
	// root and has no other way to see it.
	$effect(() => {
		setFeedbackChain(() => $state.snapshot(effects) as EffectInstance[]);
		return () => setFeedbackChain(null);
	});

	const saved = loadSettings();
	let moshMin = $state(saved.moshMin ?? DEFAULT_SETTINGS.moshMin);
	let moshMax = $state(saved.moshMax ?? DEFAULT_SETTINGS.moshMax);
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


	const audio = new AudioManager({
		// The base chain follows the editor's response; every active fx and
		// media lane follows its own, under its own envelope state. The text
		// layers follow the editor's response — they have no settings of their
		// own — but each still gets its own scope, so one layer's smoothing
		// never steps another's.
		getLinkGroups: (): AudioLinkGroup[] => [
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
			// The chain on each media lane is its clip's under the playhead — or
			// the roll an auto clip made for this tick — so it is read off the
			// resolved layers rather than the lanes. The lane stays the scope.
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
		],
		initialOutputVolume: saved.outputVolume ?? DEFAULT_SETTINGS.outputVolume,
		initialLoop: saved.loopAudio ?? DEFAULT_SETTINGS.loopAudio,
	});

	// Close the AudioContext on unmount so repeated visits don't leak contexts.
	$effect(() => () => audio.disposeAudioGraph());

	// Smooth playhead: pull the element clock every frame while playing (the
	// ~4 Hz timeupdate event alone makes the playhead jump)
	$effect(() => {
		if (!audio.audioPlaying) return;
		let raf = requestAnimationFrame(function loop() {
			audio.tickCurrentTime();
			// Per frame, not per timeupdate: the span end is a visible line on the
			// timeline, and playback has to turn round on it rather than a quarter
			// second past it.
			audio.checkSpanEnd();
			raf = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(raf);
	});

	// Sync audioEl DOM binding into the manager
	let audioEl = $state<HTMLAudioElement | undefined>(undefined);
	$effect(() => {
		audio.setAudioEl(audioEl);
	});

	// Seed track from audio selected on the upload screen
	$effect(() => {
		if (initialAudioFile && !audio.trackFile) {
			audio.trackFile = initialAudioFile;
			// Opened from a saved song: adopt its id and its stored timeline.
			if (initialTrackId) adoptLibraryTrack(initialTrackId);
		}
	});

	// Mute video when explicit audio track is active; re-hook video audio when cleared
	$effect(() => {
		if (!isVideo || !videoEl) return;
		if (audio.trackFile) {
			videoEl.muted = true;
		} else {
			ensureVideoAudioGraph();
		}
	});

	$effect(() => {
		// subscribe to all settings
		moshMin;
		moshMax;
		randomizeOrder;
		moshAudioLink;
		moshAudioLinkStrength;
		linkBand.value;
		audioSmoothing;
		audioPunch;
		showFps;
		showSpectrum.value;
		audio.outputVolume;
		audio.loopAudio;
		videoLoop;
		// Merged, not replaced: settings written from outside the editor (the
		// upload screen's mode) live under the same key.
		updateSettings({
			moshMin,
			moshMax,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			moshLinkBand: linkBand.value,
			audioSmoothing,
			audioPunch,
			showFps,
			showSpectrum: showSpectrum.value,
			outputVolume: audio.outputVolume,
			loopAudio: audio.loopAudio,
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
	/** Read-only now: output size moved into the per-project render settings.
	 * Entries written before that still restore through the fallback below. */
	const sizeStore = createTrackStore<{ width: number; height: number }>(
		"openmosh-single-size",
	);

	// Persist span changes for library tracks. The span sits at 0/0 from the
	// moment a track id is adopted until the audio element reports its duration,
	// so writing unguarded would overwrite the saved span with an empty one —
	// permanently, whenever the tab is left before that metadata ever arrives.
	$effect(() => {
		const start = audio.spanStart;
		const end = audio.spanEnd;
		const restorePending = audio.pendingSpan !== null;
		if (!currentTrackId || restorePending || audio.trackDuration <= 0) return;
		if (end <= start) return;
		spanStore.save(currentTrackId, { spanStart: start, spanEnd: end });
	});

	// ── Span undo ────────────────────────────────────────────────────────────
	// The span handles are an edit like any other — see span-history.svelte.ts.
	const spanHistory = createSpanHistory(audio);
	$effect(() => spanHistory.trackChanged(currentTrackId));

	let trackInput: HTMLInputElement;

	/**
	 * Latched when a track restores a size, so the default below doesn't
	 * immediately overwrite it — the two race whenever media finishes loading
	 * after the track was adopted. Consumed once: picking new media afterwards
	 * is deliberate, and that media's own size should win.
	 */
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
		const f = trackInput?.files?.[0];
		if (f) {
			clearTrack();
			audio.trackFile = f;
			trackInput.value = "";
		}
	}

	function clearTrack() {
		// Before the key changes out from under them — see flushSequenceSave.
		flushSequenceSave();
		flushMediaPoolSave();
		audio.clearTrack();
		currentTrackId = null;
		sizeRestoredFromTrack = false;
		// Belongs to the song that just left; whatever arrives next restores or
		// detects its own.
		sequenceBpm = 0;
	}

	/**
	 * Pull back whatever was stored against a song. Returns false when it has
	 * nothing saved, so callers can decide what an empty result means.
	 *
	 * Every path that learns a track id has to run this, not just loading one
	 * from the library: a track picked on the upload screen is adopted by id
	 * only, and without a restore its timeline would sit unreachable in storage.
	 */
	async function applySavedTrackState(
		trackId: string,
		/** Moving between two songs starts the new one clean when it has nothing
		 * saved; arriving at the first song keeps what's on screen, since that
		 * work was made for it and had nowhere else to be. */
		clearOnMissing = false,
	): Promise<void> {
		const savedSpan = spanStore.load(trackId);
		// An empty span is never something the user chose — it's an entry left
		// behind by the overwrite above. Fall through to the whole track.
		if (savedSpan !== null && savedSpan.spanEnd > savedSpan.spanStart) {
			audio.pendingSpan = {
				start: savedSpan.spanStart,
				end: savedSpan.spanEnd,
			};
		}
		const key = seqKeyPrefix + trackId;
		loadedTimelineKey = null;
		const savedSeq = await loadSeqEntry(trackId);
		// A later switch overtook this load while it was out; that one owns the
		// state now, and applying this would restore the song we already left.
		if (seqStoreKey !== key) return;
		loadedTimelineKey = key;
		if (savedSeq === null) {
			if (clearOnMissing) restoreFxLanes(undefined);
			seedLayerKey = key;
			return;
		}
		// The BPM comes back in both modes — single mode has no clips to time,
		// but beat-synced effects read the same tempo. The keys are already
		// per-mode, so neither mode reads the other's number.
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

	/** The editor learned a track's library id without being asked to load it —
	 * the upload screen's track, saved or already present. */
	function adoptLibraryTrack(trackId: string) {
		if (currentTrackId === trackId) return;
		currentTrackId = trackId;
		void applySavedTrackState(trackId);
	}

	/**
	 * Give a song that arrived without a library id one.
	 *
	 * A track picked on the upload screen, dropped on the editor or chosen from
	 * the file picker has no id — only the library drawer hands one out. But the
	 * id is the key everything per-song is saved under, so without this an entire
	 * session's timeline, text and span were silently never written: `seqStoreKey`
	 * is null with no track id, and every save path returns early on that.
	 *
	 * addTrack matches the library by name and size first, so re-picking a file
	 * reopens the work already saved for it instead of forking a second identity.
	 */
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
		const switchingSongs = !!currentTrackId && currentTrackId !== trackId;
		clearTrack();
		currentTrackId = trackId;
		audio.trackFile = file;
		// The media pool is deliberately left alone on a switch — see the pool
		// restore effect.
		void applySavedTrackState(trackId, switchingSongs);
		if (autoplay) audio.autoplayOnLoad = true;
	}

	// An AudioContext created before the user has interacted with the page starts
	// suspended and the browser refuses to resume it ("An AudioContext was
	// prevented from starting automatically"), leaving the preview silent until
	// some later gesture. The preview therefore starts paused and the graph is
	// built on the first play — inside the gesture — so it is never born blocked.
	// Reactive so the callers that re-run ensureVideoAudioGraph on state changes
	// pick it up, and so the videoHasAudio probe is re-read once it flips.
	let videoAudioUnlocked = $state(false);

	function ensureVideoAudioGraph() {
		if (!videoAudioUnlocked) return;
		// Skip silent videos: there's nothing to hear or analyze, and capturing
		// them into Web Audio breaks the speed control in Firefox (see videoHasAudio).
		if (audio.audioContext || audio.trackFile || !videoHasAudio) return;
		if (previewPlayer) {
			// WebCodecs preview: sourceless graph, the player connects its own
			// AudioBufferSourceNode into normalizeGain.
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
		// First play is a user gesture — the point at which the audio graph can be
		// created unblocked.
		videoAudioUnlocked = true;
		ensureVideoAudioGraph();
		audio.audioContext?.resume();
		// Start from the static marker when the video owns the timeline clock; a
		// video slaved to a track keeps following the track instead.
		const fromMarker = !!timelineAxis && videoIsMaster;
		if (fromMarker && !videoIsPlaying) seekVideoTo(timelineAxis!.staticTime);
		// Past the span end is where the user put the marker, so it plays from
		// there and runs on to the end of the video. Without a marker of its own
		// a slaved video still restarts at the span. Before the span start there
		// is nothing to watch yet either way.
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

	// Not gated on audioContext: links are data, and the graph is only built
	// on first play, so requiring it drops links when moshing before playback.
	const hasAudio = $derived(!!audio.trackFile || (isVideo && videoHasAudio));

	function getMoshOptions() {
		return {
			moshMin,
			moshMax,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			moshLinkBand: linkBand.value,
			hasAudio,
		};
	}

	// ── Sequence mode ────────────────────────────────────────────────────────
	// Stacked effect lanes over the frame. They carry no media — a clip only
	// says "also run these effects here" — and their chains run in lane order
	// over what the media layers composited. See editor/fx-lanes.ts.
	let fxLanes = $state<FxLane[]>([]);
	let selectedFxClipId = $state<string | null>(null);
	let selectedFxClipIds = $state<string[]>([]);

	// With an external track the audio is the master clock (matches export,
	// where the audio span sets the duration and the video loops inside it).
	// Clips then live on the audio timeline, not the video's.
	//
	// Loading a track file is enough to make it master — deliberately not
	// "…and its duration is known". The duration lands a beat after the file
	// does, and treating that window as video-mastered corrupted the save: the
	// store key fell back to the video's (so a reload restored a stale
	// video-keyed entry over the song's), and the fit re-trimmed clips built
	// against a 3-minute song onto a 10-second one. Until the
	// duration arrives `seqMasterDuration` is simply 0, which every consumer
	// already reads as "no timeline yet".
	let seqMasterIsAudio = $derived(!!audio.trackFile);
	let seqMasterDuration = $derived(
		seqMasterIsAudio ? audio.trackDuration : videoDuration,
	);

	// Beats per minute for this song, feeding the auto clips' re-roll
	// spacing. 0 = not detected yet.
	let sequenceBpm = $state(0);

	interface SeqEntry {
		/**
		 * Absent on entries saved while the file the editor opened with was the
		 * segments' implicit media. Those segments render that file until told
		 * otherwise, so loading one of them pins it on — see loadSeqEntry.
		 */
		v?: number;
		/** The segment lane, on entries from before it was retired. Folded into
		 * the fx and media lanes on load (see legacy-segments.ts), never saved. */
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
	}

	/** Bumped when what a saved entry means changes — see SeqEntry.v. */
	const SEQ_ENTRY_VERSION = 2;

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

	// Keyed by master clock — that's what clip times are relative to.
	let videoSeqKey = $derived(
		isVideo ? `video:${file.name}:${file.size}:${file.lastModified}` : null,
	);
	// The song/video this editor is saving against, before the mode prefix. The
	// media pool keys off this directly: pools only ever exist on the sequence
	// route, so there is nothing to disambiguate and prefixing would orphan the
	// ones already in IndexedDB.
	let seqBaseKey = $derived(
		seqMasterIsAudio ? currentTrackId : (videoSeqKey ?? currentTrackId),
	);

	/**
	 * Single and sequence are the same component, so one un-namespaced store had
	 * them overwriting each other: a song worked on in the lane editor came
	 * back with its timeline (and the sequence mode) forced on in single mode,
	 * and any edit there wrote back over it. The prefix keeps the two apart.
	 */
	const seqKeyPrefix = $derived(isSequenceMode ? "seq:" : "single:");
	let seqStoreKey = $derived(seqBaseKey && seqKeyPrefix + seqBaseKey);

	/**
	 * The key whose stored timeline has landed; saving waits for the key on screen
	 * to match. Loads are async, and a debounce firing mid-switch would write the
	 * outgoing song's timeline under the incoming song's key.
	 */
	let loadedTimelineKey: string | null = null;

	/**
	 * Read this mode's entry for a song, falling back once to the legacy
	 * un-prefixed entry. Only the sequence route falls back: those entries hold
	 * real timelines worth keeping, whereas letting single mode read them is the
	 * exact leak the prefix exists to stop.
	 */
	async function loadSeqEntry(baseKey: string): Promise<SeqEntry | null> {
		const entry =
			(await loadTimeline<SeqEntry>(seqKeyPrefix + baseKey)) ??
			(isSequenceMode ? await loadTimeline<SeqEntry>(baseKey) : null);
		// Before the layers took the media over, a segment with no source of its
		// own drew the file the editor opened with — which is the first of a
		// saved pool, and so the file this editor opened with. Pin it, or every
		// such segment would migrate to a clip showing nothing.
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
			// Marked even with nothing to restore: a video with no saved timeline
			// still has to be able to save the one being built for it.
			loadedTimelineKey = storeKey;
			if (saved === null) return;
			restoreTextTimeline(saved.text);
			restoreMediaTimeline(saved.media);
			sourceRegistry.restoreEdits(saved.sourceEdits);
		})();
	});

	/** A restored BPM wins over any detection already in flight — the clips
	 * were built against it, so re-deriving it would retime them. Restoring
	 * nothing leaves the detection to land. */
	function restoreSequenceBpm(bpm: number) {
		if (bpm > 0) bpmEpoch++;
		sequenceBpm = bpm;
	}

	// Persist the sequence timeline per library track (deep read via snapshot,
	// so clip/effect edits are captured too). Skipped while playing: the
	// per-frame volume-link tick mutates values inside the clips' chains — an
	// ungated deep read here re-ran the snapshot + localStorage JSON round-trip
	// every frame, tanking preview FPS proportionally to clip count. Persisting
	// settles on pause; the debounce keeps slider/clip drags from writing
	// localStorage per input event.
	let seqSaveTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const playing = audio.audioPlaying || videoIsPlaying;
		if (playing) return;
		const bpm = sequenceBpm;
		const text = layersAsLoaded(
			$state.snapshot(textTimeline) as TextTimeline,
			"text",
		);
		const media = $state.snapshot(mediaTimeline) as MediaTimeline;
		const fx = $state.snapshot(fxLanes) as FxLane[];
		const sourceEdits = $state.snapshot(sourceRegistry.edits) as Record<
			string,
			SourceEdit
		>;
		const key = seqStoreKey;
		if (!key || key !== loadedTimelineKey) return;
		clearTimeout(seqSaveTimer);
		seqSaveTimer = setTimeout(() => {
			void saveTimeline(key, {
				v: SEQ_ENTRY_VERSION,
				bpm,
				text,
				media,
				fx,
				sourceEdits,
			}).then(reportSeqSave);
		}, 300);
	});

	/** Only the transition into failure is announced, or an unsaveable timeline
	 * would toast on every debounce tick. */
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

	/**
	 * Write the current timeline under the current key, now.
	 *
	 * The effect above can't cover a track switch on its own. Svelte batches the
	 * whole switch into one update, so by the time it re-runs `seqStoreKey` is
	 * already the *new* track and the lanes may already have been
	 * replaced — the outgoing track's edits were never written, and any pending
	 * debounce for it gets cancelled on the way past. Worse, the effect is gated
	 * on playback, so editing while the track plays (the normal way to use this)
	 * schedules nothing at all until a pause that the switch itself supplies too
	 * late. Every path that changes or drops the song calls this first.
	 */
	function flushSequenceSave() {
		clearTimeout(seqSaveTimer);
		const key = seqStoreKey;
		if (!key || key !== loadedTimelineKey) return;
		void saveTimeline(key, {
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
		}).then(reportSeqSave);
	}

	// Reloading or closing mid-playback would otherwise lose the session, for
	// the same reason: no pause ever arrives to settle the debounce.
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

	// Pull the clip lanes back inside the master clock when it changes (track
	// loaded/swapped/cleared). Swapping a 2-minute song for a 90-second one
	// leaves every clip built against the old length hanging past the end of
	// the timeline, where it still renders but the ruler can no longer reach it.
	//
	// Keyed off the master clock alone, and off the timelines untracked: with no
	// track `textDuration` falls back to the record length, and trimming clips on
	// every nudge of that slider would eat work still in front of the user.
	$effect(() => {
		const duration = seqMasterDuration;
		if (duration <= 0) return;
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
		if (seqMasterIsAudio) return audio.trackCurrentTime;
		return videoClock;
	}

	// ── FX lanes ─────────────────────────────────────────────────────────────
	// Their own undo stack, for the same reason the text timeline has one.
	// Ctrl+Z reaches it when an fx edit is the newest.
	const fxHistory = createSnapshotHistory<FxLane[]>();

	function pushFxHistory(coalesceKey?: string) {
		fxHistory.push($state.snapshot(fxLanes) as FxLane[], coalesceKey);
	}

	function setFxLanes(next: FxLane[]) {
		fxLanes = next;
		// Splits, deletes and undo retire clip ids — drop their mosh stacks so a
		// later clip can't inherit rolls that were never its own.
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

	/** What a new lane starts from: the editor's current settings, copied. From
	 * then on the lane is its own — the panel edits whichever is selected. */
	function currentFxLaneSettings(): FxLaneSettings {
		return {
			moshMin,
			moshMax,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			moshLinkBand: linkBand.value,
			audioResponse: { ...audioResponse },
		};
	}

	function addFxLane() {
		// Full timeline width: a new lane arrives with one clean clip to work on,
		// rather than as bare space the user has to draw over first.
		const next = appendFxLane(
			fxLanes,
			currentFxLaneSettings(),
			seqMasterDuration,
			nextLayerZ(layerOrder),
		);
		// At the cap this is a no-op; recording it would leave a Ctrl+Z entry
		// that undoes nothing.
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

	// ←/→ walk one fx clip's moshes. Its own stack per clip, keyed by clip id
	// — MoshHistory is agnostic about what the id names, and an FxClip carries
	// exactly the fields it snapshots.
	const fxMoshHistory = new MoshHistory<MoshSnapshot>();

	/**
	 * The fx clip the mosh gestures act on: the selected one, and only that.
	 *
	 * No playhead fallback: several lanes can hold a clip at one time, so "the
	 * clip under the playhead" names no single thing.
	 */
	function activeFxClip(): FxClip | null {
		return selectedFxClip;
	}

	/**
	 * Roll the given clips. Mosh history only — never the fx edit stack: a mosh
	 * is not a hand-edit, and recording it would leave a Ctrl+Z entry behind
	 * every arrow press, with the two histories driving each other. Same rule
	 * every other mosh follows.
	 */
	function fxRoll(clipIds: string[]) {
		const ids = new Set(clipIds);
		for (const clip of fxClipsById(ids)) {
			fxMoshHistory.seed(
				clip.id,
				fxClipMoshSnapshot($state.snapshot(clip) as FxClip),
			);
		}
		fxLanes = rollFxClips(fxLanes, ids, getMoshOptions());
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

	// Same resolver the export builds, so interval rolls reproduce exactly.
	const previewFxSource = createFxLayerSource(() => fxLanes, getMoshOptions);

	/**
	 * Which lane the settings panel is aimed at: the selected clip's lane (fx
	 * or media), or an fx lane picked by its name in the gutter. Null means the
	 * editor's own settings, which is what single mode always rolls under.
	 */
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

	/** Panel edit: writes to the lane when one is selected, otherwise to the
	 * editor's settings. A lane still on the defaults materializes them first,
	 * so an edit pins the whole set rather than one stray field. */
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

	/** Hand a lane back to the editor's settings: drops its own, so the panel
	 * reads the editor's again and the lane rolls under whatever they become. */
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

	/** A lane's audio response, falling back to the editor's for lanes that were
	 * made before they had their own. */
	function fxLaneResponse(laneId: string) {
		const lane = fxLanes.find((l) => l.id === laneId);
		return lane ? laneAudioResponse(lane, audioResponse) : audioResponse;
	}

	/**
	 * The stacked lanes for this frame, with their fade weights. The selected
	 * clip is forced in so a tweak is visible wherever the playhead sits — and,
	 * because forcing replaces its lane's own contribution, the same instance
	 * can never land in the chain twice (two passes would then share one
	 * feedback buffer).
	 */
	let fxLayers = $derived(
		isSequenceMode ? previewFxSource(seqMasterTime(), selectedFxClipId) : [],
	);

	/** The same effects flat, for the panel-facing chain and the audio tick. */
	let fxChain = $derived(flattenFxLayers(fxLayers));

	// ── Sequence media pool ──────────────────────────────────────────────────
	// Every piece of media the project can draw: the layers' clips pick from
	// here. The file the editor opened with is one entry
	// among the rest — a new project lands it on the first layer (see the
	// seeding effect below) and nothing else about it is special.
	// Bumped when a late upload — a video frame or a lazily-decoded image —
	// lands while paused, so the canvas redraws with it. Gated on paused:
	// during playback the rAF loop already redraws, and ticking state per
	// frame would be pure reactivity churn.
	let sourceTick = $state(0);
	const bumpSourceTick = () => {
		if (!seqPlaying()) sourceTick++;
	};

	const sourceRegistry = new SequenceSourceRegistry(bumpSourceTick);
	let sequenceSources = $derived(sourceRegistry.sources);
	/** The pool is empty until the opening file lands in it, so the placeholder
	 * waits for that rather than flashing over every load. */
	let poolFilled = $state(false);
	let noSequenceMedia = $derived(
		isSequenceMode && poolFilled && sequenceSources.length === 0,
	);
	/**
	 * Held from mount until everything the editor opens with is in the pool:
	 * the files it was handed, the song's stored pool, and the thumbnails the
	 * grid draws them with. Opening on the first source alone left the rest
	 * landing one by one behind a live preview, which read as broken rather
	 * than loading. Proxies are deliberately not waited on — a transcode runs
	 * for minutes and the chip already carries its progress. Sequence-only
	 * through `mediaLoading`; single mode never shows the overlay.
	 */
	let openingMedia = $state(true);
	/** The mount-time adds (the opened file and its extras) have finished. */
	let mountMediaDone = $state(false);
	$effect(() => {
		if (!openingMedia) return;
		// A song being registered has no key yet; its pool restore is still to
		// come, so the key is only settled once there is one or nothing to wait
		// for.
		const keySettled = !!seqBaseKey || !audio.trackFile;
		const settled =
			mountMediaDone &&
			keySettled &&
			(poolReady || !seqBaseKey) &&
			sourceRegistry.loadingTotal === 0 &&
			!sequenceSources.some((s) => s.thumbPending);
		if (settled) openingMedia = false;
	});
	/** Media is being probed and nothing has landed in the pool yet, so the
	 * canvas is black — the placeholder says so instead of the user guessing.
	 * After the opening load, a first source is enough: the frame is worth
	 * more than an overlay and the grid's own chips carry the rest. */
	let mediaLoading = $derived(
		isSequenceMode &&
			(openingMedia ||
				(sourceRegistry.loadingTotal > 0 && sequenceSources.length === 0)),
	);

	onMount(() => {
		void (async () => {
			// Single mode has no pool: its one file is the frame, and `file` can
			// be replaced from under us.
			if (!isSequenceMode) return;
			try {
				// Opened from a saved song: these blobs came straight out of
				// storage, so writing them back would rewrite the whole pool for
				// nothing.
				const persist = !initialTrackId;
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

	// ── Per-song media pool ──────────────────────────────────────────────────
	// Keyed the same way as the sequence timeline (seqBaseKey), so loading a
	// track brings back both the lanes and the media they were built from.
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
				// Storage blocked — carry on with whatever is loaded.
			}
			if (poolKey !== key) return;
			// A song with a saved pool swaps to it. A song with none keeps what's
			// loaded and adopts it on the next save — deliberately *not* the same
			// rule the timeline follows. Clearing a timeline costs a few clicks;
			// clearing the pool throws away media the user assembled by hand, and
			// once no pool references those blobs, pruning deletes them for good.
			// Keeping them strands nothing either way: a reset timeline holds no
			// source ids at all.
			if (ids) await sourceRegistry.setPool(ids);
			if (poolKey === key) poolReady = true;
		})();
	});

	// Persist the pool for the current song. Debounced because a multi-file add
	// appends in batches and would otherwise write once per batch.
	let poolSaveTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		if (!isSequenceMode || !poolReady) return;
		const key = poolKey;
		const ids = sourceRegistry.sources.map((s) => s.id);
		if (!key) return;
		clearTimeout(poolSaveTimer);
		poolSaveTimer = setTimeout(() => {
			void saveMediaPool(key, ids)
				.then(() => pruneSequenceMedia())
				.catch(() => {});
		}, 400);
	});

	/** Pool counterpart to flushSequenceSave — same track-switch race. */
	function flushMediaPoolSave() {
		clearTimeout(poolSaveTimer);
		if (!isSequenceMode || !poolReady || !poolKey) return;
		const key = poolKey;
		const ids = sourceRegistry.sources.map((s) => s.id);
		void saveMediaPool(key, ids)
			.then(() => pruneSequenceMedia())
			.catch(() => {});
	}

	// A restored timeline references sources by id. Pull any the pool is missing
	// back out of IndexedDB, so a reload shows each clip's own media instead of
	// nothing. Ids that aren't in the store are remembered as attempted,
	// otherwise this would retry them forever.
	$effect(() => {
		if (!isSequenceMode) return;
		const missing = mediaTimelineSourceIds(mediaTimeline).filter(
			(id) => !sourceRegistry.get(id) && !restoreAttempted.has(id),
		);
		if (missing.length === 0) return;
		for (const id of missing) restoreAttempted.add(id);
		void sourceRegistry.restore(missing);
	});

	/**
	 * Add to the pool, then seat anything the user is obviously waiting for: a
	 * layer lane with no source adopts the first file added, so picking media
	 * from an empty lane is one step rather than two.
	 */
	async function addLayerSources(files: File[]) {
		const added = await addSequenceSources(files);
		const first = added[0];
		if (!first) return;
		// Nothing anywhere on the lane to draw — a lane whose clips were each
		// pointed somewhere is already carrying media, however empty its own
		// picker reads.
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
		// Single mode's pool is session-scoped: it has no song to persist under,
		// and the session save writes the files it actually uses.
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

	/**
	 * Empty the pool: the preview sits on its no-media placeholder until
	 * something is added back. The clips that drew from it lose their media;
	 * the media itself is deleted from storage, so re-adding the files is on
	 * the user.
	 */
	function clearSequenceSources() {
		showClearSourcesConfirm = false;
		for (const src of sequenceSources) {
			setMediaTimeline(detachMediaSource(mediaTimeline, src.id));
		}
		sourceRegistry.clear();
		restoreAttempted.clear();
	}

	/** Clips pointing at a removed source draw nothing from then on, and
	 * emptying the pool entirely leaves the preview on its no-media placeholder
	 * until something is added back. */
	function removeSequenceSource(id: string) {
		sourceRegistry.remove(id);
		setMediaTimeline(detachMediaSource(mediaTimeline, id));
	}

	/** Grid replaces the preview while the pool is being arranged; the timeline
	 * stays put under it, so a card can still be dragged onto a lane. */
	let sequenceView = $state<"preview" | "grid">("preview");
	let sequenceGridOpen = $derived(isSequenceMode && sequenceView === "grid");

	// Starting playback from the grid means the user wants to watch it, so the
	// preview comes back up. Only on the transition into playing — switching to
	// the grid mid-play is a deliberate move and stays put.
	$effect(() => {
		if (isSequenceMode && seqPlaying()) sequenceView = "preview";
	});

	function seqPlaying(): boolean {
		return seqMasterIsAudio ? audio.audioPlaying : videoIsPlaying;
	}

	const mediaLayers = new MediaLayerDriver({
		registry: sourceRegistry,
		getRenderer: () => glRenderer,
		onUpload: bumpSourceTick,
	});

	/** Media length per pool source, for sampling keyed edits where the frame
	 * sampler actually is once a clip has looped. */
	let sourceDurations = $derived(
		Object.fromEntries(sequenceSources.map((s) => [s.id, s.duration])),
	);

	// A rebuilt renderer (context loss) has blank layer textures; make the
	// driver re-upload instead of holding textures that no longer exist.
	$effect(() => {
		glRenderer;
		mediaLayers.invalidate();
	});

	/**
	 * The frame's size. With no media of its own, the base takes the size of
	 * the first source that lands — the file the editor opened with, or what
	 * came first out of a saved pool — and keeps it: the frame resizing under a
	 * project because a pool entry was removed would move every layer. Only an
	 * emptied pool lets go of it, so the next media in can size a fresh frame.
	 */
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
	/**
	 * A song with nothing saved yet: the file the editor opened with goes on a
	 * first layer, running the whole song, under the effects. Set by the load
	 * that found nothing and consumed here once the pool holds the file and the
	 * song has a length — the two land in either order.
	 */
	let seedLayerKey = $state<string | null>(null);
	$effect(() => {
		if (!isSequenceMode || !seedLayerKey || seedLayerKey !== seqStoreKey) {
			return;
		}
		const duration = seqMasterDuration;
		if (duration <= 0) return;
		const source = sourceRegistry.get(stableSourceId(file));
		if (!source) return;
		seedLayerKey = null;
		if (untrack(() => mediaTimeline).lanes.length > 0) return;
		const lane = createMediaLane("Layer 1", source.id, 0);
		lane.underEffects = true;
		lane.clips = [createMediaClip(0, duration)];
		mediaTimeline = { enabled: true, lanes: [lane] };
		mediaHistory.reset();
	});

	/**
	 * What is actually on screen right now: the main chain (single mode's; in
	 * sequence mode it stays clean), then each fx lane's, in lane order.
	 * GlRenderer runs a chain sequentially and keys per-effect state by
	 * instanceId, so appending is exactly "and then run these too".
	 */
	let renderedEffects = $derived.by(() =>
		fxChain.length === 0 ? effects : [...effects, ...fxChain],
	);
	// A preset was explicitly overwritten in the panel — overwriting never
	// re-assigns the preset to the selected clip, so this isn't an edit.
	function seqSyncPreset(preset: Preset) {
		mediaTimeline = syncMediaClipsToPreset(mediaTimeline, preset);
		textTimeline = syncTextClipsToPreset(textTimeline, preset);
		fxLanes = syncFxClipsToPreset(fxLanes, preset);
	}

	// A hand-edit to a preset-filled fx clip: the label gains a "*" and explicit
	// preset overwrites stop clobbering it. Driven by explicit edit callbacks
	// (not data watching) — the audio volume-link tick also mutates values.
	function markPanelClipEdited() {
		const target = selectedFxClip;
		if (!target) return;
		// A hand-built chain has no name of its own, so it takes one from what it
		// switches on rather than sitting at "clean" forever. Preset- and
		// mosh-filled chains keep their name and pick up the "*" instead.
		if (isHandBuiltLabel(target)) target.label = handBuiltLabel(target.effects);
		else if (!target.modified) target.modified = true;
	}

	/** The selected fx clip's chain, or single mode's main chain. */
	function getPanelEffects(): EffectInstance[] {
		return selectedFxClip?.effects ?? effects;
	}

	/**
	 * Sequence mode only: with nothing selected the rack has no chain to edit —
	 * the main chain belongs to single mode, and every chain here lives on a
	 * clip. The rack shows a standing-down note rather than an inert chain.
	 */
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

	/**
	 * An interval clip rolls its own chain, so the switches would be setting
	 * something the next tick overwrites. The rack stays: the roll draws from
	 * the un-hidden effects, so hiding is how an effect is kept out of it.
	 */
	let panelRolledNote = $derived(
		panelIntervalClip
			? "Auto clip re-rolls its own mosh on an interval, so the switches follow it. Hide an effect to keep it out of the roll, or switch the clip to Static in the clip bar to build a chain by hand."
			: null,
	);

	function setPanelEffects(v: EffectInstance[]) {
		const clip = selectedFxClip;
		if (clip) clip.effects = v;
		else effects = v;
	}

	const moshSession = createMoshSession({
		getEffects: () => effects,
		setEffects: (v) => (effects = v),
		getMoshOptions,
		cancelBurst: () => panelBurst.cancel(),
		endBurst: () => panelBurst.end(),
	});

	// An fx clip edit records into the fx stack (pre-edit snapshot), any other
	// edit into the single-mode history (pushed once the burst settles).
	/** Which stack the open burst will land on. The fx stack is written at the
	 * start of the burst, so it carries a stamp already; the chain's entry is
	 * only pushed when the burst closes, and until then the router has to be
	 * told it is there. */
	let burstOwner: "fx" | "chain" | null = null;
	const panelBurst = new PanelBurstController({
		onEditStart: () => {
			// An fx clip edit belongs to the fx stack, so Ctrl+Z steps back the
			// tweak rather than the lane's last structural change.
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
	const cancelPanelBurst = () => panelBurst.cancel();
	const panelBeforeEdit = (coalesceKey?: string) =>
		panelBurst.beforeEdit(coalesceKey);

	// ── BPM ──────────────────────────────────────────────────────────────────
	// Same detector the slideshow uses: decode to mono 44.1 kHz, then
	// essentia's RhythmExtractor2013 in a shared worker. Here it feeds the
	// auto clips' re-roll spacing rather than a slide clock.
	let bpmDetecting = $state(false);
	let bpmDetectAbort: AbortController | null = null;
	/** Bumped whenever the BPM is settled from elsewhere — a restored song, a
	 * typed correction. A detection that started before that yields to it. */
	let bpmEpoch = 0;
	/** The track the automatic pass has already been spent on. */
	let autoBpmFor: File | null = null;

	// A new track detects its own tempo: the clip timing (and any beat-synced
	// effect) this feeds is unusable until the BPM is right, so it shouldn't
	// wait to be asked. Both modes — single has beat sync too.
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
		if (!audio.trackFile || bpmDetecting) return;
		const file = audio.trackFile;
		const epoch = bpmEpoch;
		bpmDetecting = true;
		bpmDetectAbort = new AbortController();
		try {
			const result = await detectBpm(file, bpmDetectAbort.signal);
			// The automatic pass never overrules what landed while it ran: a
			// restore, or a number the user typed themselves.
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
			bpmDetecting = false;
			bpmDetectAbort = null;
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

	// Loop playback inside the selected clip (edit-while-playing aid).
	let clipLoop = $state(false);

	/** The span the loop holds inside: whichever clip is selected. */
	let loopSpan = $derived.by(() => {
		const clip = selectedMediaClip ?? selectedFxClip ?? selectedTextClip;
		return clip ? { start: clip.start, end: clip.end } : null;
	});

	/** R. Needs one clip picked: the loop has no other way to know which span
	 * to hold inside, so a flag set without one would lie in wait. */
	function toggleClipLoop() {
		if (!loopSpan) return;
		clipLoop = !clipLoop;
	}
	$effect(() => {
		const span = loopSpan;
		if (!clipLoop || !span) return;
		const t = seqMasterTime();
		if (t < span.start - 0.05 || t >= span.end) {
			if (seqMasterIsAudio) seekTo(span.start);
			else seekVideoTo(span.start);
		}
	});

	function playSpan() {
		// Playback starts at the static marker — the resume point — rather than
		// wherever the clock last stopped.
		if (timelineAxis && !audio.audioPlaying)
			audio.seekTo(timelineAxis.staticTime);
		audio.playAudio();
		if (isVideo) playVideo();
	}

	function pauseTrack() {
		audio.pauseAudio();
		if (isVideo) pauseVideo();
	}

	/** True while the media edit modal is up. */
	let sourceEditOpen = $state(false);

	/**
	 * The modal carries its own transport and scrubs the media frame by frame.
	 * Leaving the preview running behind it means two players fighting over the
	 * same clip, and the canvas is covered anyway — so playback stops and the
	 * render loop idles until the modal closes.
	 */
	function onSourceEditingChange(open: boolean) {
		sourceEditOpen = open;
		if (open) pauseTrack();
	}

	function seekTo(t: number) {
		audio.seekTo(t);
	}

	let moshGroupRef: MoshGroup | undefined = $state(undefined);
	// svelte-ignore non_reactive_update
	let recordGroupRef: RecordGroup | undefined = undefined;
	let trackLibraryRef: TrackLibrary | undefined = undefined;

	/** → : forward through the mosh history, rolling a new mosh at its top. */
	function mosh() {
		// A layer's panel has taken the sidebar over, so the arrows belong to
		// its chain.
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
		// A selected fx clip is what every other panel action is aimed at, so a
		// mosh means that clip.
		const clip = activeFxClip();
		if (clip) {
			const snap = fxMoshHistory.redo(clip.id);
			if (snap) applyFxClipMosh(clip.id, snap);
			else fxRoll([clip.id]);
			return;
		}
		// Sequence mode: the mosh group is hidden and every chain lives on a
		// clip, so with nothing selected the arrows have nothing to roll.
		if (isSequenceMode) return;
		moshSession.forward();
	}

	/** ← : back through the mosh history. Never touches the edit history. */
	function undoMosh() {
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

	// Ctrl+Z/Y: hand-edits only, across every stack the editor owns. Which one
	// a press lands on is decided by when each was last edited, not by what is
	// selected — the order the user worked in is the only order that reads as
	// undo. Moshes keep their own keys (←/→) and stay out of it.
	const fxUndo = snapshotUndoSource(
		fxHistory,
		() => $state.snapshot(fxLanes) as FxLane[],
		setFxLanes,
		() => burstOwner === "fx" && panelBurst.open,
	);
	// Built per press: the text and media stacks are declared further down.
	const undoSources = (): UndoSource[] => [
		spanHistory.undoSource,
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
				// A burst still inside its coalescing window is an edit that has
				// not reached its stack yet, and it is the newest one there is.
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
		// A selected fx clip is what the panel is showing, so it's what a clear
		// means; its chain is never `effects`.
		const clip = selectedFxClip;
		if (clip) {
			panelBeforeEdit();
			clearEffectsFn(clip.effects);
			if (isHandBuiltLabel(clip)) clip.label = "clean";
			else clip.modified = true;
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
		// No confirm: the work survives the exit either way — sequence mode as
		// its song's pool and timeline, single mode as a session the upload
		// screen offers straight back.
		flushSingleSessionSave();
		onExit();
	}

	/**
	 * The preview renders at display resolution — re-render at the real output
	 * size, hand the canvas to `capture`, then restore the preview size via the
	 * passed `done`. Feedback-effect history resets across the resize (buffers
	 * are reallocated), same as any manual resize.
	 */
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

	/**
	 * Bake the current frame into a new source file. Destructive — it replaces
	 * the file being edited and clears the chain — and it's bound to a bare `V`,
	 * so it hands back an Undo that restores both the previous file and the
	 * effect chain as it stood before the bake.
	 */
	function reInput() {
		if (!canvasEl) return;
		// Single mode only: sequence draws from a pool of sources through its
		// layers, so there is no one source for a baked frame to replace.
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

	/** The timeline's shared axis, once a stack is mounted — the C shortcut
	 * fires from the window, outside the context the stack puts it in. */
	let timelineAxis = $state<TimelineStackState | undefined>(undefined);

	/** The lane list, so the width its own scrollbar takes can be measured. */
	let laneListEl = $state<HTMLElement | null>(null);
	/** What the lane list's vertical scrollbar costs it — zero wherever
	 * scrollbars overlay their content instead of displacing it. The timeline's
	 * grid and playhead are drawn over the lanes from outside that scroller, so
	 * they have to give up the same width or the playhead lands a scrollbar's
	 * width past the lane it is marking. Measured rather than assumed, because
	 * the answer is a platform's, not ours. */
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

	// ── The timeline split ───────────────────────────────────────────────────
	/** Which side of the column deserves the room is the user's call, not a
	 * rule's: building a look wants the preview, arranging a stack wants the
	 * lanes. Their answer is remembered. */
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

	/** The tallest the timeline may go right now: its own share of the column,
	 * and never so far that the preview is left with nothing. */
	function splitCeiling(startSplit: number): number {
		const area = mainAreaEl;
		if (!area) return startSplit;
		const cap = area.clientHeight * 0.45;
		const preview = previewSlotEl;
		const previewH =
			preview && !preview.classList.contains("hidden")
				? preview.getBoundingClientRect().height
				: 0;
		// With the preview away in grid mode there is no floor to keep, so the
		// cap is the whole answer.
		const byPreview =
			previewH > 0 ? startSplit + Math.max(0, previewH - PREVIEW_MIN) : cap;
		return Math.max(SPLIT_MIN, Math.min(cap, byPreview));
	}

	/** The shortest the timeline may go: its fixed chrome — toolbar, ruler band,
	 * scrollbar row, selection bar — plus one lane left showing. Taken from the
	 * live split rather than a constant, since the chrome is what it is. */
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

	// ── Folded lanes ─────────────────────────────────────────────────────────
	/** Lanes folded to a strip. A view choice like solo, so it stays out of the
	 * saved timeline — but it outlives the session, because a stack worth folding
	 * is one worth coming back to folded. */
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
		toggleClipLoop,
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
	/** Seconds. A ceiling on typos, not a format limit — the encoder has no cap. */
	const MAX_RECORD_DURATION = 600;
	/** One click for the lengths people actually reach for. */
	const RECORD_DURATION_PRESETS = [5, 10, 30, 60, 120];

	/**
	 * Which project the export settings belong to. `seqStoreKey` already carries
	 * the mode prefix, so single mode and the lane editor keep separate
	 * settings for the same song. Media with no song of its own still has an identity worth
	 * keying by — single mode works with no audio at all — so it falls back to
	 * the file, matching how sessions.ts keys a track-less edit.
	 */
	let renderKey = $derived(
		seqStoreKey ??
			(isSequenceMode
				? null
				: `single:file:${file.name}:${file.size}:${file.lastModified}`),
	);

	/** The project whose settings are already loaded, so the save effect can't
	 * write one project's values under the next one's key. */
	let renderKeyLoaded = $state<string | null>(null);

	$effect(() => {
		const key = renderKey;
		if (!key || untrack(() => renderKeyLoaded) === key) return;
		untrack(() => {
			renderKeyLoaded = key;
			const saved = loadRenderSettings(key);
			if (saved?.fps) recordFps = saved.fps;
			if (saved?.duration) recordDuration = saved.duration;
			// Falls back to the pre-render-settings per-track size store, whose
			// entries were written before the output size lived here.
			const size =
				saved?.width && saved?.height
					? { width: saved.width, height: saved.height }
					: currentTrackId
						? sizeStore.load(currentTrackId)
						: null;
			if (size && size.width > 0 && size.height > 0) {
				resizeWidth = size.width;
				resizeHeight = size.height;
				// Media finishing its load after this would otherwise default the
				// output back to its own size — see the latch's own comment.
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
		// Before this project's own values are in, the live ones still belong to
		// whatever was open before.
		if (!key || renderKeyLoaded !== key) return;
		saveRenderSettings(key, {
			fps,
			duration,
			...(width > 0 && height > 0 ? { width, height } : {}),
		});
	});

	// ── Text timeline ──
	// Optional lanes of text clips over the master clock. Off until the user
	// turns it on, so nothing about the existing editor changes for people who
	// don't want text.

	/**
	 * Layer lanes are desktop work — the buttons that turn them on are not
	 * offered on a phone, and neither is anything a lane draws or edits. What
	 * a desktop built still comes back through here, only switched off: the
	 * `enabled` flag is all the lanes key off. The flag as loaded is kept so
	 * a save from the phone hands the lanes back exactly as they were, rather
	 * than hidden the next time the desktop opens them.
	 */
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

	// Seed only — a later change to the prop shouldn't overwrite live edits.
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

	// ── Media layers ──
	// Lanes of media over the same master clock, each with its own placement,
	// its clips each with their own chain. Sequence mode only, and always on
	// there: the layers are where the media goes, not an extra to switch on.
	// Single mode is the one-file editor and stays out of it entirely.
	let mediaTimeline = $state<MediaTimeline>(
		untrack(() => ({ ...EMPTY_MEDIA_TIMELINE, enabled: isSequenceMode })),
	);
	let selectedMediaClipId = $state<string | null>(null);
	/** The layer-clip selection, so the media rail can assign to all of it. */
	let selectedMediaClipIds = $state<string[]>([]);

	/**
	 * Lane shown by itself on the canvas. Deliberately not part of the timeline
	 * data: soloing is a way of looking at the work, not a property of it, so it
	 * neither persists nor reaches an export.
	 */
	let soloMediaLaneId = $state<string | null>(null);

	function toggleMediaSolo(laneId: string) {
		soloMediaLaneId = soloMediaLaneId === laneId ? null : laneId;
	}

	/** Every lane on the stack, whatever kind it is — the fold-all control works
	 * on the lot, so it has to see all three kinds at once. */
	let laneIds = $derived([
		...mediaTimeline.lanes.map((lane) => lane.id),
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

	// A soloed lane that was deleted would leave the canvas black with nothing
	// on screen to say why, so solo only counts while its lane is on the stack.
	// The id itself is kept: undoing the delete brings the solo back with it.
	let soloLaneId = $derived(
		mediaTimeline.lanes.some((l) => l.id === soloMediaLaneId)
			? soloMediaLaneId
			: null,
	);

	// ── Single-mode session ──
	// Sequence mode resumes from its song's media pool; single mode has only the
	// one file, so the file and the work done to it are saved together and the
	// upload screen offers it back. Untouched opens aren't saved — every file
	// ever previewed would otherwise pile up in the list.
	let sessionSaveTimer: ReturnType<typeof setTimeout> | undefined;

	function saveSingleSession() {
		// A camera can't be reopened from a saved session.
		if (isSequenceMode || isLive) return;
		// Lane presence, not `enabled`: that flag is the layer's visibility
		// toggle and survives being switched off with the lanes still there.
		// Keying either the guard or the payload off it discards the whole
		// timeline the moment the user hides it.
		const hasText = textTimeline.lanes.length > 0;
		if (!moshSession.touched && !hasText) return;
		const source = file;
		const state: SingleSessionState = {
			effects: $state.snapshot(effects) as EffectInstance[],
			text: hasText
				? layersAsLoaded($state.snapshot(textTimeline) as TextTimeline, "text")
				: null,
		};
		// Keyed by the song when there is one, so the session sits alongside the
		// text timeline and span already saved under that track id.
		void saveSession("single", [source], state, currentTrackId)
			.then(() => pruneSequenceMedia())
			.catch((e) => {
				// Swallowing this outright is what made the last failure invisible.
				if (import.meta.env.DEV) console.error("Session save failed:", e);
			});
	}

	$effect(() => {
		if (isSequenceMode) return;
		// Skipped while playing, for the same reason the sequence save above is:
		// the per-frame volume-link tick mutates values inside `effects`, so the
		// deep read below re-runs this effect — and its two deep snapshots —
		// once per rendered frame. The clones are discarded immediately, which
		// makes it pure garbage for the collector to come back for every couple
		// of seconds. Saving settles on pause, and the pagehide flush covers a
		// tab closed mid-playback.
		if (audio.audioPlaying || videoIsPlaying) return;
		// Deep-read, discarded: naming `effects` alone subscribes to the array
		// reference only, so dragging a parameter — which mutates in place —
		// would never re-arm the debounce.
		$state.snapshot(effects);
		$state.snapshot(textTimeline);
		file;
		// Loading a different song re-keys the session, so it has to re-save.
		currentTrackId;
		clearTimeout(sessionSaveTimer);
		sessionSaveTimer = setTimeout(saveSingleSession, 600);
		return () => clearTimeout(sessionSaveTimer);
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

	// A still image with no track has no clock at all, so the text timeline
	// supplies one: it loops the record window, which is what an export writes.
	let stillClock = $state(0);
	let stillPlaying = $state(false);
	/** Bumped on every seek, so the running loop re-anchors on the new time. */
	let stillSeekTick = $state(0);

	let textDuration = $derived(
		seqMasterDuration > 0 ? seqMasterDuration : recordDuration,
	);
	/** True when nothing else owns a playhead, so the text ruler grows one. */
	let textNeedsTransport = $derived(seqMasterDuration <= 0);
	let textTime = $derived(textNeedsTransport ? stillClock : seqMasterTime());
	// An export's frame 0 is not the master clock's zero: it starts at the audio
	// span (or the video's in-point), and a sped-up video covers master time
	// faster than frame time. Both preview and export read the same clips.
	let textTimeOffset = $derived(
		audio.trackFile && audio.trackDuration > 0
			? audio.spanStart
			: isVideo && videoDuration > 0
				? videoSpanStart
				: 0,
	);
	let textTimeScale = $derived(
		!audio.trackFile && isVideo && videoDuration > 0 ? videoSpeed : 1,
	);
	let textClockRunning = $derived(
		textNeedsTransport ? stillPlaying : audio.audioPlaying || videoIsPlaying,
	);

	// ── Timeline stack ───────────────────────────────────────────────────────
	// Every lane shares the master clock's axis: the media, text and fx lanes
	// and whichever transport is the master. A video playing under its own
	// span while a track drives the timeline is a second clock, so it stays a
	// standalone bar above the stack rather than joining the axis.
	let showVideoBar = $derived(
		isVideo && videoDuration > 0 && !(isSequenceMode && seqMasterIsAudio),
	);
	let videoIsMaster = $derived(showVideoBar && !seqMasterIsAudio);
	let audioIsMaster = $derived(audio.trackFile && audio.trackDuration > 0);
	let showStack = $derived(
		textDuration > 0 &&
			((isSequenceMode && seqMasterDuration > 0) ||
				textTimeline.enabled ||
				mediaTimeline.enabled ||
				videoIsMaster ||
				audioIsMaster),
	);

	function toggleMasterPlay() {
		if (textNeedsTransport) {
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
		if (textNeedsTransport) {
			stillClock = t;
			stillSeekTick++;
		} else if (seqMasterIsAudio) seekTo(t);
		else seekVideoTo(t);
	}

	function toggleMasterLoop() {
		if (seqMasterIsAudio) audio.loopAudio = !audio.loopAudio;
		else videoLoop = !videoLoop;
	}

	// ── Stack toolbar ────────────────────────────────────────────────────────
	// The lanes' own actions, gathered into the stack's one toolbar rather than a
	// header row each.
	let sourceInput = $state<HTMLInputElement | undefined>(undefined);

	function addTextLane() {
		pushTextHistory();
		setTextTimeline(appendTextLane(textTimeline, nextLayerZ(layerOrder)));
	}

	$effect(() => {
		if (!stillPlaying) return;
		// Tracked, so a seek mid-run restarts the loop on the new position — the
		// anchor below is read once and would otherwise ignore it.
		stillSeekTick;
		const span = Math.max(0.1, textDuration);
		const started = performance.now() - untrack(() => stillClock) * 1000;
		let raf = requestAnimationFrame(function loop(now) {
			stillClock = ((now - started) / 1000) % span;
			raf = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(raf);
	});

	/** Names of the enabled main effects — the lane chain-position picker. */
	/**
	 * Every layer in both timelines, front first. One order spans the two kinds,
	 * so the panels and the lane gutters agree on what sits over what.
	 */
	let layerOrder = $derived(
		combinedLayerOrder(mediaTimeline.lanes, textTimeline.lanes, fxLanes),
	);

	/**
	 * Drop a layer at `toIndex` in the shared stack, whichever timeline holds
	 * it. The stack is renumbered whole, so both sides may need writing.
	 */
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

	// ── Layer row drag ───────────────────────────────────────────────────────
	// Owned here rather than by either lane component: a drag crosses between
	// text and media rows, and neither can see the other's.
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
	/** The lane holding the selected clip — the panel edits its style. */
	let selectedTextLane = $derived(
		findTextClipLane(textTimeline, selectedTextClipId),
	);

	// Its own undo stack: the chain stacks are typed to effect arrays, and a
	// text edit shouldn't rewind a mosh. Ctrl+Z reaches it when a text edit is
	// the newest thing the user did.
	const textHistory = createTextHistory();

	// A restored timeline is the baseline, not an edit on top of an empty one:
	// the stack starts seeded with EMPTY, so without this the first undo would
	// wipe the lanes that just came back.
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

	function updateTextClip(next: TextClip) {
		textTimeline = replaceTextClip(textTimeline, next);
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

	function updateMediaClip(next: MediaClip) {
		mediaTimeline = replaceMediaClip(mediaTimeline, next);
	}

	function updateMediaLane(next: MediaLane) {
		mediaTimeline = updateMediaLaneIn(mediaTimeline, next.id, () => next);
	}

	/** Adopt a saved timeline, or clear back to empty when a song has none.
	 * Always on in sequence mode: entries saved while the layers could still be
	 * switched off come back switched on. */
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
		// Nothing in the pool to draw: asking for the file here is the step the
		// user was going to take anyway, and addLayerSources seats it in the lane
		// that just appeared.
		if (!sourceId) sourceInput?.click();
	}

	/** The rail is the media pool: sequence mode's layers draw from it. */
	let showSourceRail = $derived(
		isSequenceMode && !sequenceGridOpen && sequenceSources.length > 0,
	);

	// One selection across the whole stack: the sidebar edits one thing at a
	// time, so filling any lane's selection empties every other lane's. Without
	// this the sidebar shows whichever branch came first while the other lane
	// still draws itself as selected.
	//
	// The lanes bind their own selection state, so there is no setter they all
	// pass through. Each kind gets a one-way effect instead: whichever
	// selection the user just made survives, and the rest settle to null on the
	// next pass.
	type SelectionKind = "fx" | "media" | "text";

	function keepOnlySelection(keep: SelectionKind) {
		untrack(() => {
			if (keep !== "fx") {
				selectedFxClipId = null;
				selectedFxClipIds = [];
				// A lane picked by name aims the settings panel at it; left set,
				// the panel would go on showing the wrong owner's settings.
				selectedFxLaneId = null;
			}
			if (keep !== "media") selectedMediaClipId = null;
			if (keep !== "text") selectedTextClipId = null;
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

	/**
	 * Select what the preview was clicked on. A layer pick names a lane; which
	 * of its clips to open is whatever is on screen at the playhead, since that
	 * is the one the click was aimed at.
	 *
	 * Clicking past every layer lands on the base: in single mode the main
	 * chain, which is already what the rack shows once no layer is in the way,
	 * so dropping the layer selection is the whole gesture.
	 */
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

	// ── Text clip chains ──
	// Fill, mosh, clear and static/auto on a text clip: the same gestures a
	// media clip takes, over the same shared rules (chain-clip.ts).
	// Same resolver the export builds, so interval rolls reproduce exactly.
	const previewTextChains = createTextChainSource(getMoshOptions);

	/** ←/→ walk one text clip's moshes, keyed by clip id. */
	const textMoshHistory = new MoshHistory<MoshSnapshot>();

	/** Deleting a clip retires its id — drop the stack so a later clip can't
	 * inherit moshes that were never its own. */
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

	/** Mosh history only — never the text edit stack; see fxRoll. */
	function textRoll(clipIds: string[]) {
		const ids = new Set(clipIds);
		for (const clip of textClipsById(ids)) {
			textMoshHistory.seed(
				clip.id,
				chainClipMoshSnapshot($state.snapshot(clip) as TextClip),
			);
		}
		textTimeline = rollTextClips(textTimeline, ids, getMoshOptions());
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

	// ── Media clip chains ──
	// Fill, mosh, clear and static/auto on a media clip: the same gestures an
	// fx clip takes, over the same shared rules (chain-clip.ts).
	// Same resolver the export builds, so interval rolls reproduce exactly.
	const previewMediaChains = createMediaChainSource(getMoshOptions);

	/** ←/→ walk one media clip's moshes, keyed by clip id. */
	const mediaMoshHistory = new MoshHistory<MoshSnapshot>();

	function mediaClipsById(ids: Set<string>): MediaClip[] {
		return mediaTimeline.lanes.flatMap((l) =>
			l.clips.filter((c) => ids.has(c.id)),
		);
	}

	/** Mosh history only — never the media edit stack; see fxRoll. */
	function mediaRoll(clipIds: string[]) {
		const ids = new Set(clipIds);
		for (const clip of mediaClipsById(ids)) {
			mediaMoshHistory.seed(
				clip.id,
				chainClipMoshSnapshot($state.snapshot(clip) as MediaClip),
			);
		}
		mediaTimeline = rollMediaClips(mediaTimeline, ids, getMoshOptions());
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

	/** The source the selected layer clips draw; null when they disagree. Clips
	 * that never chose one resolve to their lane's, so a lane's worth of plain
	 * clips still agrees on a single thumb. */
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

	/** The thumb the rail lights up: what the selected layer clips draw. Falls
	 * back to the lane behind the primary clip, so a lane opened with nothing
	 * selected still says which media it is on. */
	let railSourceId = $derived(
		mediaSelectedSourceId ?? selectedMediaLane?.sourceId ?? null,
	);

	/** How many clips a rail click assigns to. */
	let railTargetCount = $derived(selectedMediaClipIds.length);

	/** Point the selected layer clips at this source, fanned out over the whole
	 * selection. */
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

	/** Transport for the lyrics-sync modal, on whichever clock owns the master
	 * timeline here: the track, the video, or the still-image loop. */
	let lyricsSync = $derived<LyricsSyncProps | null>(
		textTimeline.enabled
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
		textTimeline = applyLyricsToTimeline(textTimeline, clips);
		selectedTextClipId = clips[0].id;
	}
	let effectiveDuration = $derived(
		audio.trackFile &&
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
		// The record overlay and progress live outside the fullscreen element, so
		// staying in it during an export would hide every control the user needs.
		previewFullscreen = false;

		// Pause playback while recording
		audio.pauseAudio();
		previewPlayer?.pause();
		if (isVideo && videoEl) videoEl.pause();
		if (isLive && !liveVideoEl?.srcObject) {
			showToast("The camera isn't open", "error");
			return;
		}

		// Generated sources may still be catching up with a size change.
		await primarySync.settle();
		await sourceRegistry.settleGenerated();

		// Preview runs at display resolution — export at the real output size.
		// GlCanvas restores the preview size when `suspended` clears.
		if (resizeWidth > 0 && resizeHeight > 0) {
			glRenderer.resize(resizeWidth, resizeHeight);
		}

		await recordingState.run(
			(signal) =>
				executeRecording({
					fps: recordFps,
					recordDuration,
					canvas: canvasEl!,
					renderer: glRenderer!,
					effects,
					trackFile: audio.trackFile,
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
					// A live export is a performance: the song has to be heard from
					// the span it is exporting, so the take can follow it.
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
								masterIsAudio: seqMasterIsAudio,
								fxLanes: $state.snapshot(fxLanes) as FxLane[],
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

		// Left paused: an export ends with the file saved and the user reading a
		// toast, not wanting the song to start up again on its own.
		if (isLive) audio.pauseAudio();
		if (canvasEl && glRenderer) {
			glRenderer.render(renderedEffects, performance.now() / 1000);
		}
	}

	function cancelRecording() {
		recordingState.cancel();
	}

	/** Audio sets the track. Media replaces the file in single mode; in sequence
	 * mode it joins the pool, since clips can each pick their own. */
	function handleDroppedFiles(files: FileList) {
		const all = Array.from(files);
		const audioFile = all.find((f) => f.type.startsWith("audio/"));
		if (audioFile) {
			clearTrack();
			audio.trackFile = audioFile;
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

{#if audio.trackObjectUrl}
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
		onPlay={() => audio.playAudio()}
		onPause={() => audio.pauseAudio()}
		mainPlaying={audio.audioPlaying}
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
				<!-- Shuffle is scoped by the selection: with layer clips picked it
					     deals across those, otherwise across every layer clip. -->
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
					<Sparkles size={14} />
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
						<Sparkles size={14} /> GENERATE
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
					// Player owns duration/span/audio when active; element is
					// just the recording fallback then
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
		<!-- Hidden, never unmounted: tearing the canvas down would take the
		     renderer (and the pre-warmed context it adopted) with it. -->
		<div
			class="preview-slot"
			class:hidden={sequenceGridOpen}
			bind:this={previewSlotEl}
		>
			{#if !isSequenceMode && isVideo && singleProxyStatus.kind !== "none"}
				<!-- Single mode has no source chip, so the one thing that would
				     otherwise happen silently to the user's video says so here. -->
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
				spectrum={audio.frequencyData}
				{sourceFit}
				sourceEdits={sourceRegistry.edits}
				{sourceDurations}
				onPickLayer={pickLayer}
				onLayerDragStart={() => pushMediaHistory()}
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
			<!-- The view switches. Layer lanes are off on a phone altogether — see
			     layersOffOnMobile — so their switches go too, and the cluster
			     with them if fullscreen can't fill it. -->
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
				<!-- The same transport as the timeline toolbar's, at the size the
				     slideshow gives it: playing back is a main action here too. -->
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
						{#if !audio.trackFile && !isVideo}
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
			<!-- The pool, on hand while the preview is up: dragging a thumb onto a
			     media layer's row is the same drop the grid's cards make. -->
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
			<!-- A second clock: the video runs its own span while the track drives
			     the timeline, so it can't share the stack's axis. -->
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
			<!-- The split between the output and the lanes. Its hit area is taller
			     than the grip it draws, so the target is not a hairline. -->
			<!-- A separator is a window splitter when it is focusable, which is
			     exactly the case here — so both of these are the rule misfiring. -->
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
				loopEnabled={seqMasterIsAudio ? audio.loopAudio : videoLoop}
				onToggleLoop={audioIsMaster || videoIsMaster ? toggleMasterLoop : null}
			>
				{#snippet toolbar()}
					<!-- Each button names the lane it adds in full: with three kinds of
					     lane side by side, "+ Lane" under a group label read as the
					     same button three times. -->
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
					<!-- Read bottom to top, the way the frame is built: the layers
				     composite onto the base, and the fx lanes run over the result. -->
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
					{#if videoIsMaster}
						<div class="tl-tool-sep"></div>
						<SpeedControl
							speed={videoSpeed}
							onSpeedChange={(s) => (videoSpeed = s)}
						/>
					{/if}
				{/snippet}
				<!-- Read bottom to top, the way a frame is built: the transports at
				     the foot are the inputs, and everything stacks over them. -->
				<!-- One column for every row of the stack: media, text and fx lanes
				     alike. Each carries its place in the shared
				     stack as a CSS order, so the three interleave without any of
				     the components knowing about the others. -->
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
							soloLaneId={soloLaneId}
							onToggleSolo={toggleMediaSolo}
							onChange={setMediaTimeline}
							onBeforeEdit={pushMediaHistory}
							bpm={sequenceBpm}
							onApplyPreset={mediaApplyPreset}
							onRoll={mediaRoll}
							onClear={mediaClear}
							onModeChange={mediaModeChange}
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
				{#if audioIsMaster}
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
		{#if !audio.trackFile}
			<TrackAddBar
				onOpenPicker={openTrackPicker}
				hintText="Add music to make effects react to the beat"
			/>
		{/if}
		<input
			bind:this={trackInput}
			type="file"
			accept="audio/*"
			onchange={onTrackInputChange}
			hidden
		/>
		<!-- Outside the timeline stack: the stack is hidden while there's no
		     clock, and both the empty-pool placeholder and the layer panel still
		     need this picker. Mounted in single mode too, where the pool holds
		     the media the layers draw from. -->
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

	<!-- Passed only while a clip is selected. The sheet takes any top panel
	     as "show this instead of the chain", so an always-present snippet that
	     merely rendered nothing left the mobile Effects tab empty. -->
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
				hasTrack={!!audio.trackFile || (isVideo && !!audio.analyserNode)}
				spectrumData={audio.spectrumData}
				response={selectedMediaLane
					? laneAudioResponse(selectedMediaLane, audioResponse)
					: audioResponse}
				edits={sourceRegistry.edits}
				onEditChange={(id, edit) => sourceRegistry.setEdit(id, edit)}
				onEditingChange={onSourceEditingChange}
				{section}
			/>
		{:else if selectedTextClip}
			<TextClipPanel
				lane={selectedTextLane}
				clip={selectedTextClip}
				onLaneChange={updateTextLane}
				onClipChange={updateTextClip}
				onBeforeEdit={pushTextHistory}
				onClose={() => (selectedTextClipId = null)}
				hasTrack={!!audio.trackFile || (isVideo && !!audio.analyserNode)}
				spectrumData={audio.spectrumData}
				response={audioResponse}
				{section}
			/>
		{/if}
	{/snippet}

	<MobileSheet
		bind:this={_mobileSheetRef}
		topPanel={selectedMediaClip || selectedTextClip ? layerPanel : undefined}
		settingsLabel="Mosh"
		topPanelLabel={selectedMediaClip ? "Media clip" : "Text clip"}
	>
		{#snippet settings()}
			{@render moshSettings()}
		{/snippet}
		{#snippet effectsPanel()}
			<!-- A selected layer is edited by the top panel instead; the main
			     chain would be a second, unrelated effect list under it. -->
			{#if !selectedMediaClip && !selectedTextClip}
				<EffectsPanel
					headless
					bind:effects={getPanelEffects, setPanelEffects}
					noTarget={panelNoTarget}
					rolledNote={panelRolledNote}
					rolledChain={!!panelIntervalClip}
					hasTrack={!!audio.trackFile || (isVideo && !!audio.analyserNode)}
					spectrumData={audio.spectrumData}
					response={audioResponse}
					onVolumeLinkChange={(index, paramKey, link) => {
						panelBeforeEdit(`link:${index}:${paramKey}`);
						setPanelEffects(
							setVolumeLink(getPanelEffects(), index, paramKey, link),
						);
						markPanelClipEdited();
					}}
					onEffectsReplaced={endPanelBurst}
					onPresetUpdated={seqSyncPreset}
					onPresetApplied={(preset) => {
						const target = selectedFxClip;
						if (target) {
							target.label = preset.name;
							target.presetName = preset.name;
							target.modified = false;
						}
					}}
					onUserEdit={markPanelClipEdited}
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
			<span>Drop image/video to replace · Drop audio to set track</span>
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

	/* The extra pixel up top pays for the bottom border: it sits below the
	   padding, so equal padding centres the row in the box but not between the
	   two edges you can see. Whole pixels, so nothing rounds either. */
	/* The lane components render straight into this (they are display:contents),
	   so the gap and the ordering live here. */
	.tl-layers {
		display: flex;
		flex-direction: column;
		gap: 2px;
		/* The stack caps its own height, so the lanes are the part that gives:
		   past a screenful they scroll under the axis instead of pushing the
		   preview out of the column. It does not grow — folding every lane should
		   hand the room straight back, not leave a gap under the strips. */
		flex: 0 1 auto;
		min-height: 0;
		overflow-y: auto;
		/* Reserved whether or not it is scrolling, so the axis does not jump
		   sideways the moment a lane is added. */
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

	/* Holds the canvas's place in the column so the grid can take the box
	   without the preview being torn down. */
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

	/* Below this the strip's controls, at their phone size, still overrun a
	   narrow viewport: every gap comes in, and wrapping is the last resort for
	   anything narrower still, so no control is ever clipped off the edge. */
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

	/* The strip under the preview. A hairline off the canvas, then the switch
	   clusters and keys centred on one line; the air is padding, and the
	   preview pays for every pixel of it. */
	.action-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 0.45rem 0.75rem;
		border-top: 1px solid var(--line);
		flex-shrink: 0;
	}

	/* The timeline's top edge, grabbed to rebalance the column. The band pulls the
	   stack back up over itself, so it costs no height at all: the rail above it
	   keeps the size it had. */
	.tl-split {
		position: relative;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		height: 9px;
		margin-bottom: -9px;
		/* Only the grip takes the pointer, so the band cannot shadow the toolbar
		   it lies over. */
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
