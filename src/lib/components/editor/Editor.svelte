<script lang="ts">
	import LoadFailed from "../ui/LoadFailed.svelte";
	import { onMount, tick, untrack } from "svelte";
	import { hasKeyboard, modKey } from "../../input-device";
	import {
		Download,
		FolderDown,
		Camera,
		HelpCircle,
		Library,
		Stamp,
		Maximize,
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
	import { pastedFiles } from "../../media/paste";
	import { AudioManager } from "../../audio/audio-manager.svelte";
	import type { AudioLinkGroup } from "../../audio/audio-utils";
	import { downloadBlob } from "../../recorder";
	import { getExportFormat } from "../../export-format.svelte";
	import {
		downloadProjectFile,
		type ProjectContent,
	} from "../../project-file/export";
	import type { AudioResponse } from "../../audio/auto-range";
	import { createTrackStore } from "../../audio/track-persistence";
	import {
		loadRenderSettings,
		saveRenderSettings,
	} from "../../editor/render-settings";
	import { addTrack, getTrack, trackToFile } from "../../audio/track-library";
	import { SequenceMixer } from "../../mix/mixer.svelte";
	import { MicRecorder } from "../../mix/mic-recorder.svelte";
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
	import { getDecodedAudioBuffer } from "../../audio/audio-buffer-cache";
	import { songProfileOf } from "../../audio/build-song-profile";
	import { publishSongProfile } from "../../audio/song-profile";
	import { trackIdOf, trackSourceId, type AudioClip } from "../../mix/types";
	import { draggedTrackId } from "../../editor/source-drag.svelte";
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
		type ProjectSongChoice,
	} from "../../editor/settings";
	import { linkBand } from "../../editor/link-band.svelte";
	import { layerHighlight } from "../../editor/layer-highlight.svelte";
	import {
		cloneEffectInstance,
		lanesWithoutHiddenEffects,
		loadInitialEffects,
		withoutHiddenEffects,
		restoreEffects,
		setVolumeLink,
		type EffectInstance,
		type FreqBand,
		type Preset,
	} from "../../effects";
	import {
		appendTextLane,
		createTextChainSource,
		EMPTY_TEXT_TIMELINE,
		findTextClip,
		fitTextTimeline,
		findTextClipLane,
		normalizeTextTimeline,
		applyLyricsToTimeline,
		replaceTextClip,
		resolveTextLayersAt,
		syncTextClipsToPreset,
		toggledTextTimeline,
		type TextClip,
		type TextLane,
		type TextTimeline,
	} from "../../text";
	import { handBuiltLabel, isHandBuiltLabel } from "../../editor/sequence";
	import {
		fitFxLanes,
		flattenFxLayers,
		laneAudioResponse,
		syncFxClipsToPreset,
		type FxClip,
		type FxLane,
		type FxLaneSettings,
	} from "../../editor/fx-lanes";
	import { fanOutEdit, withAllLinkBands } from "../../editor/chain-fanout";
	import {
		createSnapshotHistory,
		snapshotUndoSource,
	} from "../../timeline/snapshot-history.svelte";
	import { createSpanHistory } from "../../audio/span-history.svelte";
	import { asOneEdit, PENDING_EDIT } from "../../editor/edit-clock";
	import {
		redoLatest,
		undoLatest,
		type UndoSource,
	} from "../../editor/undo-router";
	import { startLayerRowDrag } from "../../timeline/layer-order";
	import { clipAt, type TimelineClip } from "../../timeline/clips";
	import type { LayerPick } from "../../editor/layer-pick";
	import {
		SequenceSourceRegistry,
		type SequenceSource,
	} from "../../editor/sequence-sources.svelte";
	import { MediaLayerDriver } from "../../editor/media-layer-driver";
	import { isMeshFile, MESH_ACCEPT } from "../../mesh";
	import { isOtherModelFile, type ModelProblem } from "../../mesh/support";
	import { SingleProxy } from "../../editor/single-proxy.svelte";
	import { droppedClipLength } from "../../editor/sequence-source-ui";
	import type { ProxyAction } from "../../video/proxy-status";
	import {
		addClip,
		appendMediaLane,
		autoOnSlideshow,
		autoOnSlideshows,
		dealMediaClipSources,
		createMediaChainSource,
		createMediaClip,
		detachMediaSource,
		EMPTY_MEDIA_TIMELINE,
		fitMediaTimeline,
		MAX_MEDIA_LANES,
		MIN_CLIP_LENGTH,
		clipSourceId,
		newClipSpan,
		resolveMediaLayersAt,
		setMediaClipSources,
		syncMediaClipsToPreset,
		updateMediaLane as updateMediaLaneIn,
		type MediaClip,
		type MediaLane,
		type MediaTimeline,
		type SourceEdit,
	} from "../../media";
	import { hiddenSlides } from "../../editor/slideshow-source";
	import {
		isOwnSessionKey,
		stableSourceId,
	} from "../../editor/sequence-media-store";
	import {
		newSessionKey,
		type SingleSessionState,
	} from "../../editor/sessions";
	import { rememberLastOpened } from "../../editor/last-opened";
	import {
		migrateLegacySegments,
		prependMediaLane,
	} from "../../editor/legacy-segments";
	import { FxLaneState } from "../../editor/fx-lane-state.svelte";
	import { createProjectImports } from "../../editor/project-imports";
	import { SingleVideo } from "../../editor/single-video.svelte";
	import { ProjectTempo } from "../../editor/project-tempo.svelte";
	import { TimelinePersistence } from "../../editor/timeline-persistence.svelte";
	import { PoolPersistence } from "../../editor/pool-persistence.svelte";
	import { ProjectOpener } from "../../editor/project-opener.svelte";
	import { SingleSong } from "../../editor/single-song.svelte";
	import { ProjectSongs } from "../../editor/project-songs";
	import {
		ProjectKeys,
		SessionKeys,
		type EditorKeys,
	} from "../../editor/editor-keys";
	import type { SongHandler } from "../../editor/song-handler";
	import { contentEnd, contentStart } from "../../editor/project-seed";
	import {
		SequenceClock,
		SingleClock,
		type EditorClock,
	} from "../../editor/editor-clock.svelte";
	import { SingleSessionSave } from "../../editor/single-session-save.svelte";
	import { createAudioLaneEdits } from "../../editor/audio-lane-edits";
	import { createProjectLength } from "../../editor/project-length";
	import { createPoolEdits, type PoolEntry } from "../../editor/pool-edits";
	import { LaneSettingsPanel } from "../../editor/lane-settings-panel.svelte";
	import { LayerStack } from "../../editor/layer-stack.svelte";
	import { createPoolAdds } from "../../editor/pool-adds";
	import { ChainTimelineState } from "../../editor/chain-timeline-state.svelte";
	import { mediaTimelineOps, textTimelineOps } from "../../editor/timeline-ops";
	import {
		SEQ_ENTRY_VERSION,
		type LegacySegmentEntry,
		type SeqEntry,
	} from "../../editor/seq-entry";
	import type { GlRenderer, SourceFit } from "../../gl/renderer";
	import AudioTimeline from "../ui/AudioTimeline.svelte";
	import TimelineStack from "../ui/TimelineStack.svelte";
	import type { TimelineStackState } from "../../editor/timeline-stack.svelte";
	import {
		LaneFolds,
		TimelineSplit,
	} from "../../editor/timeline-layout.svelte";
	import EffectsPanel from "../ui/EffectsPanel.svelte";
	import { setFeedbackChain } from "../ui/feedback.svelte";
	import ButtonGroup from "../ui/ButtonGroup.svelte";
	import MobileSheet from "../ui/MobileSheet.svelte";
	import OutputSettings from "./OutputSettings.svelte";
	import RecordSettings from "./RecordSettings.svelte";
	import LaneToolbar from "./LaneToolbar.svelte";
	import { uiPrefs } from "../../ui-prefs.svelte";
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
	import {
		GeneratedSizeSync,
		readGenerated,
		specRender,
	} from "../../generators";
	import { isSvgFile, rasterizeSvg } from "../../media/svg";
	import { withMediaType } from "../../media/file-type";
	import { SourceEditSession } from "../../editor/source-edit-session";

	const loadShortcutsModal = lazy(() => import("../ui/ShortcutsModal.svelte"));
	const loadGeneratePanel = lazy(
		() => import("../generators/GeneratePanel.svelte"),
	);

	interface Props {
		/** Null only in the Editor, for a project whose pool is empty. */
		file: File | null;
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
		/** Single mode: what this edit saves under. */
		sessionKey?: string | null;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: import("../../gl/renderer").GlRenderer | null;
		onExit?: () => void;
		/** Open another saved project of this mode in place of this one. */
		onOpenProject?: (key: string) => void;
		/** The edit now saves under this key. */
		onProjectReady?: (key: string) => void;
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
		sessionKey = null,
		warmCanvas = null,
		warmRenderer = null,
		onExit,
		onOpenProject,
		onProjectReady,
	}: Props = $props();

	let isSequenceMode = $derived(mode === "sequence");
	let dragging = $state(false);

	// Sequence mode never plays `file`; media comes from the pool.
	let isVideo = $derived(!isSequenceMode && !!file?.type.startsWith("video/"));
	// Live webcam: a `<video>` on the camera stream stands in for the player.
	let isLive = $derived(!isSequenceMode && isLiveFile(file));
	let liveVideoEl = $state<HTMLVideoElement | null>(null);
	let liveStream = $state<MediaStream | null>(null);
	$effect(() => {
		const f = file;
		if (!isLive || !f) return;
		let dropped = false;
		void liveStreamOf(f)
			.then((stream) => {
				// Reopened after the cleanup already ran: nothing else will stop this one.
				if (dropped) {
					stopLiveFile(f);
					return;
				}
				liveStream = stream;
				if (!stream) showToast("The camera is gone", "error");
				// Unplugged while live: the feed would freeze on its last frame, unexplained.
				stream?.getVideoTracks()[0]?.addEventListener("ended", () => {
					if (!dropped) showToast("The camera disconnected", "error");
				});
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
	const singleVideo = new SingleVideo({
		audio: () => audio,
		file: () => file,
		isVideo: () => isVideo,
		proxyFor: (f): File | null => singleProxy.forFile(f),
		naturalSize: () => ({ width: naturalWidth, height: naturalHeight }),
		recordDuration: () => recordDuration,
		setRecordDuration: (seconds) => (recordDuration = seconds),
		recording: () => recordingState.recording,
		loop: () => videoLoop,
		markerTime: (): number | null =>
			timelineAxis && videoIsMaster ? timelineAxis.staticTime : null,
	});

	const singleProxy = new SingleProxy({
		active: () => !isSequenceMode && isVideo,
		file: () => file,
		player: () => singleVideo.player,
	});

	// The editor's still is the frame under the playhead; it starts on video.
	let format = $state<"png" | "jpg" | "webm">(
		isMobile && untrack(() => mode) !== "sequence" ? "png" : "webm",
	);
	let isImageFormat = $derived(format === "png" || format === "jpg");
	let isVideoFormat = $derived(format === "webm");
	let videoFormatLabel = $derived(getExportFormat() === "mp4" ? "MP4" : "WebM");
	let imageSrc = $state("");
	$effect(() => {
		if (!file) {
			imageSrc = "";
			return;
		}
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
		const f = file;
		if (isSequenceMode || !f) return;
		primarySync.untrack("primary");
		// Untracked: a re-render landing must not count as a change of file.
		untrack(() => {
			if (generatedSrc) URL.revokeObjectURL(generatedSrc);
			generatedSrc = null;
		});
		// An SVG is redrawn crisp at the output size; it has no pixels of its own yet.
		if (f && isSvgFile(f)) {
			primarySync.track(
				"primary",
				async (w, h) => (await rasterizeSvg(f, w, h)).blob,
				0,
				0,
			);
			return () => primarySync.untrack("primary");
		}
		void readGenerated(f).then((info) => {
			if (info && f === file)
				primarySync.track(
					"primary",
					specRender(info.spec),
					info.width,
					info.height,
				);
		});
		return () => primarySync.untrack("primary");
	});
	$effect(() => {
		primarySync.resize(resizeWidth, resizeHeight);
		sourceRegistry.setOutputSize(resizeWidth, resizeHeight);
	});
	$effect(() => () => {
		primarySync.dispose();
		if (generatedSrc) URL.revokeObjectURL(generatedSrc);
	});

	let generateOpen = $state(false);

	// The take lands at the second it started, on the selected lane or a new one.
	const loadWebcamPanel = lazy(() => import("../webcam/WebcamPanel.svelte"));
	let webcamOpen = $state(false);

	const loadProjectPicker = lazy(() => import("./ProjectPicker.svelte"));
	let projectPickerOpen = $state(false);
	let takeStart = 0;

	function takeTransport(playing: boolean) {
		if (playing) {
			takeStart = timelineAxis?.staticTime ?? clock.masterTime();
			clock.playSpan();
		} else {
			clock.pause();
		}
	}

	async function useTake(file: File) {
		const [source] = await addSequenceSources([file]);
		if (!source) return;
		const duration = clock.duration;
		if (duration <= 0) return;
		const want = source.duration > 0 ? source.duration : MIN_CLIP_LENGTH;
		const start = Math.min(takeStart, Math.max(0, duration - MIN_CLIP_LENGTH));
		const picked = mediaState.selectedLane;
		let laneId = picked?.id ?? null;
		let span = picked ? newClipSpan(picked, start, duration, want) : null;
		let next = mediaState.timeline;
		if (!span) {
			if (next.lanes.length >= MAX_MEDIA_LANES) {
				showToast("No room for the take: every lane is full", "error");
				return;
			}
			next = appendMediaLane(next, source.id, layerStack.topZ());
			const lane = next.lanes[next.lanes.length - 1]!;
			laneId = lane.id;
			span = newClipSpan(lane, start, duration, want);
			if (!span) return;
		}
		const clip = createMediaClip(span.start, span.end, 0, source.id);
		mediaState.pushHistory();
		mediaState.set(
			updateMediaLaneIn(next, laneId!, (l) => addClip(l, clip, duration)),
		);
		mediaState.selectedClipId = clip.id;
		mediaState.selectedClipIds = [clip.id];
		showToast(
			`Take on ${next.lanes.find((l) => l.id === laneId)?.name}`,
			"info",
		);
	}

	/** A pool thumb dropped on the picture: a lane of its own on top, centred where it
	 * landed, its clip under the playhead. */
	function dropSourceOnCanvas(sourceId: string, at: { x: number; y: number }) {
		const source = sourceRegistry.get(sourceId);
		const duration = clock.duration;
		if (!source || duration <= 0) return;
		if (mediaState.timeline.lanes.length >= MAX_MEDIA_LANES) {
			showToast("No room for another lane: every lane is full", "error");
			return;
		}
		const next = appendMediaLane(
			mediaState.timeline,
			source.id,
			layerStack.topZ(),
		);
		const lane = next.lanes[next.lanes.length - 1]!;
		const span = newClipSpan(
			lane,
			clock.masterTime(),
			duration,
			droppedClipLength(source, sourceRegistry.edits[source.id]),
		);
		if (!span) return;
		const clip = autoOnSlideshow(
			createMediaClip(span.start, span.end),
			source.kind === "cuts",
		);
		mediaState.pushHistory();
		mediaState.set(
			updateMediaLaneIn(next, lane.id, (l) => ({
				...addClip(l, clip, duration),
				style: { ...l.style, x: at.x, y: at.y },
			})),
		);
		mediaState.selectedClipId = clip.id;
		mediaState.selectedClipIds = [clip.id];
		void revealLaneRow(lane.id);
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
	let projectSong = $state<ProjectSongChoice>(
		saved.projectSong ?? DEFAULT_SETTINGS.projectSong,
	);
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
			mediaState.timeline,
			clock.time,
			sourceRegistry.edits,
			previewMediaChains,
			sourceDurations,
		).map((layer) => ({
			scope: layer.laneId,
			effects: layer.effects,
			response: layer.response ?? audioResponse,
		})),
		...resolveTextLayersAt(
			textState.timeline,
			clock.time,
			previewTextChains,
		).map((layer) => ({
			scope: layer.laneId,
			effects: layer.effects,
			response: audioResponse,
		})),
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
			return track ? trackToFile(track) : null;
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
	const micRecorder = new MicRecorder(
		mixer,
		(take) => void placeMicTake(take),
		(message) => showToast(message, "error"),
	);
	$effect(() => () => {
		micRecorder.dispose();
		mixer.dispose();
		audioBank.dispose();
	});

	// The audio links and Audio Bars read each moment against the whole song, so the
	// song on screen is analysed once it's known, and again when the mix changes.
	$effect(() => {
		if (isSequenceMode) {
			void mixer.plan;
			void mixer.duration;
			void audioBank.version;
			const timer = setTimeout(
				() => publishSongProfile(() => mixer.analyseDrive()),
				400,
			);
			return () => clearTimeout(timer);
		}
		const song =
			audio.trackFile ?? (isVideo && singleVideo.hasAudio ? file : null);
		const gain = audio.normalizeGain;
		publishSongProfile(
			song
				? () => getDecodedAudioBuffer(song).then((b) => songProfileOf(b, gain))
				: null,
		);
	});
	$effect(() => () => publishSongProfile(null));

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
		if (!isVideo || !singleVideo.el) return;
		if (audio.trackFile) {
			singleVideo.el.muted = true;
		} else {
			singleVideo.ensureAudioGraph();
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
		layerHighlight.value;
		const outputVolume = isSequenceMode
			? mixer.outputVolume
			: audio.outputVolume;
		const loopAudio = isSequenceMode ? mixer.loop : audio.loopAudio;
		videoLoop;
		projectSong;
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
			layerHighlight: layerHighlight.value,
			outputVolume,
			loopAudio,
			loopVideo: videoLoop,
			sourceFit,
			projectSong,
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

	/** Set while the output size is the project's saved one: media still loading reports
	 * its own size more than once, and none of those reports may replace it. */
	let sizeRestored = false;

	// A different file in single mode is new media, which takes its own size again.
	$effect(() => {
		void file;
		if (!isSequenceMode) sizeRestored = false;
	});

	// New media defaults the output to its own size.
	$effect(() => {
		const nw = naturalWidth;
		const nh = naturalHeight;
		if (nw != null && nh != null && nw > 0 && nh > 0 && !sizeRestored) {
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
		if (files.length > 0) songs.addFiles(files);
	}

	function clearTrack() {
		songs.clear();
	}

	/** The editor learned a track's library id without being asked to load it. */
	function adoptLibraryTrack(trackId: string) {
		if (currentTrackId === trackId) return;
		currentTrackId = trackId;
		songs.adopted(trackId);
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
				// Storage refused it; an unsaved id still lets the project start.
				if (audio.trackFile === f) adoptLibraryTrack(generateId());
			} finally {
				registeringTrack = null;
			}
		})();
	});

	function onLibraryLoadTrack(file: File, trackId: string, autoplay = false) {
		songs.pick(file, trackId, autoplay);
	}

	// An AudioContext created before a user gesture starts suspended and can't be resumed.

	// Not gated on audioContext: the graph is only built on first play.
	const hasAudio = $derived.by(() => clock.hasDrive);
	/** Whether the audio links have something to follow, for the panels' spectra. */
	let linksHaveAudio = $derived.by(() => clock.linksHaveAudio);
	let liveSpectrum = $derived.by(() => clock.spectrumData);

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
			still: isImageFormat,
		};
	}

	// Stacked effect lanes over the frame; chains run in lane order.
	const fxState = new FxLaneState({
		active: () => isSequenceMode,
		moshOptions: getMoshOptions,
		newLaneSettings: currentFxLaneSettings,
		duration: () => clock.duration,
		newLaneZ: (): number => newLaneZ(),
		rollAlive,
	});

	// Fixed per editor: a project or a session is a fresh editor.
	const clock: EditorClock =
		untrack(() => mode) === "sequence"
			? new SequenceClock({
					mixer,
					marker: () => timelineAxis?.staticTime ?? null,
					busy: () => mediaBusy,
					exportLength: () => recordDuration,
				})
			: new SingleClock({
					audio,
					video: singleVideo,
					isVideo: () => isVideo,
					marker: () => timelineAxis?.staticTime ?? null,
					exportLength: () => recordDuration,
					loop: () => videoLoop,
					setLoop: (on) => (videoLoop = on),
				});

	// Feeds the auto clips' re-roll spacing and the beat-synced effects.
	const tempo = new ProjectTempo({
		song: () => audio.trackFile,
		decode: (id) => audioBank.load(id),
		media: () => mediaState,
		text: () => textState,
		fx: () => fxState,
	});

	/** Segments waiting for the song's duration to be folded into the lanes. */
	let legacySegments = $state<{
		key: string;
		segments: LegacySegmentEntry[];
	} | null>(null);
	$effect(() => {
		const pending = legacySegments;
		if (!pending || pending.key !== keys.storeKey) return;
		const duration = clock.duration;
		if (duration <= 0) return;
		legacySegments = null;
		const { fxLane, mediaLane } = migrateLegacySegments(
			pending.segments,
			duration,
		);
		untrack(() => {
			if (fxLane) fxState.set([fxLane, ...fxState.lanes]);
			if (mediaLane)
				mediaState.timeline = prependMediaLane(mediaState.timeline, mediaLane);
			fxState.history.reset();
			mediaState.history.reset();
			poolHistory.reset();
			lengthHistory.reset();
			tempo.history.reset();
		});
	});

	// Keyed by master clock: clip times are relative to it.
	let videoSeqKey = $derived(
		isVideo && file
			? `video:${file.name}:${file.size}:${file.lastModified}`
			: null,
	);

	/** Single mode's session key; read once, since the edit keeps it for life. */
	const singleSessionKey = untrack(() =>
		mode === "sequence" ? null : (sessionKey ?? newSessionKey("single")),
	);
	/** The project's id: the song's id for projects from before v3, else its own. */
	const projectKey = untrack(() =>
		mode === "sequence"
			? (initialProjectKey ?? initialTrackId ?? `proj-${generateId()}`)
			: null,
	);
	/** A single edit keyed by its own id saves its timeline there too, not under its
	 * song or video, so two edits of the same file or song never share one. */
	const singleProjectBase =
		singleSessionKey && isOwnSessionKey(singleSessionKey)
			? singleSessionKey.slice("single:".length)
			: null;

	const keys: EditorKeys = projectKey
		? new ProjectKeys(projectKey)
		: new SessionKeys({
				sessionKey: singleSessionKey!,
				projectBase: singleProjectBase,
				masterIsAudio: () => clock.masterIsAudio,
				trackId: () => currentTrackId,
				videoKey: () => videoSeqKey,
			});

	// The video's own timeline, whenever it is the master: when it opens, and again once
	// a song leaves. With a song loaded, onLibraryLoadTrack owns restoring.
	$effect(() => {
		const key = videoSeqKey;
		if (singleProjectBase || !key || clock.masterIsAudio) return;
		const storeKey = keys.prefix + key;
		untrack(() => restoreVideoTimeline(key, storeKey));
	});

	function restoreVideoTimeline(key: string, storeKey: string) {
		timelines.loadedKey = null;
		void (async () => {
			const saved = await timelines.load(key);
			// A song adopted while this was out owns the state now.
			if (keys.storeKey !== storeKey) return;
			// Marked even with nothing to restore: a video with no saved timeline still saves.
			timelines.loadedKey = storeKey;
			if (saved === null) return;
			restoreTextTimeline(saved.text);
			restoreMediaTimeline(saved.media);
			sourceRegistry.restoreEdits(saved.sourceEdits);
		})();
	}

	// A single edit with its own key restores its timeline once, whatever song it plays.
	$effect(() => {
		if (!singleProjectBase) return;
		const storeKey = keys.prefix + singleProjectBase;
		untrack(() => {
			timelines.loadedKey = null;
			void (async () => {
				const saved = await timelines.load(singleProjectBase);
				timelines.loadedKey = storeKey;
				if (saved === null) return;
				if (saved.song && saved.song === currentTrackId) {
					tempo.restore(saved.bpm, saved.beatOffset);
				}
				restoreTextTimeline(saved.text);
				restoreMediaTimeline(saved.media);
				sourceRegistry.restoreEdits(saved.sourceEdits);
			})();
		});
	});

	/** Every autosave below reports here, for the top bar's saved/saving/failed word. */
	const saves = new SaveTracker();
	$effect(() => {
		saves.playing =
			audio.audioPlaying || singleVideo.isPlaying || mixer.playing;
	});

	const timelines = new TimelinePersistence({
		saves,
		prefix: keys.prefix,
		readsLegacy: untrack(() => isSequenceMode),
		storeKey: () => keys.storeKey,
		entry: seqEntryNow,
		playing: () => audio.audioPlaying || singleVideo.isPlaying || mixer.playing,
		baseSourceId: () => (file ? stableSourceId(file) : ""),
	});

	/** What gets saved, read deep; null while a project is still working out its length. */
	function seqEntryNow(): SeqEntry | null {
		if (isSequenceMode && !opener.ready) return null;
		const entry: SeqEntry = {
			v: SEQ_ENTRY_VERSION,
			bpm: tempo.bpm,
			beatOffset: tempo.beatOffset,
			text: layersAsLoaded(
				$state.snapshot(textState.timeline) as TextTimeline,
				"text",
			),
			media: $state.snapshot(mediaState.timeline) as MediaTimeline,
			fx: $state.snapshot(fxState.lanes) as FxLane[],
			sourceEdits: $state.snapshot(sourceRegistry.edits) as Record<
				string,
				SourceEdit
			>,
		};
		if (isSequenceMode) {
			entry.length = mixer.duration;
			entry.span = { start: mixer.spanStart, end: mixer.spanEnd };
		}
		// Single mode too: an edit with its own key keeps a BPM only for the song it was found for.
		entry.song = currentTrackId;
		if (tempo.poolSource) entry.bpmSource = tempo.poolSource;
		return entry;
	}

	/** What's on screen, for a project file that doesn't wait on autosaves. */
	function liveProject(): ProjectContent | null {
		const render = renderKey ? loadRenderSettings(renderKey) : null;
		if (isSequenceMode) {
			const entry = seqEntryNow();
			if (!entry) return null;
			const media = sourceRegistry.sources.map((s) => ({
				id: s.id,
				file: s.file,
				slide: slideOnlyIds.has(s.id),
			}));
			return { mode: "sequence", entry, media, render };
		}
		if (!file) return null;
		return {
			mode: "single",
			entry: seqEntryNow(),
			state: singleStateNow(),
			trackId: currentTrackId,
			media: [{ id: stableSourceId(file), file }],
			render,
		};
	}

	/** Save the whole project as a `.openmosh` file: the timeline, its pool, songs and
	 * fonts. The pending autosave is flushed first so the file matches what's on screen. */
	async function saveProjectFile() {
		const key = keys.ownKey;
		if (!key) return;
		timelines.flush();
		pool.flush();
		await downloadProjectFile(key, {
			mode: keys.mode,
			live: liveProject() ?? undefined,
		});
	}

	// Reloading or closing mid-playback would lose the session: no pause settles the debounce.
	// Hidden counts too: a phone can discard a background tab without a pagehide.
	onMount(() => {
		const onHide = () => {
			timelines.flush();
			pool.flush();
			sessionSave.flush();
		};
		const onVisibility = () => {
			if (document.visibilityState === "hidden") onHide();
		};
		window.addEventListener("pagehide", onHide);
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			window.removeEventListener("pagehide", onHide);
			document.removeEventListener("visibilitychange", onVisibility);
			onHide();
			// After the save: disposing empties the pool, which would then save as empty.
			sourceRegistry.dispose();
			mediaLayers.dispose();
		};
	});

	// Pull the clip lanes back inside the master clock when it changes. Not in sequence
	// mode: a shorter project leaves clips past its end alone, to come back if it grows.
	$effect(() => {
		const duration = clock.duration;
		if (duration <= 0 || isSequenceMode) return;
		untrack(() => {
			const media = fitMediaTimeline(mediaState.timeline, duration);
			if (media !== mediaState.timeline) mediaState.timeline = media;
			const text = fitTextTimeline(textState.timeline, duration);
			if (text !== textState.timeline) textState.timeline = text;
			const fx = fitFxLanes(fxState.lanes, duration);
			if (fx !== fxState.lanes) fxState.set(fx);
		});
	});

	/** The project's length, beside the lanes a change to it trims or shifts. */
	const lengthHistory = createSnapshotHistory<number>();

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

	/** A lane's audio response, falling back to the editor's for older lanes. */
	function fxLaneResponse(laneId: string) {
		const lane = fxState.lanes.find((l) => l.id === laneId);
		return lane ? laneAudioResponse(lane, audioResponse) : audioResponse;
	}

	/** The stacked lanes for this frame, with fade weights. */
	let fxLayers = $derived(
		isSequenceMode ? fxState.previewSource(clock.masterTime()) : [],
	);

	/** The same effects flat, for the panel-facing chain and the audio tick. */
	let fxChain = $derived(flattenFxLayers(fxLayers));

	// Every piece of media the project can draw; sourceTick bumps when a late upload lands.
	let sourceTick = $state(0);
	let sourceTickQueued = false;
	// Once a frame: a redraw whose upload asks for another redraw can't spin without yielding.
	const bumpSourceTick = () => {
		if (sourceTickQueued || seqPlaying()) return;
		sourceTickQueued = true;
		requestAnimationFrame(() => {
			sourceTickQueued = false;
			if (!seqPlaying()) sourceTick++;
		});
	};

	const {
		poolHistory,
		poolNow,
		dropFromPool,
		keepAddsThroughPoolUndo,
		setPool,
		removeSequenceSource,
		clearPool,
	} = createPoolEdits({
		registry: () => sourceRegistry,
		media: () => mediaState,
		slideOnlyIds: () => slideOnlyIds,
	});

	/** Once per session: a browser that won't store files refuses every add. */
	let mediaSaveFailed = false;
	const sourceRegistry = new SequenceSourceRegistry(
		bumpSourceTick,
		(write) => {
			void saves
				.track(
					"media",
					write.then(() => true),
				)
				.then((ok) => {
					if (ok || mediaSaveFailed) return;
					mediaSaveFailed = true;
					showToast(
						"This browser wouldn't store your media, so it won't be here after a reload. Save a project file to keep it.",
						"error",
						10000,
					);
				});
		},
		reportUnreadableImages,
		keepAddsThroughPoolUndo,
	);

	/** The pool has dropped these already; the lanes that drew them let go too. */
	function reportUnreadableImages(sources: SequenceSource[]) {
		for (const src of sources) {
			mediaState.set(detachMediaSource(mediaState.timeline, src.id));
		}
		const heic = sources.some((s) => /^image\/hei[cf]$/.test(s.file.type));
		const what =
			sources.length === 1
				? `Couldn't read "${sources[0].name}", so it was removed from the pool`
				: `Couldn't read ${sources.length} images, so they were removed from the pool`;
		showToast(
			heic
				? `${what}. This browser can't open HEIC photos. Convert them to JPG or use Safari`
				: what,
			"error",
			heic ? 10000 : 6000,
		);
	}
	$effect(() => {
		uiPrefs.previewProxies;
		untrack(() => {
			singleProxy.refresh();
			sourceRegistry.refreshProxies();
		});
	});

	let sequenceSources = $derived(sourceRegistry.sources);
	/** Pool media that came in only as a slideshow's slides. Kept past a removal, so an
	 * undo brings a slideshow back with its slides still behind it. */
	let slideOnlyIds = $state<ReadonlySet<string>>(new Set());
	/** The pool as its views list it: a slideshow's slides stay behind it. */
	let poolSources = $derived.by(() => {
		const hidden = hiddenSlides(
			sequenceSources,
			mediaState.timeline,
			slideOnlyIds,
		);
		return hidden.size === 0
			? sequenceSources
			: sequenceSources.filter((s) => !hidden.has(s.id));
	});
	const pool = new PoolPersistence({
		active: untrack(() => isSequenceMode),
		registry: sourceRegistry,
		baseKey: () => keys.baseKey,
		prefix: keys.prefix,
		timelines,
		saves,
		slideOnlyIds: () => slideOnlyIds,
		setSlideOnlyIds: (ids) => (slideOnlyIds = ids),
		mediaTimeline: () => mediaState.timeline,
		hasSong: () => !!audio.trackFile,
	});
	let noSequenceMedia = $derived(pool.empty);
	let mediaLoading = $derived(pool.loading);

	/** Playback waits for the project to open; media added while it plays joins in. */
	let mediaBusy = $derived(mediaLoading);
	$effect(() => {
		if (mediaBusy && untrack(() => mixer.playing)) clock.pause();
	});

	// Opened from a saved project: these blobs came from storage, so don't write them back.
	onMount(() => {
		void pool.open(
			file,
			extraFiles,
			!initialTrackId && !initialProjectKey,
			explainRejectedModels,
		);
	});

	const { addSequenceSources, addLayerSources, explainRejectedModels } =
		createPoolAdds({
			registry: sourceRegistry,
			media: () => mediaState,
			persistent: () => isSequenceMode,
			slideOnlyIds: () => slideOnlyIds,
			setSlideOnlyIds: (ids) => (slideOnlyIds = ids),
			reportModelProblems: (problems) =>
				(modelProblems = [...modelProblems, ...problems]),
		});

	/** 3D files the pool turned down, and why; the dialog is up while there are any. */
	let modelProblems = $state<ModelProblem[]>([]);
	const loadUnsupportedModelDialog = lazy(
		() => import("../ui/UnsupportedModelDialog.svelte"),
	);

	let showClearSourcesConfirm = $state(false);

	/** Empty the pool; clips that drew from it lose their media, deleted from storage too. */
	function clearSequenceSources() {
		showClearSourcesConfirm = false;
		if (clearPool()) pool.forgetRestoreAttempts();
	}

	/** Clips pointing at a removed source draw nothing; an empty pool shows the placeholder. */
	function sourceProxyAction(id: string, action: ProxyAction["kind"]) {
		if (action === "retry") sourceRegistry.retryProxy(id);
		else sourceRegistry.setProxyEnabled(id, action === "enable");
	}

	/** Grid replaces the preview while the pool is arranged; the timeline stays under it. */
	let sequenceView = $state<"preview" | "grid">("preview");
	let sequenceGridOpen = $derived(isSequenceMode && sequenceView === "grid");

	// Starting playback from the grid means the user wants to watch it, so leave the grid.
	$effect(() => {
		if (isSequenceMode && seqPlaying()) sequenceView = "preview";
	});

	function seqPlaying(): boolean {
		return clock.sourcePlaying();
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
		// A model or a slideshow has no pixel size of its own to lend the project.
		const first = sequenceSources.find(
			(s) => s.kind === "image" || s.kind === "video",
		);
		if (!first) {
			seqBaseSize = { width: 1920, height: 1080 };
			return;
		}
		if (first.width && first.height) {
			seqBaseSize = { width: first.width, height: first.height };
		}
	});
	/** The latest clip end on any lane. */
	function timelineContentEnd(): number {
		return contentEnd(
			mediaState.timeline,
			textState.timeline.lanes,
			fxState.lanes,
		);
	}

	/** Where the first clip on any lane starts; 0 for an empty project. */
	function timelineContentStart(): number {
		return contentStart(
			mediaState.timeline,
			textState.timeline.lanes,
			fxState.lanes,
		);
	}

	/** Trim the project to its clips at both ends, as one undo step. */
	function fitProjectToClips() {
		const start = timelineContentStart();
		const end = timelineContentEnd();
		asOneEdit(() => {
			if (start > 0) growProjectFront(-start);
			setProjectLength(end - start);
		});
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
		for (const lane of mediaState.timeline.audioLanes ?? []) {
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
					timeline: mediaState.timeline,
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
		// Sound off the lanes, the song and the pool is let go; the pool's stays, as
		// whether a video is silent decides its lane's mute button.
		const keep = new Set([...ids, ...sourceRegistry.sources.map((s) => s.id)]);
		untrack(() => audioBank.retain(keep));
	});

	const peaksOf = (id: string) => audioBank.peaks(id);

	/** Names of library tracks on the lanes, filled in as they're looked up. */
	let audioTrackNames = $state<Record<string, string>>({});
	$effect(() => {
		for (const lane of mediaState.timeline.audioLanes ?? []) {
			for (const clip of lane.clips) {
				const trackId = clip.sourceId ? trackIdOf(clip.sourceId) : null;
				if (!trackId || untrack(() => audioTrackNames[trackId])) continue;
				void getTrack(trackId).then((t) => {
					if (t) audioTrackNames = { ...audioTrackNames, [trackId]: t.name };
				});
			}
		}
	});

	/** Where a looped audio clip's sound starts over. */
	function audioClipRepeats(clip: AudioClip): number[] {
		const id = clip.sourceId;
		if (!id) return [];
		const videoLength = videoLengths[id];
		if (videoLength) {
			return videoClipRepeats(
				sourceRegistry.edits[id],
				videoLength,
				clip,
				!!clip.loop,
			);
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
				!!clip.loop,
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

	// Decoding starts as a song leaves the library, so the lanes can show its length.
	$effect(() => {
		const trackId = draggedTrackId();
		if (isSequenceMode && trackId) audioBank.ensure([trackSourceId(trackId)]);
	});

	function decodedLength(sourceId: string): number | null {
		return audioBank.buffer(sourceId)?.duration ?? null;
	}

	function toggleMicTake(laneId: string) {
		if (micRecorder.take || micRecorder.arming) micRecorder.stop();
		else void micRecorder.start(laneId, timelineAxis?.staticTime ?? 0);
	}

	/** What is on screen now: the main chain, then each fx lane's in lane order. */
	let renderedEffects = $derived.by(() =>
		fxChain.length === 0 ? effects : [...effects, ...fxChain],
	);
	// A preset overwritten in the panel; overwriting never re-assigns it, so this isn't an edit.
	function seqSyncPreset(preset: Preset) {
		mediaState.timeline = syncMediaClipsToPreset(mediaState.timeline, preset);
		textState.timeline = syncTextClipsToPreset(textState.timeline, preset);
		fxState.lanes = syncFxClipsToPreset(fxState.lanes, preset);
	}

	// A hand-edit to a preset-filled fx clip: the label gains a "*".
	function markPanelClipEdited() {
		const target = fxState.selectedClip;
		if (!target) return;
		// A hand-built chain takes its name from what it switches on; an auto clip keeps its label.
		if (target.mode === "interval") {
			if (target.presetName) target.modified = true;
		} else if (isHandBuiltLabel(target))
			target.label = handBuiltLabel(target.effects);
		else if (!target.modified) target.modified = true;
	}

	/** The selected fx clip's chain, or single mode's main chain. */
	function getPanelEffects(): EffectInstance[] {
		return fxState.selectedClip?.effects ?? effects;
	}

	/** Sequence mode only: with nothing selected the rack has no chain to edit. */
	let panelNoTarget = $derived.by(() => {
		if (!isSequenceMode || fxState.selectedClip) return null;
		return {
			title: "Nothing selected",
			hint: "Click a media clip or an FX clip on the timeline to edit its chain.",
		};
	});

	let panelNote = $derived(
		[
			fxState.selectedClip?.mode === "interval"
				? "These effects run after the auto mosh."
				: null,
			fxState.chainNote,
		]
			.filter(Boolean)
			.join(" ") || null,
	);

	function setPanelEffects(v: EffectInstance[]) {
		const clip = fxState.selectedClip;
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
		setEffects: (v) => (effects = withoutHiddenEffects(v)),
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
			if (fxState.selectedClip) {
				burstOwner = "fx";
				fxState.pushHistory();
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
		fxEditBase = fxState.selectedClip
			? ($state.snapshot(fxState.selectedClip) as FxClip)
			: null;
		panelBurst.beforeEdit(coalesceKey);
	};

	/** "All links" reaches every selected fx clip, whatever effects it runs. */
	function setFxClipsBand(band: FreqBand) {
		const ids = new Set(fxState.selectedClipIds);
		if (ids.size < 2) return;
		fxState.lanes = fxState.lanes.map((l) => ({
			...l,
			clips: l.clips.map((c) =>
				ids.has(c.id) ? withAllLinkBands(c, band) : c,
			),
		}));
	}

	/** The panel edits the fx clip in place; carry the edit to the other selected clips. */
	function fanOutFxEdit() {
		const clip = fxState.selectedClip;
		const base = fxEditBase;
		if (!clip || base?.id !== clip.id) return;
		const after = $state.snapshot(clip) as FxClip;
		fxEditBase = after;
		const others = fxState
			.clipsById(new Set(fxState.selectedClipIds))
			.filter((c) => c.id !== clip.id);
		const fanned = fanOutEdit(base, after, $state.snapshot(others) as FxClip[]);
		if (fanned.length === 0) return;
		const byId = new Map(fanned.map((c) => [c.id, c]));
		fxState.lanes = fxState.lanes.map((l) => ({
			...l,
			clips: l.clips.map((c) => byId.get(c.id) ?? c),
		}));
	}

	/** Clips of any lane kind the preview goes round, spanning first start to last end. */
	let repeatClipIds = $state<string[]>([]);
	/** The span once dragged on the ruler; it stops following the clips from then on. */
	let repeatSpan = $state<{ start: number; end: number } | null>(null);
	let repeatRange = $derived.by(() => {
		if (repeatClipIds.length === 0) return null;
		if (repeatSpan) {
			const end = Math.min(repeatSpan.end, clock.duration);
			return end > repeatSpan.start ? { start: repeatSpan.start, end } : null;
		}
		const ids = new Set(repeatClipIds);
		let start = Infinity;
		let end = -Infinity;
		const lanes: { clips: TimelineClip[] }[] = [
			...mediaState.timeline.lanes,
			...(mediaState.timeline.audioLanes ?? []),
			...textState.timeline.lanes,
			...fxState.lanes,
		];
		for (const lane of lanes) {
			for (const c of lane.clips) {
				if (!ids.has(c.id)) continue;
				start = Math.min(start, c.start);
				end = Math.max(end, c.end);
			}
		}
		end = Math.min(end, clock.duration);
		return end > start ? { start, end } : null;
	});
	$effect(() => {
		mixer.repeat = isSequenceMode ? repeatRange : null;
	});
	// Clips deleted or moved past the end take the repeat with them.
	$effect(() => {
		if (repeatClipIds.length > 0 && !repeatRange) stopRepeat();
	});

	function stopRepeat() {
		repeatClipIds = [];
		repeatSpan = null;
	}
	// Single mode's clocks have no range of their own: pull them back into it.
	$effect(() => {
		const range = repeatRange;
		if (isSequenceMode || !range) return;
		const t = clock.masterTime();
		if (t < range.start - 0.05 || t >= range.end) clock.seek(range.start);
	});

	/** Repeat these clips, or stop if they're the ones repeating. Starts playback there. */
	function toggleRepeat(clipIds: string[]) {
		const same =
			clipIds.length === repeatClipIds.length &&
			clipIds.every((id) => repeatClipIds.includes(id));
		if (same || clipIds.length === 0) {
			stopRepeat();
			return;
		}
		repeatClipIds = [...clipIds];
		repeatSpan = null;
		const range = repeatRange;
		if (!range) return;
		// Ahead of the effect, so play() already clamps to the range.
		if (isSequenceMode) mixer.repeat = range;
		clock.seek(range.start);
		if (!clock.playing()) clock.toggle();
	}

	/** R: the selection, whichever lane it's on. */
	function toggleSelectionRepeat() {
		const ids =
			mediaState.selectedClipIds.length > 0
				? mediaState.selectedClipIds
				: textState.selectedClipIds.length > 0
					? textState.selectedClipIds
					: fxState.selectedClipIds.length > 0
						? fxState.selectedClipIds
						: selectedAudioClipIds;
		// R with nothing picked still stops a repeat.
		toggleRepeat(ids.length > 0 ? ids : repeatClipIds);
	}

	/** True while the media edit modal is up. */
	let sourceEditOpen = $state(false);

	/** The modal has its own transport, so the preview stops while it is up. */
	/** The pool as Edit media opened on: its crop, key and erase edits land on Ctrl+Z
	 * as one step when it closes, while its own undo covers the steps inside. */
	let poolBeforeSourceEdit: PoolEntry[] | null = null;

	/** A source edit from outside Edit media (a clip's speed) is its own undo step. */
	function editSource(id: string, edit: SourceEdit) {
		if (!sourceEditOpen) poolHistory.push(poolNow(), `source-edit-${id}`);
		sourceRegistry.setEdit(id, edit);
	}

	const sourceEditSession = new SourceEditSession<"rail" | "clip">({
		onOpen: () => {
			poolBeforeSourceEdit = poolNow().map((e) => ({
				...e,
				edit: e.edit && ($state.snapshot(e.edit) as SourceEdit),
			}));
			sourceEditOpen = true;
			clock.pause();
		},
		onClose: () => {
			const before = poolBeforeSourceEdit;
			poolBeforeSourceEdit = null;
			sourceEditOpen = false;
			const changed = before?.some(
				(e) =>
					JSON.stringify(e.edit ?? null) !==
					JSON.stringify(sourceRegistry.edits[e.id] ?? null),
			);
			if (before && changed) poolHistory.push(before);
		},
	});

	/** Called from the reporters' effects: untracked, or they'd re-run on what this reads. */
	function onSourceEditingChange(reporter: "rail" | "clip", open: boolean) {
		untrack(() => sourceEditSession.report(reporter, open));
	}

	let moshGroupRef: MoshGroup | undefined = $state(undefined);
	// svelte-ignore non_reactive_update
	let recordGroupRef: RecordGroup | undefined = undefined;
	let trackLibraryRef: TrackLibrary | undefined = undefined;

	/** → : forward through the mosh history, rolling a new mosh at its top. */
	function mosh() {
		glCanvasRef?.dismissHighlight();
		// A layer's panel has taken the sidebar over, so the arrows belong to its chain.
		const mediaClip = mediaState.selectedClip;
		if (mediaClip) {
			mediaState.moshes.forward(mediaClip.id);
			return;
		}
		const textClip = textState.selectedClip;
		if (textClip) {
			textState.moshes.forward(textClip.id);
			return;
		}
		// A selected fx clip is what every panel action aims at, so a mosh means it.
		const clip = fxState.selectedClip;
		if (clip) {
			fxState.moshes.forward(clip.id);
			return;
		}
		// Sequence mode: every chain lives on a clip, so with nothing selected the arrows do nothing.
		if (isSequenceMode) return;
		moshSession.forward();
	}

	/** ← : back through the mosh history. Never touches the edit history. */
	function undoMosh() {
		glCanvasRef?.dismissHighlight();
		const mediaClip = mediaState.selectedClip;
		if (mediaClip) {
			mediaState.moshes.back(mediaClip.id);
			return;
		}
		const textClip = textState.selectedClip;
		if (textClip) {
			textState.moshes.back(textClip.id);
			return;
		}
		const clip = fxState.selectedClip;
		if (clip) {
			fxState.moshes.back(clip.id);
			return;
		}
		if (isSequenceMode) return;
		moshSession.back();
	}

	// Ctrl+Z/Y: hand-edits only, across every stack the editor owns; the newest edit wins.
	const fxUndo = snapshotUndoSource(
		fxState.history,
		() => $state.snapshot(fxState.lanes) as FxLane[],
		(lanes) => fxState.set(lanesWithoutHiddenEffects(lanes)),
		() => burstOwner === "fx" && panelBurst.open,
	);
	// Built per press: the text and media stacks are declared further down.
	// Length before the span: one edit can move both, and a length set last would
	// stretch the span it just restored.
	const undoSources = (): UndoSource[] => [
		snapshotUndoSource(
			lengthHistory,
			() => mixer.duration,
			(length) => mixer.setDuration(length),
		),
		isSequenceMode ? mixSpanHistory.undoSource : spanHistory.undoSource,
		snapshotUndoSource(
			textState.history,
			() => $state.snapshot(textState.timeline) as TextTimeline,
			(t) => textState.set({ ...t, lanes: lanesWithoutHiddenEffects(t.lanes) }),
		),
		snapshotUndoSource(
			mediaState.history,
			() => $state.snapshot(mediaState.timeline) as MediaTimeline,
			(t) =>
				mediaState.set({ ...t, lanes: lanesWithoutHiddenEffects(t.lanes) }),
		),
		snapshotUndoSource(
			poolHistory,
			poolNow,
			(entries) => void setPool(entries),
		),
		// The retimed clips come back from their own stacks, so only the number is set.
		snapshotUndoSource(
			tempo.history,
			() => tempo.bpm,
			(bpm) => (tempo.bpm = bpm),
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
		const clip = fxState.selectedClip;
		if (clip) {
			panelBeforeEdit();
			clearEffectsFn(clip.effects);
			if (isHandBuiltLabel(clip)) clip.label = handBuiltLabel(clip.effects);
			else clip.modified = true;
			fanOutFxEdit();
			return;
		}
		// A slider tweak still coalescing is its own step, recorded before the clear.
		panelBurst.end();
		clearEffectsFn(effects);
		moshSession.pushEdit(effects);
	}

	/** Leaving for another project saves this one on the way out, as exiting does. */
	function openOtherProject(key: string) {
		if (!onOpenProject) return;
		if (recordingState.recording) {
			showToast(
				"Cancel or wait for the recording to finish before switching projects",
				"error",
			);
			return;
		}
		onOpenProject(key);
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
		sessionSave.flush();
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
		// Through the canvas, not r.render: the editor's picture is its layers, not the base chain.
		const draw = () => {
			if (!glCanvasRef?.drawNow(time, !recordingState.recording))
				r.render(renderedEffects, time);
		};
		if (needsResize) r.resize(resizeWidth, resizeHeight);
		draw();
		capture(() => {
			if (needsResize) {
				r.resize(prevW, prevH);
				draw();
			}
		});
	}

	/** Bake the current frame into a new source file; destructive, so it hands back an Undo. */
	function reInput() {
		if (!canvasEl) return;
		// Single mode only: sequence draws from a pool of sources through its layers.
		const prevFile = file;
		if (isSequenceMode || !prevFile) return;
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

	const timelineSplit = new TimelineSplit();
	const laneFolds = new LaneFolds();

	const handleKeydown = createKeyboardHandler({
		save,
		saveProject: saveProjectFile,
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
		togglePlay: clock.toggle,
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
	/** A ceiling on typos for the editor's project length. */
	const MAX_PROJECT_LENGTH = 3600;

	/** Which project the export settings belong to; `keys.storeKey` carries the mode prefix. */
	let renderKey = $derived(
		keys.storeKey ??
			(isSequenceMode || !file
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
			// Single mode falls back to the per-track size store used before the output size lived here.
			const size =
				saved?.width && saved?.height
					? { width: saved.width, height: saved.height }
					: !isSequenceMode && currentTrackId
						? sizeStore.load(currentTrackId)
						: null;
			sizeRestored = !!size && size.width > 0 && size.height > 0;
			if (size && sizeRestored) {
				resizeWidth = size.width;
				resizeHeight = size.height;
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
	const textState = new ChainTimelineState<TextTimeline, TextLane, TextClip>(
		untrack(() =>
			initialSession?.text
				? layersOffOnMobile(normalizeTextTimeline(initialSession.text), "text")
				: { ...EMPTY_TEXT_TIMELINE },
		),
		textTimelineOps,
		{ moshOptions: getMoshOptions, rollAlive, onSet: retainLaneMoshes },
	);
	let lyricsOpen = $state(false);

	// Lanes of media over the master clock, each clip with its own chain; sequence mode only.
	const mediaState = new ChainTimelineState<
		MediaTimeline,
		MediaLane,
		MediaClip
	>(
		untrack(() => ({ ...EMPTY_MEDIA_TIMELINE, enabled: isSequenceMode })),
		mediaTimelineOps((id) => isModelSource(id)),
		{ moshOptions: getMoshOptions, rollAlive, onSet: retainLaneMoshes },
	);

	/** Lane shown by itself on the canvas; not timeline data, so it never persists or exports. */
	let soloMediaLaneId = $state<string | null>(null);

	function toggleMediaSolo(laneId: string) {
		soloMediaLaneId = soloMediaLaneId === laneId ? null : laneId;
	}

	/** Every lane on the stack, whatever kind: the fold-all control works on the lot. */
	let laneIds = $derived([
		...mediaState.timeline.lanes.map((lane) => lane.id),
		...(mediaState.timeline.audioLanes ?? []).map((lane) => lane.id),
		...textState.timeline.lanes.map((lane) => lane.id),
		...fxState.lanes.map((lane) => lane.id),
	]);

	let allLanesFolded = $derived(laneFolds.allFolded(laneIds));

	// Solo only counts while its lane is on the stack; the id is kept so undo brings it back.
	let soloLaneId = $derived(
		mediaState.timeline.lanes.some((l) => l.id === soloMediaLaneId)
			? soloMediaLaneId
			: null,
	);

	function singleStateNow(): SingleSessionState {
		const hasText = textState.timeline.lanes.length > 0;
		const trimmed =
			currentTrackId &&
			audio.pendingSpan === null &&
			audio.spanEnd > audio.spanStart;
		return {
			effects: $state.snapshot(effects) as EffectInstance[],
			text: hasText
				? layersAsLoaded(
						$state.snapshot(textState.timeline) as TextTimeline,
						"text",
					)
				: null,
			...(trimmed
				? { span: { start: audio.spanStart, end: audio.spanEnd } }
				: {}),
		};
	}

	const sessionSave = new SingleSessionSave({
		active: () => !isSequenceMode,
		live: () => isLive,
		worked: () => moshSession.worked,
		hasText: () => textState.timeline.lanes.length > 0,
		state: singleStateNow,
		file: () => file,
		trackId: () => currentTrackId,
		sessionKey: singleSessionKey,
		held: () => !!keys.storeKey && timelines.isHeld(keys.storeKey),
		onStale: () => {
			if (keys.storeKey) timelines.hold(keys.storeKey, "elsewhere");
		},
		playing: () => audio.audioPlaying || singleVideo.isPlaying,
		saves,
		onSaved: (key) => onProjectReady?.(key),
		initiallyStored: untrack(() => !!initialSession),
	});

	const shortcutGroups = $derived(
		editorShortcutGroups({
			sequence: isSequenceMode,
			text: textState.timeline.enabled,
			media: mediaState.timeline.enabled,
		}),
	);

	// A still image with no track has no clock, so the text timeline supplies one.
	/** Clips are half-open, so a playhead parked on the project's end would draw none of
	 * the ones ending there; the export's last frame shows them. */
	let previewTime = $derived(
		isSequenceMode && mixer.duration > 0
			? Math.min(clock.time, mixer.duration - 1e-3)
			: clock.time,
	);
	// Every lane shares the master clock's axis; a video under its own span is a second clock.
	let showVideoBar = $derived(
		isVideo &&
			singleVideo.duration > 0 &&
			!(isSequenceMode && clock.masterIsAudio),
	);
	let videoIsMaster = $derived(showVideoBar && !clock.masterIsAudio);
	let audioIsMaster = $derived(audio.trackFile && audio.trackDuration > 0);
	let showStack = $derived(
		isSequenceMode
			? clock.duration > 0
			: clock.length > 0 &&
					(textState.timeline.enabled ||
						mediaState.timeline.enabled ||
						videoIsMaster ||
						audioIsMaster),
	);

	// The lanes' own actions, gathered into one toolbar rather than a header row each.
	let sourceInput = $state<HTMLInputElement | undefined>(undefined);

	function addTextLane() {
		textState.pushHistory();
		textState.set(appendTextLane(textState.timeline, newLaneZ()));
	}

	const layerStack = new LayerStack({
		media: mediaState,
		text: textState,
		fx: fxState,
		activeLaneId: () => timelineAxis?.activeLaneId,
		revealLane: (id) => void revealLaneRow(id),
	});
	const { reorder: reorderLayer, newLaneZ, copyMediaLane } = layerStack;

	/** Scroll the stack just enough to show a lane's row. */
	async function revealLaneRow(laneId: string) {
		await tick();
		document
			.querySelector(`[data-layer-id="${laneId}"]`)
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}

	// Owned here rather than by either lane component: a drag crosses between text and media rows.
	let draggingLaneId = $state<string | null>(null);

	function startLayerDrag(laneId: string, e: PointerEvent) {
		startLayerRowDrag(e, laneId, {
			order: () => layerStack.order,
			reorder: reorderLayer,
			setDragging: (id) => (draggingLaneId = id),
		});
	}

	// A restored timeline is the baseline, so the stack starts seeded with EMPTY.
	if (untrack(() => initialSession?.text)) {
		textState.history.reset();
	}

	/** Adopt a saved timeline, or clear back to empty when a track has none. */
	function restoreTextTimeline(saved: TextTimeline | null) {
		textState.adopt(
			saved ? layersOffOnMobile(saved, "text") : { ...EMPTY_TEXT_TIMELINE },
		);
	}

	/** Adopt a saved timeline, or clear back to empty. Always on in sequence mode. */
	function restoreMediaTimeline(saved: MediaTimeline | null) {
		mediaState.adopt({
			...(saved ?? EMPTY_MEDIA_TIMELINE),
			enabled: isSequenceMode,
		});
		poolHistory.reset();
		lengthHistory.reset();
		tempo.history.reset();
	}

	const { addSlideshow, refreshSlideshow, addSingleEdit, refreshSingleEdit } =
		createProjectImports({
			registry: sourceRegistry,
			media: mediaState,
			slideOnlyIds: () => slideOnlyIds,
			setSlideOnlyIds: (ids) => (slideOnlyIds = ids),
			settleAudio: (ids) => audioBank.settle(ids),
			hasSong: () => !!audio.trackFile,
			loadSong: (id) => projectSongs.load(id),
			projectLength: () => mixer.duration,
			growProjectTo: (length) => growProjectTo(length),
			playhead: () => timelineAxis?.staticTime ?? 0,
			nextLaneZ: () => layerStack.topZ(),
			revealLane: (id) => void revealLaneRow(id),
			capturePool: () => {
				const before = poolNow();
				return () => poolHistory.push(before);
			},
			dropFromPool,
			closePicker: () => (projectPickerOpen = false),
		});

	const {
		placeAudio,
		dropTrack,
		placeMicTake,
		addEmptyAudioLane,
		removeAudioClipsOf,
		detachClipsAudio,
		reattachClipsAudio,
	} = createAudioLaneEdits({
		media: mediaState,
		mixer,
		bank: audioBank,
		lengthHistory,
		spanHistory: mixSpanHistory,
		selectAudioClip: (id) => {
			selectedAudioClipId = id;
			selectedAudioClipIds = [id];
		},
		hasVideoSound: (id) =>
			sequenceSources.find((s) => s.id === id)?.kind === "video" &&
			!audioBank.isSilent(id),
		edits: () => sourceRegistry.edits,
		videoLengths: () => videoLengths,
		activeLaneId: () => timelineAxis?.activeLaneId,
		hasSong: () => !!audio.trackFile,
		loadSong: (id) => projectSongs.load(id),
	});

	const { setProjectLength, growProjectTo, growProjectFront } =
		createProjectLength({
			media: mediaState,
			text: textState,
			fx: fxState,
			mixer,
			lengthHistory,
			spanHistory: mixSpanHistory,
			pause: () => clock.pause(),
			repeatSpan: () => repeatSpan,
			setRepeatSpan: (span) => (repeatSpan = span),
		});

	const settingsPanel = new LaneSettingsPanel({
		active: () => isSequenceMode,
		fx: fxState,
		media: mediaState,
		editorSettings: currentFxLaneSettings,
		setEditorSetting: (key, value) => {
			const v = value as never;
			if (key === "moshMin") moshMin = v;
			else if (key === "moshMax") moshMax = v;
			else if (key === "moshStyle") moshStyle = v;
			else if (key === "randomizeOrder") randomizeOrder = v;
			else if (key === "moshAudioLink") moshAudioLink = v;
			else if (key === "moshAudioLinkStrength") moshAudioLinkStrength = v;
			else linkBand.value = v;
		},
		setEditorResponse: (key, value) => {
			if (key === "smoothing") audioSmoothing = value;
			else audioPunch = value;
		},
	});

	const opener = new ProjectOpener({
		active: untrack(() => isSequenceMode),
		projectKey: () => projectKey,
		storeKey: () => keys.storeKey,
		prefix: keys.prefix,
		timelines,
		saves,
		tempo,
		fx: fxState,
		media: mediaState,
		registry: sourceRegistry,
		mixer,
		spanHistory: mixSpanHistory,
		restoreText: restoreTextTimeline,
		restoreMedia: restoreMediaTimeline,
		setLegacySegments: (pending) => (legacySegments = pending),
		currentTrackId: () => currentTrackId,
		loadSong: (id) => projectSongs.load(id),
		openedName: () =>
			initialAudioFile?.name ?? file?.name ?? "Untitled project",
		song: () => {
			audioBank.version;
			// A song handed in without a library id gets one first; it's keyed by that.
			if (audio.trackFile && !currentTrackId) return undefined;
			const songId = songSourceId;
			if (!songId) return { id: null, length: 0 };
			const buffer = audioBank.buffer(songId);
			if (!buffer && !audioBank.isSilent(songId)) return undefined;
			return { id: songId, length: buffer?.duration ?? 0 };
		},
		openedSource: () =>
			file ? (sourceRegistry.get(stableSourceId(file)) ?? null) : null,
		openDone: () => pool.openDone,
		contentEnd: timelineContentEnd,
		legacySpan: (trackId) => spanStore.load(trackId),
		resetHistories: () => {
			mediaState.history.reset();
			poolHistory.reset();
			lengthHistory.reset();
			tempo.history.reset();
		},
		onReady: (key) => {
			rememberLastOpened({ mode: "sequence", key });
			onProjectReady?.(key);
		},
	});

	const singleSong = new SingleSong({
		audio,
		timelines,
		pool,
		tempo,
		fx: fxState,
		registry: sourceRegistry,
		restoreText: restoreTextTimeline,
		restoreMedia: restoreMediaTimeline,
		trackId: () => currentTrackId,
		setTrackId: (id) => (currentTrackId = id),
		storeKey: () => keys.storeKey,
		prefix: keys.prefix,
		projectBase: singleProjectBase,
		savedSpan: (trackId) => spanStore.load(trackId),
		initialSpan: untrack(() => {
			const span = initialSession?.span;
			return span && Number.isFinite(span.start) && span.end > span.start
				? span
				: null;
		}),
	});
	const projectSongs = new ProjectSongs({
		audio,
		tempo,
		bank: audioBank,
		media: () => mediaState,
		trackId: () => currentTrackId,
		setTrackId: (id) => (currentTrackId = id),
		playhead: () => timelineAxis?.staticTime ?? 0,
		placeAudio,
		removeAudioClipsOf,
	});
	// Fixed per editor, like the clock.
	const songs: SongHandler = untrack(() => isSequenceMode)
		? projectSongs
		: singleSong;

	/** What a new lane starts on: the first thing in the pool. */
	function defaultLayerSourceId(): string | null {
		return poolSources[0]?.id ?? null;
	}

	function addMediaLane() {
		if (mediaState.timeline.lanes.length >= MAX_MEDIA_LANES) return;
		const sourceId = defaultLayerSourceId();
		mediaState.pushHistory();
		const next = appendMediaLane(mediaState.timeline, sourceId, newLaneZ());
		mediaState.set(next);
		revealLaneRow(next.lanes[next.lanes.length - 1].id);
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
				fxState.selectedClipId = null;
				fxState.selectedClipIds = [];
				// A lane picked by name aims the settings panel at it.
				fxState.selectedLaneId = null;
			}
			if (keep !== "media") mediaState.selectedClipId = null;
			if (keep !== "text") textState.selectedClipId = null;
			if (keep !== "audio") selectedAudioClipId = null;
		});
	}

	$effect(() => {
		if (fxState.selectedClipId || fxState.selectedLaneId)
			keepOnlySelection("fx");
	});
	$effect(() => {
		if (mediaState.selectedClipId) keepOnlySelection("media");
	});
	$effect(() => {
		if (textState.selectedClipId) keepOnlySelection("text");
	});
	$effect(() => {
		if (selectedAudioClipId) keepOnlySelection("audio");
	});

	/** Select what the preview was clicked on; clicking past every layer lands on the base. */
	function pickLayer(pick: LayerPick | null) {
		if (pick?.kind === "media") {
			const lane = mediaState.timeline.lanes.find((l) => l.id === pick.laneId);
			const clip = lane ? clipAt(lane, clock.time) : null;
			if (!clip) return;
			mediaState.selectedClipId = clip.id;
			mediaState.selectedClipIds = [clip.id];
			return;
		}
		if (pick?.kind === "text") {
			const lane = textState.timeline.lanes.find((l) => l.id === pick.laneId);
			const clip = lane ? clipAt(lane, clock.time) : null;
			if (clip) textState.selectedClipId = clip.id;
			return;
		}
		mediaState.selectedClipId = null;
		mediaState.selectedClipIds = [];
		textState.selectedClipId = null;
	}

	// Fill, mosh, clear and static/auto on a text clip: the same gestures a media clip takes.
	const previewTextChains = createTextChainSource(getMoshOptions);

	/** Deleting a clip retires its id, so drop the stack. */
	function retainLaneMoshes() {
		textState.retainMoshes();
		mediaState.retainMoshes();
	}

	// Fill, mosh, clear and static/auto on a media clip: the same gestures an fx clip takes.
	const isModelSource = (id: string) =>
		sourceRegistry.get(id)?.kind === "model";
	const isSlideshowSource = (id: string) =>
		sourceRegistry.get(id)?.kind === "cuts";
	const previewMediaChains = createMediaChainSource(getMoshOptions, {
		isModel: isModelSource,
		cutList: (id) => sourceRegistry.get(id)?.cutList,
	});

	/** What the selected layer clip draws, and plays. */
	let selectedMediaSourceId = $derived(
		mediaState.selectedLane && mediaState.selectedClip
			? clipSourceId(mediaState.selectedLane, mediaState.selectedClip)
			: null,
	);

	/** The source the selected layer clips draw; null when they disagree. */
	let mediaSelectedSourceId = $derived.by(() => {
		if (mediaState.selectedClipIds.length === 0) return null;
		const picked = new Set(mediaState.selectedClipIds);
		const drawn: (string | null)[] = [];
		for (const lane of mediaState.timeline.lanes) {
			for (const clip of lane.clips) {
				if (picked.has(clip.id)) drawn.push(clipSourceId(lane, clip));
			}
		}
		if (drawn.length === 0) return null;
		return drawn.every((id) => id && id === drawn[0]) ? drawn[0] : null;
	});

	/** A pasted image stays lit in the rail until the clip selection moves. */
	let pastedSourceId = $state<string | null>(null);
	$effect(() => {
		void mediaState.selectedClipIds;
		pastedSourceId = null;
	});

	/** The thumb the rail lights up; falls back to the lane behind the primary clip. */
	let railSourceId = $derived(
		(pastedSourceId && sourceRegistry.get(pastedSourceId)
			? pastedSourceId
			: null) ??
			mediaSelectedSourceId ??
			mediaState.selectedLane?.sourceId ??
			null,
	);

	/** How many clips a rail click assigns to. */
	let railTargetCount = $derived(mediaState.selectedClipIds.length);

	/** Point the selected layer clips at this source, fanned out over the selection. */
	function assignMediaClipSource(sourceId: string) {
		if (mediaState.selectedClipIds.length === 0) return;
		mediaState.pushHistory();
		mediaState.set(
			autoOnSlideshows(
				setMediaClipSources(
					mediaState.timeline,
					mediaState.selectedClipIds,
					sourceId,
				),
				mediaState.selectedClipIds,
				isSlideshowSource,
			),
		);
	}

	/** Deal the pool across the selected layer clips, or every layer clip. */
	function dealMediaSources() {
		const pool = poolSources.map((s) => s.id);
		if (pool.length < 2) return;
		const ids =
			mediaState.selectedClipIds.length > 0
				? mediaState.selectedClipIds
				: mediaState.timeline.lanes.flatMap((l) => l.clips.map((c) => c.id));
		if (ids.length === 0) return;
		mediaState.pushHistory();
		mediaState.set(
			autoOnSlideshows(
				dealMediaClipSources(mediaState.timeline, new Set(ids), pool),
				ids,
				isSlideshowSource,
			),
		);
	}

	function toggleTextTimeline() {
		textState.pushHistory();
		textState.timeline = toggledTextTimeline(
			textState.timeline,
			layerStack.topZ(),
		);
		if (!textState.timeline.enabled) {
			textState.selectedClipId = null;
			lyricsOpen = false;
		}
	}

	/** Transport for the lyrics-sync modal, on whichever clock owns the master timeline. */
	let lyricsSync = $derived<LyricsSyncProps | null>(
		textState.timeline.enabled
			? { ...clock.transport(), onApply: applyLyrics }
			: null,
	);

	/** Drop the synced lines into the lyrics lane and select the first one. */
	function applyLyrics(clips: TextClip[]) {
		if (clips.length === 0) return;
		textState.pushHistory();
		textState.timeline = applyLyricsToTimeline(
			textState.timeline,
			clips,
			layerStack.topZ(),
		);
		textState.selectedClipId = clips[0].id;
	}
	let effectiveDuration = $derived(clock.exportDuration);
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
		singleVideo.player?.pause();
		if (isVideo && singleVideo.el) singleVideo.el.pause();
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
					videoHasAudio: singleVideo.hasAudio,
					videoEl: singleVideo.el,
					videoDuration: singleVideo.duration,
					videoSpanStart: singleVideo.spanStart,
					videoSpanEnd: singleVideo.spanEnd,
					videoSpeed: singleVideo.speed,
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
					textTimeline: textState.timeline.enabled
						? ($state.snapshot(textState.timeline) as TextTimeline)
						: null,
					mediaTimeline: mediaState.timeline.enabled
						? ($state.snapshot(mediaState.timeline) as MediaTimeline)
						: null,
					moshOptions: getMoshOptions(),
					layerSources: sourceRegistry.sources,
					sourceEdits: $state.snapshot(sourceRegistry.edits) as Record<
						string,
						SourceEdit
					>,
					textTimeOffset: clock.exportOffset,
					textTimeScale: clock.exportScale,
					bpm: tempo.bpm,
					beatOffset: tempo.beatOffset,
					sequence: isSequenceMode
						? {
								moshOptions: getMoshOptions(),
								duration: clock.duration,
								masterIsAudio: true,
								fxLanes: $state.snapshot(fxState.lanes) as FxLane[],
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
					onNotice: (message) => showToast(message, "info", 8000),
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
	async function pasteFiles(e: ClipboardEvent) {
		const files = pastedFiles(e);
		if (files.length === 0) return;
		await handleDroppedFiles(files);
		// By id rather than what was added, so a repeat lights up the copy already pooled.
		const id = stableSourceId(files[0]);
		if (sourceRegistry.get(id)) pastedSourceId = id;
	}

	function handleDroppedFiles(files: FileList | File[]) {
		const all = Array.from(files, withMediaType);
		const audioFiles = all.filter((f) => f.type.startsWith("audio/"));
		if (audioFiles.length > 0) songs.addFiles(audioFiles);
		if (!isSequenceMode && all.some(isMeshFile)) {
			showToast("3D models work in the Editor", "error");
		}
		const media = all.filter(
			(f) =>
				f.type.startsWith("image/") ||
				f.type.startsWith("video/") ||
				(isSequenceMode && (isMeshFile(f) || isOtherModelFile(f))),
		);
		if (media.length === 0) return;
		if (isSequenceMode) return addSequenceSources(media);
		onfile(media[0]);
	}
</script>

<svelte:window
	onkeydown={handleKeydown}
	onpaste={(e) => void pasteFiles(e)}
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
		onTrackRenamed={(id, name) => {
			if (audioTrackNames[id])
				audioTrackNames = { ...audioTrackNames, [id]: name };
		}}
		onUnloadTrack={clearTrack}
		onTrackDeleted={isSequenceMode ? projectSongs.dropDeleted : undefined}
		onPlay={isSequenceMode ? clock.playSpan : () => audio.playAudio()}
		onPause={isSequenceMode ? clock.pause : () => audio.pauseAudio()}
		mainPlaying={clock.soundPlaying}
		pendingTrack={audio.trackFile}
		onNormalizeChange={(gain) => audio.setNormalizeGain(gain)}
		onAutoAdded={adoptLibraryTrack}
		projectMode={keys.mode}
		activeProjectKey={keys.ownKey}
		tracksDraggable={isSequenceMode}
		songOnLanes={isSequenceMode}
		openKey={keys.openKey}
		onOpenProject={onOpenProject ? openOtherProject : undefined}
	/>
	<div
		class="main-area"
		bind:this={timelineSplit.mainAreaEl}
		style="--tl-vscroll: {timelineSplit.laneScrollbar}px"
	>
		<TopBar onExit={onExit ? handleExit : undefined}>
			{#snippet status()}
				<SaveIndicator
					state={saves.state}
					lastSavedAt={saves.lastSavedAt}
					notSaved={sessionSave.notSaved}
				>
					{#snippet action()}
						<button
							class="save-file-btn"
							title="Save the project as a file you can keep or share ({modKey}+Shift+S)"
							aria-label="Save project file"
							onclick={saveProjectFile}
						>
							<FolderDown size={14} />
						</button>
					{/snippet}
				</SaveIndicator>
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
					count={poolSources.length}
					shuffleScope={mediaState.selectedClipIds.length}
					shuffleTitle={mediaState.selectedClipIds.length > 0
						? "Deal the pool at random across the selected media clips"
						: "Deal the pool at random across every media clip"}
					recordTitle="Record a webcam take to the song, from the playhead"
					onShuffle={dealMediaSources}
					onAdd={() => sourceInput?.click()}
					onGenerate={() => (generateOpen = true)}
					onRecord={() => (webcamOpen = true)}
					onProjects={isSequenceMode
						? () => (projectPickerOpen = true)
						: undefined}
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
					{@render formatPicker()}
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
					This project has no media. Add an image, a video or a 3D model and the
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
				bind:this={singleVideo.el}
				src={imageSrc}
				muted
				autoplay={!singleVideo.player}
				playsinline
				onloadedmetadata={singleVideo.onLoadedMetadata}
				ontimeupdate={singleVideo.onTimeUpdate}
				onended={singleVideo.onEnded}
				onerror={() => (singleVideo.unplayable.element = true)}
				onplay={() => (singleVideo.elementPlaying = true)}
				onpause={() => (singleVideo.elementPlaying = false)}
				onseeking={() => {
					audio.audioContext?.resume();
				}}
				style="display:none"
			></video>
		{/if}

		{#if sequenceGridOpen}
			<SequenceGridView
				sources={poolSources}
				onProjects={() => (projectPickerOpen = true)}
				selectedCount={mediaState.selectedClipIds.length}
				selectedSourceId={railSourceId}
				pendingCount={sourceRegistry.loadingTotal - sourceRegistry.loadingDone}
				onAddFiles={(files) => void addSequenceSources(files)}
				onGenerate={() => (generateOpen = true)}
				onRecord={() => (webcamOpen = true)}
				onRemove={removeSequenceSource}
				onReorder={(from, to) => sourceRegistry.reorder(from, to)}
				onAssign={assignMediaClipSource}
				onProxyAction={sourceProxyAction}
			/>
		{/if}
		<!-- Hidden, never unmounted: tearing the canvas down would take the renderer with it. -->
		<div
			class="preview-slot"
			class:hidden={sequenceGridOpen}
			bind:this={timelineSplit.previewSlotEl}
		>
			{#if !isSequenceMode && isVideo && singleProxy.status.kind !== "none"}
				<!-- Single mode has no source chip, so this says what would otherwise be silent. -->
				<button
					class="preview-proxy"
					class:ok={singleProxy.status.kind === "ready"}
					class:warn={singleProxy.status.kind === "failed"}
					class:off={singleProxy.status.kind === "off"}
					title={`${singleProxy.status.title} ${singleProxy.status.action.hint}`}
					onclick={() => {
						const status = singleProxy.status;
						if (status.kind === "none") return;
						const action = status.action.kind;
						if (action === "retry") singleProxy.retry();
						else singleProxy.setEnabled(action === "enable");
					}}
				>
					{#if singleProxy.status.kind === "ready"}
						<Zap size={9} fill="currentColor" />
					{:else if singleProxy.status.kind === "off"}
						<ZapOff size={9} />
					{:else if singleProxy.status.kind === "failed"}
						<TriangleAlert size={9} />
					{/if}
					{singleProxy.status.kind === "failed" ? "" : singleProxy.status.badge}
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
					: isVideo && !singleVideo.player
						? singleVideo.el
						: null}
				frameSource={singleVideo.player}
				sourceKey={String(sourceTick)}
				freezeAnimation={isImageFormat}
				suspended={recordingState.recording ||
					noSequenceMedia ||
					sequenceGridOpen ||
					sourceEditOpen}
				{warmCanvas}
				{warmRenderer}
				textTimeline={textState.timeline.enabled ? textState.timeline : null}
				mediaTimeline={mediaState.timeline.enabled ? mediaState.timeline : null}
				selectedMediaLane={mediaState.timeline.enabled
					? mediaState.selectedLane
					: null}
				selectedTextClipId={textState.timeline.enabled
					? textState.selectedClipId
					: null}
				soloMediaLaneId={mediaState.timeline.enabled ? soloLaneId : null}
				mediaDriver={(layers) => mediaLayers.advance(layers)}
				mediaChains={previewMediaChains}
				textChains={previewTextChains}
				baseSize={isSequenceMode ? seqBaseSize : null}
				textTime={previewTime}
				bpm={tempo.bpm}
				beatOffset={tempo.beatOffset}
				forceAnimation={isLive ||
					((textState.timeline.enabled || mediaState.timeline.enabled) &&
						clock.running)}
				overlay={mediaLoading
					? loadingOverlay
					: noSequenceMedia
						? noMediaOverlay
						: undefined}
				spectrum={clock.frequencyData}
				spectrumSampleRate={clock.spectrumSampleRate}
				{sourceFit}
				sourceEdits={sourceRegistry.edits}
				{sourceDurations}
				onPickLayer={pickLayer}
				onDropSource={isSequenceMode ? dropSourceOnCanvas : null}
				onLayerDragStart={() => mediaState.pushHistory()}
				onTextDragStart={() => textState.pushHistory()}
				onTextMove={(clipId, x, y) => {
					const clip = findTextClip(textState.timeline, clipId);
					if (clip)
						textState.timeline = replaceTextClip(textState.timeline, {
							...clip,
							x,
							y,
						});
				}}
				onTextResize={(clipId, size) => {
					const lane = findTextClipLane(textState.timeline, clipId);
					if (lane)
						textState.updateLane({ ...lane, style: { ...lane.style, size } });
				}}
				onLayerStyleChange={(id, style) =>
					(mediaState.timeline = updateMediaLaneIn(
						mediaState.timeline,
						id,
						(l) => ({
							...l,
							style,
						}),
					))}
			/>
		</div>

		<div class="action-bar">
			<!-- The pool lives in a sheet on a phone; this is the way into it. -->
			<div class="bar-cluster library-cluster">
				<button
					class="bar-icon"
					onclick={() => trackLibraryRef?.openLibrary()}
					title={isSequenceMode ? "Projects and songs" : "Track library"}
					aria-label={isSequenceMode ? "Projects and songs" : "Track library"}
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
							class:on={textState.timeline.enabled}
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
				hideActions={isSequenceMode && clock.duration > 0}
				bind:showSettings={showMoshSettings}
			>
				{#snippet settingsContent()}
					{@render formatPicker()}
					<OutputSettings
						editor={isSequenceMode}
						bind:showFps
						bind:projectSong
						bind:sourceFit
						bind:resizeWidth
						bind:resizeHeight
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
				<button
					class="bar-key live"
					onclick={clock.toggle}
					disabled={mediaBusy && !clock.running}
					title={mediaBusy
						? "Media is still loading"
						: clock.running
							? "Stop (Space)"
							: "Play (Space)"}
				>
					{#if clock.running}
						<Pause size={14} fill="currentColor" stroke="none" />
						<span class="key-label">STOP</span>
					{:else}
						<Play size={14} fill="currentColor" stroke="none" />
						<span class="key-label">PLAY</span>
					{/if}
				</button>
			{/if}
			{#if isImageFormat}
				<button
					class="bar-key live"
					onclick={save}
					title="Save this frame as an image ({modKey}+S)"
				>
					<Download size={14} />
					<span class="key-label">SAVE</span>
				</button>
			{/if}

			{#if isVideoFormat}
				<RecordGroup
					bind:this={recordGroupRef}
					recording={recordingState.recording}
					bind:showSettings={showRecordSettings}
				>
					{#snippet settingsContent()}
						<RecordSettings
							durationEditable={!isSequenceMode && !audio.trackFile && !isVideo}
							bind:duration={recordDuration}
							{effectiveDuration}
							bind:fps={recordFps}
							onStart={startRecording}
						/>
					{/snippet}
				</RecordGroup>
			{/if}
		</div>
		{#if showSourceRail}
			<!-- The pool, on hand while the preview is up. -->
			<SourceRail
				sources={poolSources}
				selectedCount={railTargetCount}
				selectedSourceId={railSourceId}
				onAssign={assignMediaClipSource}
				onAdd={() => sourceInput?.click()}
				onRemove={removeSequenceSource}
				onReorder={(from, to) => sourceRegistry.reorder(from, to)}
				edits={sourceRegistry.edits}
				onEditChange={editSource}
				onEditingChange={(open) => onSourceEditingChange("rail", open)}
				onProxyAction={sourceProxyAction}
			/>
		{/if}
		{#if showVideoBar && !videoIsMaster}
			<!-- A second clock: the video runs its own span while the track drives the timeline. -->
			<AudioTimeline
				label="VID"
				trackDuration={singleVideo.duration}
				trackCurrentTime={singleVideo.clock}
				spanStart={singleVideo.spanStart}
				spanEnd={singleVideo.spanEnd}
				isPlaying={singleVideo.isPlaying}
				loopEnabled={videoLoop}
				onToggleLoop={() => (videoLoop = !videoLoop)}
				onPlay={singleVideo.play}
				onPause={singleVideo.pause}
				onSeek={singleVideo.seekTo}
				onSpanStartChange={(t) => (singleVideo.spanStart = t)}
				onSpanEndChange={(t) => (singleVideo.spanEnd = t)}
				speed={singleVideo.speed}
				onSpeedChange={(s) => (singleVideo.speed = s)}
				ariaLabel="Video timeline"
				outputVolume={audio.outputVolume}
				onVolumeChange={singleVideo.hasAudio &&
				audio.analyserNode &&
				!audio.trackFile
					? (v) => audio.setOutputVolume(v)
					: undefined}
			/>
		{/if}
		{#if showStack}
			<!-- The split between the output and the lanes; its hit area is taller than the grip. -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="tl-split" class:held={timelineSplit.dragging}>
				<span
					class="tl-split-grip"
					role="separator"
					aria-orientation="horizontal"
					aria-label="Resize the timeline"
					title="Drag to resize the timeline · double-click to reset"
					tabindex="0"
					onpointerdown={timelineSplit.beginDrag}
					ondblclick={timelineSplit.reset}
					onkeydown={timelineSplit.onKeydown}
				></span>
			</div>
			<TimelineStack
				height={timelineSplit.height}
				bind:axis={timelineAxis}
				wheelScrollsLanes={isSequenceMode}
				trackDuration={clock.length}
				currentTime={clock.time}
				isPlaying={clock.running}
				onTogglePlay={clock.toggle}
				playDisabled={mediaBusy}
				onSeek={clock.seek}
				spanStart={clock.exportOffset}
				bpm={isSequenceMode ? tempo.bpm : 0}
				beatOffset={tempo.beatOffset}
				selectionHint={isSequenceMode
					? "Click a media clip or an FX clip to edit it"
					: null}
				loopEnabled={clock.looping}
				onToggleLoop={isSequenceMode || audioIsMaster || videoIsMaster
					? clock.toggleLoop
					: null}
				{repeatRange}
				onStopRepeat={stopRepeat}
				onRepeatRangeChange={(range) => (repeatSpan = range)}
				{repeatClipIds}
				onToggleRepeat={toggleRepeat}
				onGrow={isSequenceMode ? growProjectTo : null}
				onGrowFront={isSequenceMode ? growProjectFront : null}
				maxLength={MAX_PROJECT_LENGTH}
			>
				{#snippet toolbar()}
					<LaneToolbar
						text={textState.timeline.enabled
							? { lyrics: !!lyricsSync, lyricsOpen }
							: null}
						onAddTextLane={addTextLane}
						onOpenLyrics={() => (lyricsOpen = true)}
						mediaLaneCount={mediaState.timeline.enabled
							? mediaState.timeline.lanes.length
							: null}
						onAddMediaLane={addMediaLane}
						project={isSequenceMode && clock.duration > 0
							? {
									audioLaneCount: mediaState.timeline.audioLanes?.length ?? 0,
									fxLaneCount: fxState.lanes.length,
									length: mixer.duration,
									maxLength: MAX_PROJECT_LENGTH,
									canFit: timelineContentEnd() > 0,
								}
							: null}
						onAddAudioFile={openTrackPicker}
						onAddAudioLane={addEmptyAudioLane}
						onAddFxLane={fxState.add}
						onLengthChange={setProjectLength}
						onFit={fitProjectToClips}
						laneCount={laneIds.length}
						allFolded={allLanesFolded}
						onToggleFolds={() => laneFolds.toggleAll(laneIds)}
						videoSpeed={videoIsMaster ? singleVideo.speed : null}
						onSpeedChange={(s) => (singleVideo.speed = s)}
					/>
				{/snippet}
				<!-- Read bottom to top: the transports at the foot are the inputs. -->
				<div class="tl-layers" bind:this={timelineSplit.laneListEl}>
					{#if mediaState.timeline.enabled}
						<MediaTimelineLane
							timeline={mediaState.timeline}
							foldedLaneIds={laneFolds.ids}
							onToggleFold={laneFolds.toggle}
							layerOrder={layerStack.order}
							{draggingLaneId}
							onLaneDragStart={startLayerDrag}
							sources={sequenceSources}
							edits={sourceRegistry.edits}
							bind:selectedClipId={mediaState.selectedClipId}
							bind:selectedClipIds={mediaState.selectedClipIds}
							{soloLaneId}
							onToggleSolo={toggleMediaSolo}
							isSilent={(id) => audioBank.isSilent(id)}
							onCopyLane={mediaState.timeline.lanes.length < MAX_MEDIA_LANES
								? copyMediaLane
								: undefined}
							onChange={mediaState.set}
							onBeforeEdit={mediaState.pushHistory}
							bpm={tempo.bpm}
							onApplyPreset={mediaState.applyPreset}
							onRoll={mediaState.moshes.roll}
							onClear={mediaState.clear}
							onModeChange={mediaState.modeChange}
							plan={isSequenceMode ? mixPlan : undefined}
							{peaksOf}
							audioVersion={audioBank.version}
						/>
					{/if}
					{#if textState.timeline.enabled}
						<TextTimelineLane
							timeline={textState.timeline}
							foldedLaneIds={laneFolds.ids}
							onToggleFold={laneFolds.toggle}
							layerOrder={layerStack.order}
							{draggingLaneId}
							onLaneDragStart={startLayerDrag}
							bind:selectedClipId={textState.selectedClipId}
							bind:selectedClipIds={textState.selectedClipIds}
							onChange={textState.set}
							onBeforeEdit={textState.pushHistory}
							bpm={tempo.bpm}
							onApplyPreset={textState.applyPreset}
							onRoll={textState.moshes.roll}
							onClear={textState.clear}
							onModeChange={textState.modeChange}
							{lyricsSync}
							bind:lyricsOpen
						/>
					{/if}
					{#if isSequenceMode && fxState.lanes.length > 0}
						<FxLanes
							lanes={fxState.lanes}
							foldedLaneIds={laneFolds.ids}
							onToggleFold={laneFolds.toggle}
							layerOrder={layerStack.order}
							{draggingLaneId}
							onLaneDragStart={startLayerDrag}
							bind:selectedClipId={fxState.selectedClipId}
							bind:selectedClipIds={fxState.selectedClipIds}
							onChange={fxState.set}
							onBeforeEdit={fxState.pushHistory}
							bpm={tempo.bpm}
							bind:selectedLaneId={fxState.selectedLaneId}
							onModeChange={fxState.modeChange}
							onRoll={fxState.moshes.roll}
							onClear={fxState.clear}
						/>
					{/if}
					{#if isSequenceMode && (mediaState.timeline.audioLanes?.length ?? 0) > 0}
						<AudioLanes
							lanes={mediaState.timeline.audioLanes ?? []}
							bind:selectedClipId={selectedAudioClipId}
							bind:selectedClipIds={selectedAudioClipIds}
							onChange={(audioLanes) =>
								mediaState.set({ ...mediaState.timeline, audioLanes })}
							onBeforeEdit={mediaState.pushHistory}
							plan={mixPlan}
							{peaksOf}
							version={audioBank.version}
							sourceName={audioSourceName}
							bpmSourceId={tempo.poolSource ?? songSourceId}
							onSetBpmSource={projectSongs.setBpmSource}
							repeatsOf={audioClipRepeats}
							edits={sourceRegistry.edits}
							{videoLengths}
							sourceEndsOf={audioSourceEnds}
							orderBase={layerStack.order.length}
							foldedLaneIds={laneFolds.ids}
							onToggleFold={laneFolds.toggle}
							trackLength={decodedLength}
							onDropTrack={dropTrack}
							onRecord={toggleMicTake}
							recording={micRecorder.take && {
								...micRecorder.take,
								end: mixer.currentTime,
							}}
							armingLaneId={micRecorder.arming}
						/>
					{/if}
				</div>
				{#if videoIsMaster}
					<AudioTimeline
						layout="lane"
						label="VID"
						trackDuration={singleVideo.duration}
						trackCurrentTime={singleVideo.clock}
						spanStart={singleVideo.spanStart}
						spanEnd={singleVideo.spanEnd}
						isPlaying={singleVideo.isPlaying}
						onPlay={singleVideo.play}
						onPause={singleVideo.pause}
						onSeek={singleVideo.seekTo}
						onSpanStartChange={(t) => (singleVideo.spanStart = t)}
						onSpanEndChange={(t) => (singleVideo.spanEnd = t)}
						ariaLabel="Video timeline"
						outputVolume={audio.outputVolume}
						onVolumeChange={singleVideo.hasAudio &&
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
						onPlay={clock.playSpan}
						onPause={clock.pause}
						onSeek={clock.seekSong}
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
						onPlay={clock.playSpan}
						onPause={clock.pause}
						onSeek={clock.seekSong}
						onSpanCommit={spanHistory.push}
						onSpanStartChange={(t) => (audio.spanStart = t)}
						onSpanEndChange={(t) => (audio.spanEnd = t)}
						onVolumeChange={(v) => audio.setOutputVolume(v)}
					/>
				{/if}
			</TimelineStack>
		{/if}
		{#if isSequenceMode ? !audio.trackFile && !mediaState.timeline.audioLanes?.length : !audio.trackFile}
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
			accept="image/*,video/*,{MESH_ACCEPT}"
			multiple
			hidden
			onchange={(e) => {
				const picked = Array.from(e.currentTarget.files ?? []);
				if (picked.length > 0) void addLayerSources(picked);
				e.currentTarget.value = "";
			}}
		/>
	</div>
	{#snippet formatPicker()}
		<ButtonGroup
			buttons={[
				{ label: "PNG", value: "png" },
				{ label: "JPG", value: "jpg" },
				{ label: videoFormatLabel, value: "webm" },
			]}
			value={format}
			onchange={(v) => (format = v)}
		/>
	{/snippet}
	{#snippet moshSettings()}
		<div class="mosh-settings-wrapper">
			<MoshSettingsPanel
				bind:moshMin={
					() => settingsPanel.get("moshMin"),
					(v) => settingsPanel.set("moshMin", v)
				}
				bind:moshMax={
					() => settingsPanel.get("moshMax"),
					(v) => settingsPanel.set("moshMax", v)
				}
				bind:moshStyle={
					() => settingsPanel.get("moshStyle"),
					(v) => settingsPanel.set("moshStyle", v)
				}
				bind:randomizeOrder={
					() => settingsPanel.get("randomizeOrder"),
					(v) => settingsPanel.set("randomizeOrder", v)
				}
				bind:moshAudioLink={
					() => settingsPanel.get("moshAudioLink"),
					(v) => settingsPanel.set("moshAudioLink", v)
				}
				bind:moshAudioLinkStrength={
					() => settingsPanel.get("moshAudioLinkStrength"),
					(v) => settingsPanel.set("moshAudioLinkStrength", v)
				}
				bind:moshLinkBand={
					() => settingsPanel.get("moshLinkBand"),
					(v) => settingsPanel.set("moshLinkBand", v)
				}
				bind:audioSmoothing={
					() => settingsPanel.response("smoothing"),
					(v) => settingsPanel.setResponse("smoothing", v)
				}
				bind:audioPunch={
					() => settingsPanel.response("punch"),
					(v) => settingsPanel.setResponse("punch", v)
				}
				targetLabel={settingsPanel.lanes.length > 1
					? `${settingsPanel.lanes.length} lanes`
					: (settingsPanel.lane?.name ?? null)}
				targetCount={settingsPanel.lanes.length}
				targetOwnsSettings={settingsPanel.lanes.some((l) => !!l.settings)}
				onFollowEditor={settingsPanel.followEditor}
				labelEditorScope={isSequenceMode}
				{hasAudio}
				showTiming={isSequenceMode || !!audio.trackFile}
				bpm={tempo.bpm}
				bpmDetecting={tempo.detection.detecting}
				hasTrack={!!audio.trackFile}
				onDetectBpm={tempo.detection.run}
				onBpmChange={tempo.setByHand}
			/>
		</div>
	{/snippet}

	<!-- Passed only while a clip is selected. -->
	{#snippet layerPanel(section: "clip" | "chain")}
		{#if mediaState.selectedClip}
			<MediaClipPanel
				lane={mediaState.selectedLane}
				clip={mediaState.selectedClip}
				sources={poolSources}
				onLaneChange={mediaState.updateLane}
				onClipChange={mediaState.updateClip}
				onBeforeEdit={mediaState.beforeClipEdit}
				onClose={() => (mediaState.selectedClipId = null)}
				hasTrack={linksHaveAudio}
				beatSync={tempo.bpm > 0}
				spectrumData={liveSpectrum}
				response={mediaState.selectedLane
					? laneAudioResponse(mediaState.selectedLane, audioResponse)
					: audioResponse}
				edits={sourceRegistry.edits}
				onEditChange={editSource}
				onEditingChange={(open) => onSourceEditingChange("clip", open)}
				{section}
				chainNote={mediaState.chainNote}
				selectionNote={mediaState.selectionNote}
				onAllBands={mediaState.setClipsBand}
				sourceHasAudio={!selectedMediaSourceId ||
					!audioBank.isSilent(selectedMediaSourceId)}
				onDetachAudio={isSequenceMode && mediaState.selectedClip
					? () => detachClipsAudio(mediaState.selectedClipIds)
					: undefined}
				onAttachAudio={isSequenceMode && mediaState.selectedClip
					? () => reattachClipsAudio(mediaState.selectedClipIds)
					: undefined}
				onRefreshSlideshow={(id) => void refreshSlideshow(id)}
				onRefreshSingle={(key) => void refreshSingleEdit(key)}
			/>
		{:else if textState.selectedClip}
			<TextClipPanel
				lane={textState.selectedLane}
				clip={textState.selectedClip}
				onLaneChange={textState.updateLane}
				onClipChange={textState.updateClip}
				onBeforeEdit={textState.beforeClipEdit}
				onClose={() => (textState.selectedClipId = null)}
				hasTrack={linksHaveAudio}
				beatSync={tempo.bpm > 0}
				spectrumData={liveSpectrum}
				response={audioResponse}
				{section}
				chainNote={textState.chainNote}
				selectionNote={textState.selectionNote}
				onAllBands={textState.setClipsBand}
				bpm={tempo.bpm}
			/>
		{/if}
	{/snippet}

	<MobileSheet
		topPanel={mediaState.selectedClip || textState.selectedClip
			? layerPanel
			: undefined}
		settingsLabel="Mosh"
		topPanelLabel={mediaState.selectedClip ? "Media clip" : "Text clip"}
	>
		{#snippet settings()}
			{@render moshSettings()}
		{/snippet}
		{#snippet effectsPanel()}
			<!-- A selected layer is edited by the top panel instead; the main chain would be a second list. -->
			{#if !mediaState.selectedClip && !textState.selectedClip}
				<EffectsPanel
					headless
					note={panelNote}
					bind:effects={getPanelEffects, setPanelEffects}
					noTarget={panelNoTarget}
					hasTrack={linksHaveAudio}
					beatSync={tempo.bpm > 0}
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
						const target = fxState.selectedClip;
						if (target) {
							if (target.mode !== "interval") target.label = preset.name;
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
					onAllBands={setFxClipsBand}
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
					? "Drop images, videos or 3D models into the pool · Drop audio onto a lane"
					: "Drop image/video to replace · Drop audio to set track"}</span
			>
		</div>
	{/if}

	{#if projectPickerOpen}
		{#await loadProjectPicker() then ProjectPicker}
			<ProjectPicker
				{projectSong}
				onRememberSong={(choice) => (projectSong = choice)}
				onPick={(mode, key, name, includeSong) =>
					mode === "single"
						? addSingleEdit(key, name, includeSong)
						: addSlideshow(key, name, includeSong)}
				onClose={() => (projectPickerOpen = false)}
			/>
		{:catch}
			<LoadFailed onclose={() => (projectPickerOpen = false)} />
		{/await}
	{/if}

	{#if webcamOpen}
		{#await loadWebcamPanel() then WebcamPanel}
			<WebcamPanel
				mode="record"
				onTransport={takeTransport}
				onTake={(file) => void useTake(file)}
				onClose={() => (webcamOpen = false)}
			/>
		{:catch}
			<LoadFailed onclose={() => (webcamOpen = false)} />
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
		{:catch}
			<LoadFailed onclose={() => (generateOpen = false)} />
		{/await}
	{/if}

	{#if showShortcuts}
		{#await loadShortcutsModal() then ShortcutsModal}
			<ShortcutsModal
				groups={shortcutGroups}
				onClose={() => (showShortcuts = false)}
			/>
		{:catch}
			<LoadFailed onclose={() => (showShortcuts = false)} />
		{/await}
	{/if}

	{#if modelProblems.length > 0}
		{#await loadUnsupportedModelDialog() then UnsupportedModelDialog}
			<UnsupportedModelDialog
				problems={modelProblems}
				onClose={() => (modelProblems = [])}
			/>
		{:catch}
			<LoadFailed onclose={() => (modelProblems = [])} />
		{/await}
	{/if}
	{#if showClearSourcesConfirm}
		<ConfirmDialog
			title="Clear all sources?"
			message="Removes every source from this project. Its media clips show nothing until you add media back. Media other projects still use is kept."
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

	/* As quiet as the save word beside it, until pointed at. */
	.save-file-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		flex-shrink: 0;
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--r-1);
		background: none;
		color: var(--text-2);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
	}

	.save-file-btn:hover {
		color: var(--text);
		border-color: var(--line-strong);
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

	.editor.drag-over::before {
		content: "";
		position: absolute;
		inset: 0;
		z-index: 99;
		border: 2px dashed var(--line-strong);
		border-radius: var(--r-3);
		pointer-events: none;
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
