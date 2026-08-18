<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		Download,
		HelpCircle,
		Home,
		Library,
		Maximize,
		MicVocal,
		Pause,
		Play,
		Plus,
		Type,
	} from 'lucide-svelte';
	import { fileDrop } from '../../actions/file-drop';
	import { createAudioGraph, createOutputAudioGraph } from '../../audio/audio-controller';
	import { AudioManager } from '../../audio/audio-manager.svelte';
	import type { AudioResponse } from '../../audio/auto-range';
	import { createTrackStore } from '../../audio/track-persistence';
	import { createKeyboardHandler } from '../../editor/keyboard';
	import { clearEffects as clearEffectsFn } from '../../editor/mosh';
	import { executeRecording } from '../../editor/recording';
	import { createRecordingState } from '../../editor/recording-state.svelte';
	import { createMoshSession } from '../../editor/mosh-session';
	import { PanelBurstController } from '../../editor/panel-burst';
	import {
		DEFAULT_SETTINGS,
		loadSettings,
		updateSettings,
	} from '../../editor/settings';
	import {
		cloneEffectInstance,
		getDefinition,
		loadInitialEffects,
		setVolumeLink,
		type EffectInstance,
		type FreqBand,
		type Preset,
	} from '../../effects';
	import {
		appendTextLane,
		createTextHistory,
		createTextTimeline,
		EMPTY_TEXT_TIMELINE,
		normalizeTextTimeline,
		applyLyricsToTimeline,
		TEXT_TIMELINE_SHORTCUTS,
		updateLane,
		type TextClip,
		type TextLane,
		type TextTimeline,
	} from '../../text';
	import {
		cloneSegmentForSplit,
		createSequenceEffectSource,
		createSequenceSegment,
		resolveTransitionAt,
		findSegmentAt,
		normalizeSegmentTransitions,
		type ResolvedTransition,
		type SegmentTransitionChange,
		type SequenceSegment,
		type SequenceSegmentMode,
		applyBpmToSegments,
	} from '../../editor/sequence';
	import {
		appendFxLane,
		applyBpmToFxLanes,
		clearFxClips,
		createFxLayerSource,
		findFxClip,
		flattenFxLayers,
		fxClipMoshSnapshot,
		MAX_FX_LANES,
		restoreFxClipMosh,
		normalizeFxLanes,
		rollFxClips,
		setFxClipsMode,
		type FxClip,
		type FxLane,
	} from '../../editor/fx-lanes';
	import { createSnapshotHistory } from '../../timeline/snapshot-history.svelte';
	import { detectBpm } from '../../slideshow/bpm-detector';
	import { SequenceFrameDriver } from '../../editor/sequence-frames';
	import { SequenceSourceRegistry } from '../../editor/sequence-sources.svelte';
	import {
		loadMediaPool,
		pruneSequenceMedia,
		saveMediaPool,
	} from '../../editor/sequence-media-store';
	import {
		saveSession,
		type SingleSessionState,
	} from '../../editor/sessions';
	import {
		applyTransitionChanges,
		clearSegments,
		fillSegmentsFromPreset,
		randomizeSegmentSources,
		restoreSegmentMosh,
		rollSegments,
		setSegmentsMode,
		syncSegmentsToPreset,
	} from '../../editor/segment-edits';
	import { SegmentBoundaryController } from '../../editor/segment-boundary-controller.svelte';
	import { normalizeCoverage } from '../../editor/segment-coverage';
	import {
		SegmentMoshHistory,
		type SegmentMoshSnapshot,
	} from '../../editor/segment-mosh-history';
	import type { GlRenderer, SourceFit } from '../../gl/renderer';
	import { VideoPreviewPlayer } from '../../video-preview/preview-player.svelte';
	import AudioTimeline from '../ui/AudioTimeline.svelte';
	import SpeedControl from '../ui/SpeedControl.svelte';
	import TimelineStack from '../ui/TimelineStack.svelte';
	import EffectsPanel from '../ui/EffectsPanel.svelte';
	import GithubLink from '../ui/GithubLink.svelte';
	import ButtonGroup from '../ui/ButtonGroup.svelte';
	import MobileSheet from '../ui/MobileSheet.svelte';
	import ResizeSettings from '../ui/ResizeSettings.svelte';
	import TrackAddBar from '../ui/TrackAddBar.svelte';
	import TrackLibrary from '../ui/TrackLibrary.svelte';
	import TextTimelineLane from '../text/TextTimeline.svelte';
	import type { LyricsSyncProps } from '../text/LyricsSyncModal.svelte';
	import TextClipPanel from '../text/TextClipPanel.svelte';
	import GlCanvas from './GlCanvas.svelte';
	import SequenceGridView from './SequenceGridView.svelte';
	import SequenceTimeline from './SequenceTimeline.svelte';
	import FxLanes from './FxLanes.svelte';
	import MoshGroup from './MoshGroup.svelte';
	import MoshSettingsPanel from './MoshSettingsPanel.svelte';
	import RecordGroup from './RecordGroup.svelte';
	import RecordOverlay from './RecordOverlay.svelte';
	import ConfirmDialog from '../ui/ConfirmDialog.svelte';
	import ShortcutsModal from '../ui/ShortcutsModal.svelte';
	import { showToast } from '../ui/toast.svelte';

	interface Props {
		file: File;
		onfile: (f: File) => void;
		/** Sequence mode: the rest of the media pool, alongside `file`. */
		extraFiles?: File[];
		initialAudioFile?: File | null;
		/** Library id of `initialAudioFile`, when it came from a saved sequence. */
		initialTrackId?: string | null;
		/** The segment timeline belongs to 'sequence' alone — 'single' is one
		 * source and one effect chain, and the two persist separately. */
		mode?: 'single' | 'sequence';
		/** Single mode: work restored from a saved session, if reopened from one. */
		initialSession?: SingleSessionState | null;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: import('../../gl/renderer').GlRenderer | null;
		onExit?: () => void;
	}

	let {
		file,
		onfile,
		extraFiles = [],
		initialAudioFile = null,
		initialTrackId = null,
		mode = 'single',
		initialSession = null,
		warmCanvas = null,
		warmRenderer = null,
		onExit,
	}: Props = $props();

	let isSequenceMode = $derived(mode === 'sequence');
	let dragging = $state(false);
	let _mobileSheetRef: MobileSheet | undefined = undefined;

	let isVideo = $derived(file.type.startsWith('video/'));
	const isMobile = window.matchMedia('(pointer: coarse)').matches;
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

	$effect(() => {
		if (!isVideo) return;
		let cancelled = false;
		let player: VideoPreviewPlayer | null = null;
		VideoPreviewPlayer.create(file).then((p) => {
			if (cancelled || !p) {
				p?.dispose();
				return;
			}
			player = p;
			previewPlayer = p;
			// Player owns the preview now — the element is only a recording fallback
			videoEl?.pause();
			if (videoEl) videoEl.muted = true;
			videoDuration = p.duration;
			videoSpanStart = 0;
			videoSpanEnd = p.duration;
			recordDuration = Math.round(p.duration * 10) / 10;
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

	// Push editor state into the player
	$effect(() => {
		previewPlayer?.setSpeed(videoSpeed);
	});
	$effect(() => {
		if (previewPlayer) previewPlayer.loop = videoLoop || seqForceLoop;
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
				const mb = await import('mediabunny');
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


	// Sequence mode has no still to save — a segment timeline is a video by
	// definition — so it skips the picker and stays on WebM.
	let format = $state<'png' | 'jpg' | 'webm'>(
		isMobile && untrack(() => mode) !== 'sequence' ? 'png' : 'webm',
	);
	let isImageFormat = $derived(format === 'png' || format === 'jpg');
	let isVideoFormat = $derived(format === 'webm');
	let imageSrc = $state('');
	$effect(() => {
		const url = URL.createObjectURL(file);
		imageSrc = url;
		return () => URL.revokeObjectURL(url);
	});
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
		const known = saved.filter((e) => e && getDefinition(e.defId));
		return known.length > 0 ? known : null;
	}

	let effects: EffectInstance[] = $state(restoredEffects() ?? loadInitialEffects());

	const saved = loadSettings();
	let moshMin = $state(saved.moshMin ?? DEFAULT_SETTINGS.moshMin);
	let moshMax = $state(saved.moshMax ?? DEFAULT_SETTINGS.moshMax);
	let randomizeOrder = $state(saved.randomizeOrder ?? DEFAULT_SETTINGS.randomizeOrder);
	let showMoshSettings = $state(false);
	let moshAudioLink = $state(saved.moshAudioLink ?? DEFAULT_SETTINGS.moshAudioLink);
	let moshAudioLinkStrength = $state(
		saved.moshAudioLinkStrength ?? DEFAULT_SETTINGS.moshAudioLinkStrength,
	);
	let moshLinkBand = $state<FreqBand>(
		saved.moshLinkBand ?? DEFAULT_SETTINGS.moshLinkBand,
	);
	let autoRangeAmount = $state(
		saved.autoRangeAmount ?? DEFAULT_SETTINGS.autoRangeAmount,
	);
	let audioSmoothing = $state(saved.audioSmoothing ?? DEFAULT_SETTINGS.audioSmoothing);
	let audioPunch = $state(saved.audioPunch ?? DEFAULT_SETTINGS.audioPunch);
	// One object so the preview tick and the export are fed the same thing.
	const audioResponse = $derived<AudioResponse>({
		autoRange: autoRangeAmount,
		smoothing: audioSmoothing,
		punch: audioPunch,
	});
	let showFps = $state(saved.showFps ?? DEFAULT_SETTINGS.showFps);
	let videoLoop = $state(saved.loopVideo ?? DEFAULT_SETTINGS.loopVideo);
	let sourceFit = $state<SourceFit>(saved.sourceFit ?? DEFAULT_SETTINGS.sourceFit);
	$effect(() => {
		glRenderer?.setSourceFit(sourceFit);
	});
	let showShortcuts = $state(false);
	let previewFullscreen = $state(false);
	const fullscreenSupported =
		typeof document !== 'undefined' && document.fullscreenEnabled;

	// The record overlay and progress live outside the fullscreen element, so
	// staying in it during an export would hide every control the user needs.
	$effect(() => {
		if (recordingState.recording) previewFullscreen = false;
	});

	const audio = new AudioManager({
		getEffects: () => renderedEffects,
		getAudioResponse: () => audioResponse,
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
			raf = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(raf);
	});

	// Sync audioEl DOM binding into the manager
	let audioEl = $state<HTMLAudioElement | undefined>(undefined);
	$effect(() => { audio.setAudioEl(audioEl); });

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
		moshLinkBand;
		autoRangeAmount;
		audioSmoothing;
		audioPunch;
		showFps;
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
			moshLinkBand,
			autoRangeAmount,
			audioSmoothing,
			audioPunch,
			showFps,
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
		'openmosh-single-span',
	);
	const sizeStore = createTrackStore<{ width: number; height: number }>(
		'openmosh-single-size',
	);

	// Persist span changes for library tracks
	$effect(() => {
		audio.spanStart;
		audio.spanEnd;
		if (currentTrackId) {
			spanStore.save(currentTrackId, {
				spanStart: audio.spanStart,
				spanEnd: audio.spanEnd,
			});
		}
	});

	let trackInput: HTMLInputElement;

	// Persist the output size per track, alongside the span above.
	$effect(() => {
		const w = resizeWidth;
		const h = resizeHeight;
		if (currentTrackId && w > 0 && h > 0) {
			sizeStore.save(currentTrackId, { width: w, height: h });
		}
	});

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
			trackInput.value = '';
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
	function applySavedTrackState(trackId: string): boolean {
		const savedSpan = spanStore.load(trackId);
		if (savedSpan !== null) {
			audio.pendingSpan = { start: savedSpan.spanStart, end: savedSpan.spanEnd };
		}
		const savedSize = sizeStore.load(trackId);
		if (savedSize && savedSize.width > 0 && savedSize.height > 0) {
			resizeWidth = savedSize.width;
			resizeHeight = savedSize.height;
			sizeRestoredFromTrack = true;
		}
		const savedSeq = loadSeqEntry(trackId);
		if (savedSeq === null) return false;
		if (isSequenceMode) {
			sequenceSegments = savedSeq.segments ?? [];
			restoreSequenceBpm(savedSeq.bpm ?? 0);
			selectedSegmentId = null;
			restoreFxLanes(savedSeq.fx);
		}
		restoreTextTimeline(savedSeq.text);
		return true;
	}

	/** The editor learned a track's library id without being asked to load it —
	 * the upload screen's track, saved or already present. */
	function adoptLibraryTrack(trackId: string) {
		if (currentTrackId === trackId) return;
		currentTrackId = trackId;
		applySavedTrackState(trackId);
	}

	function onLibraryLoadTrack(file: File, trackId: string, autoplay = false) {
		// Moving between two songs starts the new one clean; arriving at the
		// first song keeps what's on screen, since that work was made for it and
		// had nowhere else to be saved.
		const switchingSongs = !!currentTrackId && currentTrackId !== trackId;
		clearTrack();
		currentTrackId = trackId;
		audio.trackFile = file;
		if (!applySavedTrackState(trackId) && switchingSongs) {
			// Empty rather than a fresh segment: the seeding effect rebuilds one
			// once the new track reports its duration. The media pool is
			// deliberately left alone — see the pool restore effect.
			sequenceSegments = [];
			selectedSegmentId = null;
			restoreFxLanes(undefined);
		}
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
		if (previewPlayer) {
			if (
				previewPlayer.currentTime < videoSpanStart ||
				previewPlayer.currentTime >= videoSpanEnd - VIDEO_END_EPSILON
			) {
				previewPlayer.seek(videoSpanStart);
			}
			previewPlayer.play();
			return;
		}
		if (!videoEl) return;
		if (
			videoEl.currentTime < videoSpanStart ||
			videoEl.currentTime >= videoSpanEnd - VIDEO_END_EPSILON
		) {
			videoEl.currentTime = videoSpanStart;
		}
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
			moshLinkBand,
			hasAudio,
		};
	}

	// ── Sequence mode: timeline of preset/mosh segments over the video ───────
	// Only ever populated on the sequence route; single mode has no timeline.
	let sequenceSegments = $state<SequenceSegment[]>([]);
	let selectedSegmentId = $state<string | null>(null);

	// Stacked effect lanes over the source lane above. They carry no media — a
	// clip only says "also run these effects here" — and their chains are
	// appended to the source segment's, in lane order. See editor/fx-lanes.ts.
	let fxLanes = $state<FxLane[]>([]);
	let selectedFxClipId = $state<string | null>(null);
	let selectedFxClipIds = $state<string[]>([]);

	// With an external track the audio is the master clock (matches export,
	// where the audio span sets the duration and the video loops inside it).
	// Segments then live on the audio timeline, not the video's.
	let seqMasterIsAudio = $derived(!!audio.trackFile && audio.trackDuration > 0);
	let seqMasterDuration = $derived(
		seqMasterIsAudio ? audio.trackDuration : videoDuration,
	);

	// Beats per minute for this song, feeding the AUTO segments' re-roll
	// spacing. 0 = not detected yet.
	let sequenceBpm = $state(0);

	const seqStore = createTrackStore<{
		segments?: SequenceSegment[];
		/** Absent on entries saved before BPM existed. */
		bpm?: number;
		/** Absent on entries saved before the text timeline existed. */
		text?: TextTimeline;
		/** Absent on entries saved before fx lanes existed. */
		fx?: FxLane[];
	}>('openmosh-sequence');

	// Keyed by master clock — that's what segment times are relative to.
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
	 * them overwriting each other: a song sequenced on #sequence came back with
	 * its timeline (and the sequence mode) forced on in #editor, and any edit there
	 * wrote back over the sequence work. The prefix keeps the two apart.
	 */
	const seqKeyPrefix = $derived(isSequenceMode ? 'seq:' : 'single:');
	let seqStoreKey = $derived(seqBaseKey && seqKeyPrefix + seqBaseKey);

	/**
	 * Read this mode's entry for a song, falling back once to the legacy
	 * un-prefixed entry. Only the sequence route falls back: those entries hold
	 * real timelines worth keeping, whereas letting single mode read them is the
	 * exact leak the prefix exists to stop.
	 */
	function loadSeqEntry(baseKey: string) {
		const entry =
			seqStore.load(seqKeyPrefix + baseKey) ??
			(isSequenceMode ? seqStore.load(baseKey) : null);
		// Entries can predate a transition being retired; remap before anything
		// downstream tries to look up a shader that no longer exists.
		if (entry?.segments) normalizeSegmentTransitions(entry.segments);
		return entry;
	}

	// Once per video; with a track loaded, onLibraryLoadTrack owns restoring.
	let restoredSeqKey: string | null = null;
	$effect(() => {
		const key = videoSeqKey;
		if (!key || key === restoredSeqKey) return;
		restoredSeqKey = key;
		if (untrack(() => seqMasterIsAudio)) return;
		const saved = loadSeqEntry(key);
		if (saved === null) return;
		if (isSequenceMode) {
			sequenceSegments = saved.segments ?? [];
			restoreSequenceBpm(saved.bpm ?? 0);
			selectedSegmentId = null;
			restoreFxLanes(saved.fx);
		}
		restoreTextTimeline(saved.text);
	});

	/** A restored BPM wins over any detection already in flight — the segments
	 * were built against it, so re-deriving it would retime them. Restoring
	 * nothing leaves the detection to land. */
	function restoreSequenceBpm(bpm: number) {
		if (bpm > 0) bpmEpoch++;
		sequenceBpm = bpm;
	}

	// Persist the sequence timeline per library track (deep read via snapshot,
	// so segment/effect edits are captured too). Skipped while playing: static
	// segments share identity with the live `effects`, so the per-frame
	// volume-link tick mutates values inside `sequenceSegments` — an ungated
	// deep read here re-ran the snapshot + localStorage JSON round-trip every
	// frame, tanking preview FPS proportionally to segment count. Persisting
	// settles on pause; the debounce keeps slider/segment drags from writing
	// localStorage per input event.
	let seqSaveTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const playing = audio.audioPlaying || videoIsPlaying;
		if (playing) return;
		const segs = $state.snapshot(sequenceSegments) as SequenceSegment[];
		const bpm = sequenceBpm;
		const text = $state.snapshot(textTimeline) as TextTimeline;
		const fx = $state.snapshot(fxLanes) as FxLane[];
		const key = seqStoreKey;
		if (!key) return;
		clearTimeout(seqSaveTimer);
		seqSaveTimer = setTimeout(() => {
			seqStore.save(key, { segments: segs, bpm, text, fx });
		}, 300);
	});

	/**
	 * Write the current timeline under the current key, now.
	 *
	 * The effect above can't cover a track switch on its own. Svelte batches the
	 * whole switch into one update, so by the time it re-runs `seqStoreKey` is
	 * already the *new* track and `sequenceSegments` may already have been
	 * replaced — the outgoing track's edits were never written, and any pending
	 * debounce for it gets cancelled on the way past. Worse, the effect is gated
	 * on playback, so editing while the track plays (the normal way to use this)
	 * schedules nothing at all until a pause that the switch itself supplies too
	 * late. Every path that changes or drops the song calls this first.
	 */
	function flushSequenceSave() {
		clearTimeout(seqSaveTimer);
		const key = seqStoreKey;
		if (!key) return;
		seqStore.save(key, {
			segments: $state.snapshot(sequenceSegments) as SequenceSegment[],
			bpm: sequenceBpm,
			text: $state.snapshot(textTimeline) as TextTimeline,
			fx: $state.snapshot(fxLanes) as FxLane[],
		});
	}

	// Reloading or closing mid-playback would otherwise lose the session, for
	// the same reason: no pause ever arrives to settle the debounce.
	onMount(() => {
		const onHide = () => {
			flushSequenceSave();
			flushMediaPoolSave();
		};
		window.addEventListener('pagehide', onHide);
		return () => {
			window.removeEventListener('pagehide', onHide);
			onHide();
		};
	});

	// Re-fit segments when the master clock changes (track loaded/swapped/cleared).
	$effect(() => {
		const duration = seqMasterDuration;
		const segs = sequenceSegments;
		const fixed = normalizeCoverage(segs, duration);
		if (fixed !== segs) sequenceSegments = fixed;
	});

	function seqMasterTime(): number {
		if (seqMasterIsAudio) return audio.trackCurrentTime;
		return videoClock;
	}


	// Owns undo/redo + boundary selection/clipboard for every sequenceSegments
	// edit — timeline drags/splits (in SequenceTimeline.svelte) as well as
	// preset/mosh/mode changes made from the segment toolbar below, so Ctrl+Z
	// in SEQ mode undoes the last sequence edit regardless of where it came from.
	const seqBoundaries = new SegmentBoundaryController<SequenceSegment>({
		getSegments: () => sequenceSegments,
		getTrackDuration: () => seqMasterDuration,
		onChange: (segments) => {
			// Every edit funnels through here — the one place to hold the invariant.
			const fitted = normalizeCoverage(segments, seqMasterDuration);
			sequenceSegments = fitted;
			// Splits/merges/undo can retire segment ids — drop their mosh stacks
			// so a later segment reusing an id can't inherit stale rolls.
			seqMoshHistory.retain(fitted.map((s) => s.id));
		},
		// A panel-edit burst must not record on top of the state an undo/redo
		// just restored — drop it so the next edit snapshots fresh.
		onRestore: () => cancelPanelBurst(),
		splitSegment: (seg, at) => {
			const end = seg.endTime ?? seqMasterDuration;
			const tail = cloneSegmentForSplit(seg, at, end);
			// The tail continues the same region — a transition configured for
			// entering `seg` from its predecessor must not replay at the split.
			tail.transition = undefined;
			tail.transitionOnTick = undefined;
			return [cloneSegmentForSplit(seg, seg.startTime, at), tail];
		},
	});

	const previewSeqSource = createSequenceEffectSource(
		() => sequenceSegments,
		() => seqMasterDuration,
		getMoshOptions,
	);

	// ── FX lanes ─────────────────────────────────────────────────────────────
	// Their own undo stack, for the same reason the text timeline has one: the
	// sequence stack is typed to segments, and nudging an fx clip shouldn't
	// rewind the source lane. Ctrl+Z routes here while an fx clip is selected.
	const fxHistory = createSnapshotHistory<FxLane[]>([]);

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
		fxHistory.reset(fxLanes);
	}

	function addFxLane() {
		const next = appendFxLane(fxLanes);
		// At the cap this is a no-op; recording it would leave a Ctrl+Z entry
		// that undoes nothing.
		if (next === fxLanes) return;
		pushFxHistory();
		fxLanes = next;
	}

	function fxModeChange(
		clipIds: string[],
		mode: SequenceSegmentMode,
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

	// ←/→ walk one fx clip's moshes, the same way they walk a segment's. Its own
	// stack per clip, keyed by clip id — SegmentMoshHistory is agnostic about
	// what the id names, and an FxClip carries exactly the fields it snapshots.
	const fxMoshHistory = new SegmentMoshHistory();

	/**
	 * The fx clip the mosh gestures act on: the selected one, and only that.
	 *
	 * No playhead fallback, unlike segments — several lanes can hold a clip at
	 * one time, so "the clip under the playhead" names no single thing. With
	 * nothing selected the gestures stay with the source lane, which is what
	 * they did before fx lanes existed.
	 */
	function activeFxClip(): FxClip | null {
		return selectedFxClip;
	}

	/**
	 * Roll the given clips. Mosh history only — never the fx edit stack: a mosh
	 * is not a hand-edit, and recording it would leave a Ctrl+Z entry behind
	 * every arrow press, with the two histories driving each other. Same rule
	 * applySegmentMosh follows for the source lane.
	 */
	function fxRoll(clipIds: string[]) {
		const ids = new Set(clipIds);
		for (const clip of fxClipsById(ids)) {
			fxMoshHistory.seed(clip.id, fxClipMoshSnapshot($state.snapshot(clip) as FxClip));
		}
		fxLanes = rollFxClips(fxLanes, ids, getMoshOptions());
		for (const clip of fxClipsById(ids)) {
			fxMoshHistory.push(clip.id, fxClipMoshSnapshot($state.snapshot(clip) as FxClip));
		}
	}

	function fxClipsById(ids: Set<string>): FxClip[] {
		return fxLanes.flatMap((l) => l.clips.filter((c) => ids.has(c.id)));
	}

	function applyFxClipMosh(clipId: string, snap: SegmentMoshSnapshot) {
		fxLanes = restoreFxClipMosh(fxLanes, clipId, snap);
	}

	function fxClear(clipIds: string[]) {
		pushFxHistory();
		fxLanes = clearFxClips(fxLanes, new Set(clipIds));
	}

	// The panel edits one chain at a time, so the two lane selections are
	// mutually exclusive: picking either drops the other. Written as a pair of
	// one-way effects rather than one arbitrating effect — each only reacts to
	// the selection it clears against, so whichever the user just made survives
	// and the other settles to null on the next pass.
	$effect(() => {
		if (!selectedFxClipId) return;
		untrack(() => (selectedSegmentId = null));
	});

	$effect(() => {
		if (!selectedSegmentId) return;
		untrack(() => {
			selectedFxClipId = null;
			selectedFxClipIds = [];
		});
	});

	/** The fx clip the effects panel is editing, if one is selected. */
	let selectedFxClip = $derived(
		isSequenceMode ? (findFxClip(fxLanes, selectedFxClipId)?.clip ?? null) : null,
	);

	// Same resolver the export builds, so interval rolls reproduce exactly.
	const previewFxSource = createFxLayerSource(() => fxLanes, getMoshOptions);

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
	// Segments pick their source from here. The primary entry is the file the
	// editor was opened with: it keeps owning the master clock and (as a video)
	// the preview audio, so the frame driver hands its frames back to the
	// existing player rather than sampling it a second time.
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

	onMount(() => {
		if (!isSequenceMode) return;
		void (async () => {
			// Not persisted: the primary belongs to the editor session, never to
			// a song's pool, so storing it would write (possibly hundreds of MB
			// of) video into IndexedDB that nothing would ever read back.
			await sourceRegistry.add([file], { primary: true, persist: false });
			poolFilled = true;
			const extras = extraFiles.filter((f) => f !== file);
			// Opened from a saved song: these blobs came straight out of storage,
			// so writing them back would rewrite the whole pool for nothing.
			if (extras.length > 0) {
				await sourceRegistry.add(extras, { persist: !initialTrackId });
			}
		})();
		return () => sourceRegistry.dispose();
	});

	// ── Per-song media pool ──────────────────────────────────────────────────
	// Keyed the same way as the sequence timeline (seqBaseKey), so loading a
	// track brings back both the segments and the media they were built from.
	// The primary source belongs to the editor session, not the song, and is
	// left alone by all of this.
	let poolKey: string | null = null;
	let poolReady = $state(false);
	/** Segment source ids already looked for in storage; see the effect below. */
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
			if (ids) await sourceRegistry.setExtras(ids);
			if (poolKey === key) poolReady = true;
		})();
	});

	// Persist the pool for the current song. Debounced because a multi-file add
	// appends in batches and would otherwise write once per batch.
	//
	// The primary is listed too. Opening a saved sequence promotes the pool's
	// first entry to primary, so excluding primaries would drop one source from
	// the pool every time the song was reopened. Restoring skips ids already
	// present, and the primary is never removed, so listing it costs nothing.
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
	// back out of IndexedDB, so a reload shows each segment's own media instead
	// of silently falling back to the primary. Ids that aren't in the store are
	// remembered as attempted, otherwise this would retry them forever.
	$effect(() => {
		if (!isSequenceMode) return;
		const missing = sequenceSegments
			.map((s) => s.sourceId)
			.filter(
				(id): id is string =>
					!!id && !sourceRegistry.get(id) && !restoreAttempted.has(id),
			);
		if (missing.length === 0) return;
		for (const id of missing) restoreAttempted.add(id);
		void sourceRegistry.restore(missing);
	});

	// A non-empty pool always has a primary: segments carrying no source of
	// their own resolve to it, and the editor's own player is what decodes it.
	// This covers every path that refills a pool the user emptied — the picker,
	// a drop, and the restore that follows a song change.
	$effect(() => {
		if (!isSequenceMode || sourceRegistry.primaryId) return;
		const next = sourceRegistry.sources[0];
		if (!next) return;
		untrack(() => {
			sourceRegistry.setPrimary(next.id);
			onfile(next.file);
			seqFrames.invalidate();
		});
	});

	async function addSequenceSources(files: File[]) {
		const added = await sourceRegistry.add(files);
		const skipped = files.length - added.length;
		if (skipped > 0) {
			showToast(
				`Skipped ${skipped} file${skipped === 1 ? '' : 's'} that couldn't be decoded`,
				'error',
			);
		}
	}

	let showClearSourcesConfirm = $state(false);

	/**
	 * Empty the pool back to the primary source. The segment reset goes through
	 * seqBoundaries so Ctrl+Z restores the assignments — the media itself is
	 * deleted from storage though, so re-adding the files is on the user.
	 */
	function clearSequenceSources() {
		showClearSourcesConfirm = false;
		sourceRegistry.clearExtras();
		// The cleared source's frame is still on the texture, and the driver
		// still thinks it's current — make it re-upload from the primary.
		seqFrames.invalidate();
		restoreAttempted.clear();
		if (sequenceSegments.some((s) => s.sourceId)) {
			seqBoundaries.commit(
				sequenceSegments.map((s) =>
					s.sourceId ? { ...s, sourceId: undefined } : s,
				),
			);
		}
	}

	/**
	 * Segments pointing at a removed source fall back to the primary. The primary
	 * goes the same way as the rest: the effect above re-seats it on whatever is
	 * left, and emptying the pool entirely leaves the preview on its no-media
	 * placeholder until something is added back.
	 */
	function removeSequenceSource(id: string) {
		sourceRegistry.remove(id);
		seqFrames.invalidate();
		seqBoundaries.commit(
			sequenceSegments.map((s) =>
				s.sourceId === id ? { ...s, sourceId: undefined } : s,
			),
		);
	}

	function assignSegmentSource(segIds: string[], sourceId: string) {
		const ids = new Set(segIds);
		const primary = sourceRegistry.primaryId;
		seqBoundaries.commit(
			sequenceSegments.map((s) =>
				ids.has(s.id)
					? { ...s, sourceId: sourceId === primary ? undefined : sourceId }
					: s,
			),
		);
	}

	/** The timeline's whole selection, so the stack toolbar can act on it too. */
	let seqSelectedIds = $state<string[]>([]);

	/** Grid replaces the preview while the pool is being arranged; the timeline
	 * stays put under it, so a card can still be dragged onto a segment. */
	let sequenceView = $state<'preview' | 'grid'>('preview');
	let sequenceGridOpen = $derived(isSequenceMode && sequenceView === 'grid');

	/** The source the selection plays, for the grid's highlight; null when the
	 * selected segments disagree or nothing is selected. */
	let seqSelectedSourceId = $derived.by(() => {
		const picked = new Set(seqSelectedIds);
		const played = sequenceSegments
			.filter((s) => picked.has(s.id))
			.map((s) => s.sourceId ?? sourceRegistry.primaryId);
		if (played.length === 0) return null;
		return played.every((id) => id === played[0]) ? played[0] : null;
	});

	/** Deal the pool across the given segments — the toolbar passes the whole
	 * lane when nothing is selected. */
	function randomizeSegmentSourcesFor(segIds: string[]) {
		const pool = sequenceSources.map((s) => s.id);
		if (pool.length < 2 || segIds.length === 0) return;
		seqBoundaries.commit(
			randomizeSegmentSources(
				sequenceSegments,
				new Set(segIds),
				pool,
				sourceRegistry.primaryId,
			),
		);
	}

	function seqPlaying(): boolean {
		return seqMasterIsAudio ? audio.audioPlaying : videoIsPlaying;
	}

	/** Segment under the playhead — or, while paused, the selected one, matching
	 * which chain the panel is editing. */
	function activeSegment(): SequenceSegment | null {
		if (!seqPlaying() && selectedSegmentId) {
			const sel = sequenceSegments.find((s) => s.id === selectedSegmentId);
			if (sel) return sel;
		}
		return findSegmentAt(sequenceSegments, seqMasterTime(), seqMasterDuration);
	}

	function activeSourceId(): string | null {
		const primary = sourceRegistry.primaryId;
		if (!isSequenceMode) return primary;
		return activeSegment()?.sourceId ?? primary;
	}

	/**
	 * How far into its clip a segment's video should be: the master clock minus
	 * the segment's start, so every source frame is a function of song position
	 * alone. Playback that stalls, a scrub, and the export all land on the same
	 * frame — and a paused preview holds instead of running on.
	 */
	function sourceTimeIn(seg: SequenceSegment | null | undefined): number {
		if (!seg) return 0;
		return Math.max(0, seqMasterTime() - seg.startTime);
	}

	const seqFrames = new SequenceFrameDriver({
		registry: sourceRegistry,
		getRenderer: () => glRenderer,
		onUpload: bumpSourceTick,
	});

	let seqActiveSourceId = $derived.by(() => activeSourceId());
	let seqActiveSource = $derived(sourceRegistry.get(seqActiveSourceId));
	let seqSourceKey = $derived(`${seqActiveSourceId}:${sourceTick}`);
	// The primary video is driven by the editor's own player, which GlCanvas
	// already keeps animating. Only while the master runs: a paused source sits
	// at one master time, so the canvas has nothing to re-upload — a late decode
	// bumps `sourceTick` and redraws through the static path instead.
	let seqSourceAnimating = $derived(
		seqActiveSource?.kind === 'video' &&
			!seqActiveSource.primary &&
			seqPlaying(),
	);

	function driveSequenceSource(): boolean {
		if (!isSequenceMode) return false;
		const seg = activeSegment();
		const id = seg?.sourceId ?? sourceRegistry.primaryId;
		return seqFrames.advance(id, sourceTimeIn(seg));
	}

	/**
	 * Source the running transition is fading *out* of, with how far into its
	 * clip it should be. Null when there isn't one or both sides draw from the
	 * same media (nothing to cross-fade, so the effect chains blend over one
	 * texture as before).
	 */
	function outgoingSource(): { id: string; time: number } | null {
		const tr = seqTransition;
		if (!tr) return null;
		const segA = findSegmentAt(
			sequenceSegments,
			tr.boundaryTime - 0.001,
			seqMasterDuration,
		);
		const idA = segA?.sourceId ?? sourceRegistry.primaryId;
		if (!idA || idA === activeSourceId()) return null;
		return { id: idA, time: sourceTimeIn(segA) };
	}

	function driveOutgoingSource(): boolean {
		if (!isSequenceMode) return true;
		const out = outgoingSource();
		return seqFrames.advanceOutgoing(out?.id ?? null, out?.time ?? 0);
	}

	let seqCrossFades = $derived.by(() => outgoingSource() !== null);

	// A rebuilt renderer (context loss) has a blank source texture; make the
	// driver re-upload instead of holding a texture that no longer exists.
	$effect(() => {
		glRenderer;
		seqFrames.invalidate();
	});

	// The route enables sequence mode with no toggle press to seed the first
	// segment, so do it as soon as a master clock exists.
	$effect(() => {
		if (!isSequenceMode || seqMasterDuration <= 0) return;
		if (untrack(() => sequenceSegments).length > 0) return;
		const seg = createSequenceSegment(0, null);
		seg.effects = untrack(() => effects).map(cloneEffectInstance);
		seg.label = 'current';
		sequenceSegments = [seg];
	});

	// While audio is master the video must always loop its span, regardless of
	// the user's loop toggle — master positions past the video length land
	// inside the loop instead of on a paused last frame.
	let seqForceLoop = $derived(isSequenceMode && seqMasterIsAudio);

	// Single playhead: audio master drives the video. Runs only on the ~4 Hz
	// audio clock ticks — video position/play-state are read untracked, so this
	// never re-runs per rendered frame (a reactive read of the video clock here
	// caused a seek storm that thrashed the decoder down to a few FPS).
	$effect(() => {
		if (!isSequenceMode || !seqMasterIsAudio || !isVideo) return;
		const vDur = videoSpanEnd - videoSpanStart;
		if (vDur <= 0) return;
		// Signed modulo: positions before the audio span still map onto the video
		// loop instead of pinning to the span start (which caused a seek-back
		// stutter when the playhead sat left of the span).
		const elapsed = audio.trackCurrentTime - audio.spanStart;
		const wrapped =
			(((elapsed * videoSpeed) % vDur) + vDur) % vDur;
		const target = videoSpanStart + wrapped;
		const audioPlaying = audio.audioPlaying;
		untrack(() => {
			const cur = previewPlayer
				? previewPlayer.currentTime
				: (videoEl?.currentTime ?? 0);
			// Circular distance: near the loop wrap cur≈end vs target≈start is
			// alignment, not drift.
			const diff = Math.abs(cur - target);
			const drift = Math.min(diff, vDur - diff);
			if (drift > 0.35) seekVideoTo(target);
			const vPlaying = previewPlayer ? previewPlayer.playing : videoPlaying;
			if (audioPlaying && !vPlaying) playVideo();
			else if (!audioPlaying && vPlaying) pauseVideo();
		});
	});

	// Playhead / selection → active effects. While playing the playhead wins;
	// while paused a clicked segment is loaded into the panel for editing.
	// Identity latch is a plain variable: `effects = next` wraps plain arrays in
	// a $state proxy, so comparing against `effects` would never settle.
	let lastSeqApplied: EffectInstance[] | null = null;
	let lastSeqWasPlaying = false;
	/**
	 * The chain the canvas renders while a sequence plays, kept out of the
	 * panel-bound `effects`. Raw rather than deep state: the render loop reads
	 * it every frame anyway, so proxying 39 objects per re-roll buys nothing.
	 */
	let seqPlaybackEffects = $state.raw<EffectInstance[] | null>(null);
	/**
	 * What is actually on screen right now: the source lane's chain, then each
	 * fx lane's, in lane order. GlRenderer runs a chain sequentially and keys
	 * per-effect state by instanceId, so appending is exactly "and then run
	 * these too".
	 */
	let renderedEffects = $derived.by(() => {
		const base = seqPlaybackEffects ?? effects;
		return fxChain.length === 0 ? base : [...base, ...fxChain];
	});
	let seqTransition = $state<ResolvedTransition | null>(null);
	$effect(() => {
		if (
			!isSequenceMode ||
			sequenceSegments.length === 0 ||
			seqMasterDuration <= 0
		) {
			seqTransition = null;
			return;
		}
		const playing = seqMasterIsAudio ? audio.audioPlaying : videoIsPlaying;
		const t = seqMasterTime();
		let next: EffectInstance[] | null = null;
		if (!playing && selectedSegmentId) {
			const seg = sequenceSegments.find((s) => s.id === selectedSegmentId);
			if (seg) {
				next =
					seg.mode === 'static' ? seg.effects : previewSeqSource(seg.startTime);
			}
		}
		if (!next) {
			next = previewSeqSource(t);
			// Only the playhead path blends — a segment selected for editing shows
			// its own chain plainly so tweaks aren't hidden mid-fade.
			seqTransition = resolveTransitionAt(
				sequenceSegments,
				t,
				seqMasterDuration,
				previewSeqSource,
			);
		} else {
			seqTransition = null;
		}
		// While playing, the rolled chain goes to the canvas only. Writing it to
		// `effects` would re-render the whole effects sidebar (which is bound to
		// it) on every re-roll — at a 1/32-beat spacing that's ~68 times a
		// second — and deep-proxy 39 fresh objects each time. The slideshow
		// keeps its per-beat chain off the panel for the same reason.
		if (next && (next !== lastSeqApplied || playing !== lastSeqWasPlaying)) {
			lastSeqApplied = next;
			lastSeqWasPlaying = playing;
			if (playing) {
				seqPlaybackEffects = next;
			} else {
				// Back to a still: hand the chain to the panel and stop overriding.
				seqPlaybackEffects = null;
				effects = next;
			}
		}
	});

	// Fallback <video> path only (WebCodecs player ticks its own clock per
	// frame): pull the element clock into state while playing so the effect
	// above notices transition windows at frame rate, not at the 4 Hz
	// timeupdate cadence.
	$effect(() => {
		if (!isSequenceMode || seqMasterIsAudio || previewPlayer || !videoPlaying)
			return;
		let raf = requestAnimationFrame(function loop() {
			videoCurrentTime = videoEl?.currentTime ?? 0;
			raf = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(raf);
	});

	function seqApplyPreset(segIds: string[], preset: Preset) {
		seqBoundaries.commit(
			fillSegmentsFromPreset(sequenceSegments, new Set(segIds), preset),
		);
	}

	// A preset was explicitly overwritten in the panel — overwriting never
	// re-assigns the preset to the selected segment, so this isn't an edit.
	function seqSyncPreset(preset: Preset) {
		sequenceSegments = syncSegmentsToPreset(sequenceSegments, preset);
	}

	// Loop playback inside the selected segment (edit-while-playing aid).
	let seqSegmentLoop = $state(false);
	$effect(() => {
		if (!isSequenceMode || !seqSegmentLoop || !selectedSegmentId) return;
		const seg = sequenceSegments.find((s) => s.id === selectedSegmentId);
		if (!seg) return;
		const end = seg.endTime ?? seqMasterDuration;
		const t = seqMasterTime();
		if (t < seg.startTime - 0.05 || t >= end) {
			if (seqMasterIsAudio) seekTo(seg.startTime);
			else seekVideoTo(seg.startTime);
		}
	});

	// Effects panel target: while a static segment is selected in sequence mode
	// the panel edits that segment — even during playback, when the canvas keeps
	// following the playhead. Otherwise the panel edits the live effects.
	function panelSelectedSegment(): SequenceSegment | null {
		if (!isSequenceMode || !selectedSegmentId) return null;
		const seg = sequenceSegments.find((s) => s.id === selectedSegmentId);
		return seg && seg.mode === 'static' ? seg : null;
	}

	// A hand-edit to a preset-filled segment or fx clip: the label gains a "*"
	// and explicit preset overwrites stop clobbering it. Driven by explicit edit
	// callbacks (not data watching) — the audio volume-link tick also mutates
	// values.
	function markPanelSegmentEdited() {
		const target = selectedFxClip ?? panelSelectedSegment();
		if (target && !target.modified) target.modified = true;
	}

	// An fx clip outranks a source segment: it's the more recent selection (the
	// lanes clear their selection when a segment is picked, and vice versa), and
	// it's the only thing the panel could mean while one is highlighted.
	function getPanelEffects(): EffectInstance[] {
		return selectedFxClip?.effects ?? panelSelectedSegment()?.effects ?? effects;
	}

	function setPanelEffects(v: EffectInstance[]) {
		const clip = selectedFxClip;
		if (clip) {
			clip.effects = v;
			return;
		}
		const seg = panelSelectedSegment();
		if (seg) {
			seg.effects = v;
		} else {
			effects = v;
		}
	}

	const moshSession = createMoshSession({
		getEffects: () => effects,
		setEffects: (v) => (effects = v),
		getMoshOptions,
		cancelBurst: () => panelBurst.cancel(),
		endBurst: () => panelBurst.end(),
	});

	// A segment edit records into the sequence stack (pre-edit snapshot), any
	// other edit into the single-mode history (pushed once the burst settles).
	const panelBurst = new PanelBurstController({
		onEditStart: () => {
			// An fx clip edit belongs to the fx stack, so Ctrl+Z steps back the
			// tweak rather than the source lane's last structural change.
			if (selectedFxClip) {
				pushFxHistory();
				return;
			}
			if (panelSelectedSegment()) {
				seqBoundaries.pushState(
					$state.snapshot(sequenceSegments) as SequenceSegment[],
				);
				return;
			}
			return () => moshSession.pushEdit(effects);
		},
	});
	const endPanelBurst = () => panelBurst.end();
	const cancelPanelBurst = () => panelBurst.cancel();
	const panelBeforeEdit = (coalesceKey?: string) =>
		panelBurst.beforeEdit(coalesceKey);

	// ←/→ in sequence mode walk the moshes of one segment: the selected one, or
	// whichever sits under the playhead.
	const seqMoshHistory = new SegmentMoshHistory();

	function inSequenceMode(): boolean {
		return isSequenceMode && sequenceSegments.length > 0;
	}

	function activeSequenceSegment(): SequenceSegment | null {
		if (!inSequenceMode()) return null;
		return (
			(selectedSegmentId
				? sequenceSegments.find((s) => s.id === selectedSegmentId)
				: null) ??
			findSegmentAt(sequenceSegments, seqMasterTime(), seqMasterDuration)
		);
	}

	function segmentMoshSnapshot(seg: SequenceSegment): SegmentMoshSnapshot {
		return {
			effects: $state.snapshot(seg.effects) as EffectInstance[],
			seed: seg.seed,
			label: seg.label,
			presetName: seg.presetName,
			modified: seg.modified,
		};
	}

	// Applied with live(), not commit(): a mosh is not an edit, so it must stay
	// out of the timeline's undo stack. Otherwise every arrow press would leave
	// a Ctrl+Z entry behind and the two histories would drive each other.
	function applySegmentMosh(segId: string, snap: SegmentMoshSnapshot) {
		seqBoundaries.live(restoreSegmentMosh(sequenceSegments, segId, snap));
	}

	/** Roll a new mosh for each segment. Mosh history only — see applySegmentMosh. */
	function seqRoll(segIds: string[]) {
		const ids = new Set(segIds);
		for (const s of sequenceSegments) {
			if (ids.has(s.id)) seqMoshHistory.seed(s.id, segmentMoshSnapshot(s));
		}
		seqBoundaries.live(rollSegments(sequenceSegments, ids, getMoshOptions()));
		for (const s of sequenceSegments) {
			if (ids.has(s.id)) seqMoshHistory.push(s.id, segmentMoshSnapshot(s));
		}
	}

	function seqClear(segIds: string[]) {
		seqBoundaries.commit(clearSegments(sequenceSegments, new Set(segIds)));
	}

	function seqModeChange(
		segIds: string[],
		mode: SequenceSegmentMode,
		intervalSec?: number,
		intervalBeats?: number | null,
	) {
		seqBoundaries.commit(
			setSegmentsMode(
				sequenceSegments,
				new Set(segIds),
				mode,
				intervalSec,
				intervalBeats,
			),
		);
	}

	// ── BPM ──────────────────────────────────────────────────────────────────
	// Same detector the slideshow uses: decode to mono 44.1 kHz, then
	// essentia's RhythmExtractor2013 in a shared worker. Here it feeds the
	// AUTO segments' re-roll spacing rather than a slide clock.
	let bpmDetecting = $state(false);
	let bpmDetectAbort: AbortController | null = null;
	/** Bumped whenever the BPM is settled from elsewhere — a restored song, a
	 * typed correction. A detection that started before that yields to it. */
	let bpmEpoch = 0;
	/** The track the automatic pass has already been spent on. */
	let autoBpmFor: File | null = null;

	// A new track detects its own tempo: the segment timing this feeds is
	// unusable until the BPM is right, so it shouldn't wait to be asked.
	$effect(() => {
		const file = audio.trackFile;
		if (!isSequenceMode || !file) return;
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
			if (!(e instanceof DOMException && e.name === 'AbortError')) {
				console.error('BPM detection failed:', e);
				showToast(
					"Couldn't detect the BPM for this track. Set it by hand instead.",
					'error',
					6000,
				);
			}
		} finally {
			bpmDetecting = false;
			bpmDetectAbort = null;
		}
	}

	/** Correcting the BPM retimes every segment — and every fx clip — whose
	 * spacing was set in beats. */
	function setSequenceBpm(bpm: number) {
		bpmEpoch++;
		sequenceBpm = bpm;
		const retimed = applyBpmToSegments(sequenceSegments, bpm);
		if (retimed !== sequenceSegments) seqBoundaries.commit(retimed);
		const retimedFx = applyBpmToFxLanes(fxLanes, bpm);
		if (retimedFx !== fxLanes) {
			pushFxHistory();
			fxLanes = retimedFx;
		}
	}

	function seqTransitionChange(changes: SegmentTransitionChange[]) {
		seqBoundaries.commit(applyTransitionChanges(sequenceSegments, changes));
	}

	function playSpan() {
		audio.playAudio();
		if (isVideo) playVideo();
	}

	function pauseTrack() {
		audio.pauseAudio();
		if (isVideo) pauseVideo();
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
		// A selected fx clip is what every other panel action is aimed at, so a
		// mosh means that clip — not a fresh roll of the whole segment chain
		// underneath it.
		const clip = activeFxClip();
		if (clip) {
			const snap = fxMoshHistory.redo(clip.id);
			if (snap) applyFxClipMosh(clip.id, snap);
			else fxRoll([clip.id]);
			return;
		}
		// Sequence mode: the mosh group is hidden, so the arrows drive the
		// selected (or playhead-active) segment's own mosh history instead. The
		// single-mode stack stays out of it even when no segment is active —
		// `effects` belongs to the segment resolver here.
		if (inSequenceMode()) {
			const seg = activeSequenceSegment();
			if (!seg) return;
			const snap = seqMoshHistory.redo(seg.id);
			if (snap) applySegmentMosh(seg.id, snap);
			else seqRoll([seg.id]);
			return;
		}
		moshSession.forward();
	}

	/** ← : back through the mosh history. Never touches the edit history. */
	function undoMosh() {
		const clip = activeFxClip();
		if (clip) {
			const snap = fxMoshHistory.undo(clip.id);
			if (snap) applyFxClipMosh(clip.id, snap);
			return;
		}
		if (inSequenceMode()) {
			const seg = activeSequenceSegment();
			if (seg) {
				const snap = seqMoshHistory.undo(seg.id);
				if (snap) applySegmentMosh(seg.id, snap);
			}
			return;
		}
		moshSession.back();
	}

	// Ctrl+Z/Y: hand-edits only. In sequence mode that's the timeline stack,
	// which covers both segment structure and panel tweaks on a segment.
	function undo() {
		// A selected text clip means the last thing edited was text.
		if (selectedTextClipId && textHistory.canUndo) {
			const prev = textHistory.undo();
			if (prev) textTimeline = prev;
			return;
		}
		if (selectedFxClipId && fxHistory.canUndo) {
			const prev = fxHistory.undo();
			if (prev) fxLanes = prev;
			return;
		}
		if (isSequenceMode) {
			seqBoundaries.undo();
			return;
		}
		moshSession.undoEdit();
	}

	function redo() {
		if (selectedTextClipId && textHistory.canRedo) {
			const next = textHistory.redo();
			if (next) textTimeline = next;
			return;
		}
		if (selectedFxClipId && fxHistory.canRedo) {
			const next = fxHistory.redo();
			if (next) fxLanes = next;
			return;
		}
		if (isSequenceMode) {
			seqBoundaries.redo();
			return;
		}
		moshSession.redoEdit();
	}

	function clearEffects() {
		// A selected fx clip is what the panel is showing, so it's what a clear
		// means — and unlike a segment its chain is never `effects`, so this has
		// to be checked before the identity test below.
		const clip = selectedFxClip;
		if (clip) {
			panelBeforeEdit();
			clearEffectsFn(clip.effects);
			clip.modified = true;
			return;
		}
		// In sequence mode the live effects can be the selected segment's own
		// array — a clear is a hand-edit to that segment.
		const seg = panelSelectedSegment();
		if (seg && seg.effects === effects) {
			panelBeforeEdit();
			clearEffectsFn(effects);
			seg.modified = true;
			return;
		}
		clearEffectsFn(effects);
		moshSession.pushEdit(effects);
	}

	function handleExit() {
		if (!onExit) return;
		if (recordingState.recording) {
			showToast(
				'Cancel or wait for the recording to finish before exiting',
				'error',
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
	function captureAtOutputRes(time: number, capture: (done: () => void) => void) {
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
		const prevFile = file;
		const prevEffects = $state.snapshot(effects) as EffectInstance[];
		captureAtOutputRes(performance.now() / 1000, (done) => {
			canvasEl!.toBlob((blob) => {
				if (!blob) {
					done();
					return;
				}
				const newFile = new File([blob], `openmosh-reinput-${Date.now()}.png`, {
					type: 'image/png',
				});
				effects.forEach((e) => (e.enabled = false));
				moshSession.resetEdits(effects);
				// No restore: loading the new file re-initializes the renderer
				onfile(newFile);
				showToast('Using this frame as the new source', 'info', 8000, {
					label: 'Undo',
					run: () => {
						effects = prevEffects.map(cloneEffectInstance);
						moshSession.resetEdits(effects);
						onfile(prevFile);
					},
				});
			}, 'image/png');
		});
	}

	const handleKeydown = createKeyboardHandler({
		save,
		mosh,
		undoMosh,
		undo,
		redo,
		reInput,
		toggleFullscreen: () => (previewFullscreen = !previewFullscreen),
		playSpan,
		pauseTrack,
		hasTrack: () => (!!audio.trackFile && !!audioEl) || isVideo,
		isPlaying: () => audio.audioPlaying || videoIsPlaying,
	});

	function save() {
		if (!canvasEl) return;
		if (noSequenceMedia) {
			showToast('Add media before saving a frame', 'info');
			return;
		}
		const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
		const ext = format === 'jpg' ? 'jpg' : 'png';
		// Image formats render frozen at time 0 (matches the preview's drawFrame)
		captureAtOutputRes(0, (done) => {
			canvasEl!.toBlob(
				(blob) => {
					done();
					if (!blob) return;
					const url = URL.createObjectURL(blob);
					const a = document.createElement('a');
					a.href = url;
					a.download = `openmosh-${Date.now()}.${ext}`;
					a.click();
					URL.revokeObjectURL(url);
				},
				mimeType,
				format === 'jpg' ? 0.92 : undefined,
			);
		});
	}

	let showRecordSettings = $state(false);
	let recordDuration = $state(5);
	let recordFps = $state(60);

	// ── Text timeline ──
	// Optional lanes of text clips over the master clock. Off until the user
	// turns it on, so nothing about the existing editor changes for people who
	// don't want text.
	// Seed only — a later change to the prop shouldn't overwrite live edits.
	let textTimeline = $state<TextTimeline>(
		untrack(() =>
			initialSession?.text
				? normalizeTextTimeline(initialSession.text)
				: { ...EMPTY_TEXT_TIMELINE },
		),
	);
	let selectedTextClipId = $state<string | null>(null);
	let lyricsOpen = $state(false);

	// ── Single-mode session ──
	// Sequence mode resumes from its song's media pool; single mode has only the
	// one file, so the file and the work done to it are saved together and the
	// upload screen offers it back. Untouched opens aren't saved — every file
	// ever previewed would otherwise pile up in the list.
	let sessionSaveTimer: ReturnType<typeof setTimeout> | undefined;

	function saveSingleSession() {
		if (isSequenceMode) return;
		// Lane presence, not `enabled`: that flag is the layer's visibility
		// toggle and survives being switched off with the lanes still there.
		// Keying either the guard or the payload off it discards the whole
		// timeline the moment the user hides it.
		const hasText = textTimeline.lanes.length > 0;
		if (!moshSession.touched && !hasText) return;
		const source = file;
		const state = {
			effects: $state.snapshot(effects) as EffectInstance[],
			text: hasText ? ($state.snapshot(textTimeline) as TextTimeline) : null,
		};
		// Keyed by the song when there is one, so the session sits alongside the
		// text timeline and span already saved under that track id.
		void saveSession('single', [source], state, currentTrackId)
			.then(() => pruneSequenceMedia())
			.catch((e) => {
				// Swallowing this outright is what made the last failure invisible.
				if (import.meta.env.DEV) console.error('Session save failed:', e);
			});
	}

	$effect(() => {
		if (isSequenceMode) return;
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

	const shortcutGroups = $derived([
		{
			title: 'Editor',
			shortcuts: [
				{ keys: ['→'], description: 'Next mosh, or roll a new one' },
				{ keys: ['←'], description: 'Previous mosh' },
				{ keys: ['Ctrl/Cmd+Z'], description: 'Undo effect edit' },
				{
					keys: ['Ctrl/Cmd+Shift+Z', 'Ctrl/Cmd+Y'],
					description: 'Redo effect edit',
				},
				{ keys: ['Ctrl/Cmd+S'], description: 'Save current frame' },
				{ keys: ['Space'], description: 'Play / pause' },
				{ keys: ['F'], description: 'Fullscreen preview (Esc to exit)' },
				{
					keys: ['V'],
					description: 'Bake current frame as the new source (undoable)',
				},
			],
		},
		...(isSequenceMode
			? [
					{
						title: 'Sequence timeline',
						shortcuts: [
							{
								keys: ['Ctrl+Click'],
								description: 'Create / split segment at cursor',
							},
							{ keys: ['Click'], description: 'Select segment for editing' },
							{
								keys: ['←', '→'],
								description: "Walk the selected segment's moshes",
							},
							{
								keys: ['Delete', 'Backspace'],
								description: 'Delete segment / selected boundaries',
							},
							{ keys: ['Esc'], description: 'Deselect / cancel paste' },
							{ keys: ['Ctrl/Cmd+Z'], description: 'Undo last sequence edit' },
							{
								keys: ['Ctrl/Cmd+Shift+Z', 'Ctrl/Cmd+Y'],
								description: 'Redo last sequence edit',
							},
							{
								keys: ['Shift+Drag'],
								description: 'Rectangle-select segments and boundaries',
							},
							{ keys: ['Ctrl/Cmd+C'], description: 'Copy selected segments' },
							{
								keys: ['Ctrl/Cmd+V'],
								description: 'Paste onto selection, or click to place a copied span',
							},
							{ keys: ['Scroll', 'Shift+Scroll'], description: 'Zoom / pan timeline' },
						],
					},
				]
			: []),
		...(isSequenceMode && fxLanes.length > 0
			? [
					{
						title: 'FX lanes',
						shortcuts: [
							{
								keys: ['Ctrl+Click'],
								description: 'Create clip in empty space / split the clip at cursor',
							},
							{ keys: ['Double-click'], description: 'Create clip in empty space' },
							{ keys: ['Click'], description: 'Select clip for editing' },
							{ keys: ['Shift+Click'], description: 'Select a range of clips' },
							{
								keys: ['Ctrl/Cmd+Shift+Click'],
								description: 'Add / remove one clip from the selection',
							},
							{ keys: ['Delete', 'Backspace'], description: 'Delete selected clips' },
							{ keys: ['Esc'], description: 'Deselect' },
						],
					},
				]
			: []),
		...(textTimeline.enabled ? [TEXT_TIMELINE_SHORTCUTS] : []),
	]);

	// A still image with no track has no clock at all, so the text timeline
	// supplies one: it loops the record window, which is what an export writes.
	let stillClock = $state(0);
	let stillPlaying = $state(false);

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
	// Every lane shares the master clock's axis: the segment lane, the text
	// lanes and whichever transport is the master. A video playing under its own
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
		if (textNeedsTransport) stillClock = t;
		else if (seqMasterIsAudio) seekTo(t);
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
		setTextTimeline(appendTextLane(textTimeline));
	}

	$effect(() => {
		if (!stillPlaying) return;
		const span = Math.max(0.1, textDuration);
		const started = performance.now() - untrack(() => stillClock) * 1000;
		let raf = requestAnimationFrame(function loop(now) {
			stillClock = ((now - started) / 1000) % span;
			raf = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(raf);
	});

	/** Names of the enabled main effects — the lane chain-position picker. */
	let textChainLabels = $derived(
		renderedEffects
			.filter((e) => e.enabled)
			.map((e) => getDefinition(e.defId)?.name ?? e.defId),
	);

	let selectedTextClip = $derived.by(() => {
		if (!selectedTextClipId) return null;
		for (const lane of textTimeline.lanes) {
			const clip = lane.clips.find((c) => c.id === selectedTextClipId);
			if (clip) return clip;
		}
		return null;
	});

	/** The lane holding the selected clip — the panel edits its style. */
	let selectedTextLane = $derived.by(() => {
		if (!selectedTextClipId) return null;
		return (
			textTimeline.lanes.find((l) =>
				l.clips.some((c) => c.id === selectedTextClipId),
			) ?? null
		);
	});

	// Its own undo stack: the chain stacks are typed to effect arrays, and a
	// text edit shouldn't rewind a mosh. Ctrl+Z routes here while a clip is
	// selected, and falls back to the chain once it is not.
	const textHistory = createTextHistory();

	// A restored timeline is the baseline, not an edit on top of an empty one:
	// the stack starts seeded with EMPTY, so without this the first undo would
	// wipe the lanes that just came back.
	if (untrack(() => initialSession?.text)) {
		textHistory.reset(untrack(() => textTimeline));
	}

	function pushTextHistory(coalesceKey?: string) {
		textHistory.push($state.snapshot(textTimeline) as TextTimeline, coalesceKey);
	}

	function setTextTimeline(next: TextTimeline) {
		textTimeline = next;
	}

	function updateTextClip(next: TextClip) {
		textTimeline = {
			...textTimeline,
			lanes: textTimeline.lanes.map((lane) => ({
				...lane,
				clips: lane.clips.map((c) => (c.id === next.id ? next : c)),
			})),
		};
	}

	function updateTextLane(next: TextLane) {
		textTimeline = updateLane(textTimeline, next.id, () => next);
	}

	/** Adopt a saved timeline, or clear back to empty when a track has none. */
	function restoreTextTimeline(saved: TextTimeline | undefined) {
		textTimeline = saved
			? normalizeTextTimeline(saved)
			: { ...EMPTY_TEXT_TIMELINE };
		selectedTextClipId = null;
		textHistory.reset(textTimeline);
	}

	function toggleTextTimeline() {
		pushTextHistory();
		textTimeline = textTimeline.enabled
			? { ...textTimeline, enabled: false }
			: textTimeline.lanes.length > 0
				? { ...textTimeline, enabled: true }
				: createTextTimeline();
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
		audio.trackFile && audio.trackDuration > 0 && audio.spanEnd - audio.spanStart > 0
			? audio.spanEnd - audio.spanStart
			: isVideo && videoDuration > 0
				? (videoSpanEnd - videoSpanStart) / videoSpeed
				: recordDuration,
	);
	const recordingState = createRecordingState();

	async function startRecording() {
		if (!canvasEl || !glRenderer || recordingState.recording) return;
		if (noSequenceMedia) {
			showToast('Add media before recording', 'info');
			return;
		}
		showRecordSettings = false;

		// Pause playback while recording
		audio.pauseAudio();
		previewPlayer?.pause();
		if (isVideo && videoEl) videoEl.pause();

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
					normalizeGain: audio.normalizeGain,
					audioResponse,
					textTimeline: textTimeline.enabled ? $state.snapshot(textTimeline) as TextTimeline : null,
					textTimeOffset,
					textTimeScale,
					sequence:
						isSequenceMode && sequenceSegments.length > 0
							? {
									segments: $state.snapshot(sequenceSegments) as SequenceSegment[],
									moshOptions: getMoshOptions(),
									duration: seqMasterDuration,
									masterIsAudio: seqMasterIsAudio,
									sources: sourceRegistry.sources,
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
				onError: (message) => showToast(message, 'error'),
				fallbackErrorMessage:
					'Recording failed. Check the browser console for details.',
			},
		);

		// Resume playback after recording
		audio.playAudio();
		if (previewPlayer) previewPlayer.play();
		else if (isVideo && videoEl) videoEl.play().catch(() => {});
		if (canvasEl && glRenderer) {
			glRenderer.render(renderedEffects, performance.now() / 1000);
		}
	}

	function cancelRecording() {
		recordingState.cancel();
	}

	/** Audio sets the track. Media replaces the file in single mode; in sequence
	 * mode it joins the pool, since segments can each pick their own. */
	function handleDroppedFiles(files: FileList) {
		const all = Array.from(files);
		const audioFile = all.find((f) => f.type.startsWith('audio/'));
		if (audioFile) {
			clearTrack();
			audio.trackFile = audioFile;
		}
		const media = all.filter(
			(f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
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
	use:fileDrop={{
		onDraggingChange: (d) => (dragging = d),
		onDrop: handleDroppedFiles,
	}}
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
	<div class="main-area">
		<div class="top-bar">
			<div class="toolbar">
				{#if onExit}
					<button class="help-btn" onclick={handleExit} title="Back to upload">
						<Home size={14} />
					</button>
				{/if}
				<GithubLink />
				<div class="bar-sep"></div>
				{#if isSequenceMode}
					<div class="output-group">
						<ButtonGroup
							buttons={[
								{ label: 'Preview', value: 'preview' },
								{ label: 'Grid', value: 'grid' },
							]}
							value={sequenceView}
							onchange={(v) => (sequenceView = v as 'preview' | 'grid')}
						/>
					</div>
					<span class="source-count readout">
						{sequenceSources.length} source{sequenceSources.length === 1
							? ''
							: 's'}
					</span>
				{:else}
					<div class="output-group">
						<span class="rack-label">Output</span>
						<ButtonGroup
							buttons={[
								{ label: 'PNG', value: 'png' },
								{ label: 'JPG', value: 'jpg' },
								{ label: 'WebM', value: 'webm' },
							]}
							value={format}
							onchange={(v) => (format = v)}
						/>
					</div>
				{/if}
			</div>
		</div>

		{#snippet noMediaOverlay()}
			<div class="no-media">
				<span class="no-media-label">NO MEDIA</span>
				<p class="no-media-text">
					Every source is gone from this song. Add an image or a video and the
					segments have something to play again.
				</p>
				<button class="no-media-btn" onclick={() => sourceInput?.click()}>
					<Plus size={14} /> ADD MEDIA
				</button>
				<span class="no-media-hint">or drop files anywhere</span>
			</div>
		{/snippet}

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
					recordDuration = Math.round(dur * 10) / 10;
					ensureVideoAudioGraph();
				}}
				ontimeupdate={() => {
					if (previewPlayer) return;
					videoCurrentTime = videoEl?.currentTime ?? 0;
					// Span-loop: skip during recording (export seeks the video directly)
					if (!recordingState.recording && videoEl && videoCurrentTime >= videoSpanEnd) {
						videoEl.currentTime = videoSpanStart;
						if (!videoLoop && !seqForceLoop) videoEl.pause();
					}
				}}
				onended={() => {
					// Natural end can fire before timeupdate reaches spanEnd
					if (!previewPlayer && !recordingState.recording && videoEl && (videoLoop || seqForceLoop)) {
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
				primarySourceId={sourceRegistry.primaryId}
				selectedCount={seqSelectedIds.length}
				selectedSourceId={seqSelectedSourceId}
				onAddFiles={(files) => void addSequenceSources(files)}
				onRemove={removeSequenceSource}
				onReorder={(from, to) => sourceRegistry.reorder(from, to)}
				onAssign={(id) => assignSegmentSource(seqSelectedIds, id)}
				onShuffle={() =>
					randomizeSegmentSourcesFor(
						seqSelectedIds.length > 0
							? seqSelectedIds
							: sequenceSegments.map((s) => s.id),
					)}
				onClear={() => (showClearSourcesConfirm = true)}
			/>
		{/if}
		<!-- Hidden, never unmounted: tearing the canvas down would take the
		     renderer (and the pre-warmed context it adopted) with it. -->
		<div class="preview-slot" class:hidden={sequenceGridOpen}>
			<GlCanvas
				{imageSrc}
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
				videoEl={isVideo && !previewPlayer ? videoEl : null}
				frameSource={previewPlayer}
				sourceDriver={isSequenceMode ? driveSequenceSource : null}
				outgoingDriver={isSequenceMode ? driveOutgoingSource : null}
				sourceKey={seqSourceKey}
				sourceAnimating={seqSourceAnimating}
				freezeAnimation={isImageFormat}
				suspended={recordingState.recording ||
					noSequenceMedia ||
					sequenceGridOpen}
				{warmCanvas}
				{warmRenderer}
				textTimeline={textTimeline.enabled ? textTimeline : null}
				{textTime}
				forceAnimation={textTimeline.enabled && textClockRunning}
				transition={seqTransition
					? {
							effectsA: seqTransition.effectsA,
							type: seqTransition.transition.type,
							seed: seqTransition.transition.seed,
							direction: seqTransition.transition.direction ?? 0,
							density: seqTransition.transition.density ?? 1,
							startTime: seqTransition.boundaryTime,
							durationSec: seqTransition.transition.durationSec,
							getTime: seqMasterTime,
							useAltSource: seqCrossFades,
						}
					: null}
				overlay={noSequenceMedia ? noMediaOverlay : undefined}
			/>
		</div>

		<div class="action-bar">
			<button
				class="library-btn"
				onclick={() => trackLibraryRef?.openLibrary()}
				title="Track library"
			>
				<Library size={12} />
			</button>
			<div class="mosh-group-wrap">
				{#if !isMobile}
					<button
						class="help-btn"
						onclick={() => (showShortcuts = true)}
						title="Keyboard shortcuts"
					>
						<HelpCircle size={14} />
					</button>
				{/if}
				{#if fullscreenSupported}
					<button
						class="help-btn"
						class:seq-active={previewFullscreen}
						onclick={() => (previewFullscreen = !previewFullscreen)}
						title="Fullscreen preview (F)"
					>
						<Maximize size={14} />
					</button>
				{/if}
				<button
					class="help-btn"
					class:seq-active={textTimeline.enabled}
					onclick={toggleTextTimeline}
					title="Text timeline: timed text layers with their own effects"
				>
					<Type size={14} />
				</button>
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
									{ label: 'PNG', value: 'png' },
									{ label: 'JPG', value: 'jpg' },
									{ label: 'WebM', value: 'webm' },
								]}
								value={format}
								onchange={(v) => (format = v)}
							/>
							<div class="settings-divider"></div>
						{/if}
						<div class="mosh-setting-row">
							<label for="show-fps">Show FPS</label>
							<input id="show-fps" type="checkbox" bind:checked={showFps} />
						</div>
						{#if isSequenceMode}
							<div class="mosh-setting-row">
								<label for="source-fit" title="How to fit sources that don't match the output aspect">
									Fit sources
								</label>
								<select id="source-fit" bind:value={sourceFit}>
									<option value="contain">Contain</option>
									<option value="cover">Cover</option>
									<option value="stretch">Stretch</option>
								</select>
							</div>
						{/if}
						<div class="settings-divider"></div>
						<ResizeSettings
							bind:width={resizeWidth}
							bind:height={resizeHeight}
							{naturalWidth}
							{naturalHeight}
						/>
					{/snippet}
				</MoshGroup>
			</div>
			{#if showStack}
				<!-- The same transport as the timeline toolbar's, at the size the
				     slideshow gives it: playing back is a main action here too. -->
				<button class="action-btn play-btn" onclick={toggleMasterPlay}>
					{#if textClockRunning}
						<Pause size={16} fill="currentColor" stroke="none" />
						STOP
					{:else}
						<Play size={16} fill="currentColor" stroke="none" />
						PLAY
					{/if}
				</button>
			{/if}
			{#if isImageFormat}
				<button class="action-btn save-btn" onclick={save}>
					<Download size={16} />
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
								<input
									id="rec-duration"
									type="range"
									min="1"
									max="30"
									step="1"
									bind:value={recordDuration}
								/>
								<span class="mosh-setting-val">{recordDuration}s</span>
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
			<TimelineStack
				trackDuration={textDuration}
				currentTime={textTime}
				isPlaying={textClockRunning}
				onTogglePlay={toggleMasterPlay}
				onSeek={seekMaster}
				loopEnabled={seqMasterIsAudio ? audio.loopAudio : videoLoop}
				onToggleLoop={audioIsMaster || videoIsMaster ? toggleMasterLoop : null}
			>
				{#snippet toolbar()}
					{#if textTimeline.enabled}
						<div class="tl-tool-sep"></div>
						<span class="tl-tool-label">Text</span>
						<button
							class="tl-tool-btn"
							title="Add a text lane"
							onclick={addTextLane}
						>
							<Plus size={12} /> Lane
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
					{#if isSequenceMode && seqMasterDuration > 0}
						<div class="tl-tool-sep"></div>
						<span class="tl-tool-label">FX</span>
						<button
							class="tl-tool-btn"
							disabled={fxLanes.length >= MAX_FX_LANES}
							title={fxLanes.length >= MAX_FX_LANES
								? `${MAX_FX_LANES} lanes is the limit — each effect on a lane is another full-screen pass`
								: "Add a stacked effect lane — its clips run after the segment's own chain"}
							onclick={addFxLane}
						>
							<Plus size={12} /> Lane
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
						onVolumeChange={videoHasAudio && audio.analyserNode && !audio.trackFile
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
						onSpanStartChange={(t) => (audio.spanStart = t)}
						onSpanEndChange={(t) => (audio.spanEnd = t)}
						onVolumeChange={(v) => audio.setOutputVolume(v)}
					/>
				{/if}
				{#if textTimeline.enabled}
					<TextTimelineLane
						timeline={textTimeline}
						chainLabels={textChainLabels}
						bind:selectedClipId={selectedTextClipId}
						onChange={setTextTimeline}
						onBeforeEdit={pushTextHistory}
						{lyricsSync}
						bind:lyricsOpen
					/>
				{/if}
				{#if seqMasterDuration > 0 && isSequenceMode}
					<SequenceTimeline
						segments={sequenceSegments}
						boundaries={seqBoundaries}
						onSeek={(t) => (seqMasterIsAudio ? seekTo(t) : seekVideoTo(t))}
						bind:selectedSegmentId
						bind:selectedSegmentIds={seqSelectedIds}
						onApplyPreset={seqApplyPreset}
						onRoll={seqRoll}
						onClear={seqClear}
						onModeChange={seqModeChange}
						bpm={sequenceBpm}
						onTransitionChange={seqTransitionChange}
						segmentLoop={seqSegmentLoop}
						onToggleSegmentLoop={() => (seqSegmentLoop = !seqSegmentLoop)}
						sources={sequenceSources}
						primarySourceId={sourceRegistry.primaryId}
						onAssignSource={isSequenceMode ? assignSegmentSource : undefined}
					/>
				{/if}
				{#if isSequenceMode && fxLanes.length > 0}
					<FxLanes
						lanes={fxLanes}
						bind:selectedClipId={selectedFxClipId}
						bind:selectedClipIds={selectedFxClipIds}
						onChange={setFxLanes}
						onBeforeEdit={pushFxHistory}
						bpm={sequenceBpm}
						onModeChange={fxModeChange}
						onRoll={fxRoll}
						onClear={fxClear}
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
		{#if isSequenceMode}
			<!-- Outside the timeline stack: the stack is hidden while there's no
			     clock, and the empty-pool placeholder still needs this picker. -->
			<input
				bind:this={sourceInput}
				type="file"
				accept="image/*,video/*"
				multiple
				hidden
				onchange={(e) => {
					const picked = Array.from(e.currentTarget.files ?? []);
					if (picked.length > 0) void addSequenceSources(picked);
					e.currentTarget.value = '';
				}}
			/>
		{/if}
	</div>
	<MobileSheet bind:this={_mobileSheetRef}>
		{#snippet settings()}
			<div class="mosh-settings-wrapper">
				<MoshSettingsPanel
					bind:moshMin
					bind:moshMax
					bind:randomizeOrder
					bind:moshAudioLink
					bind:moshAudioLinkStrength
					bind:moshLinkBand
					bind:autoRangeAmount
					bind:audioSmoothing
					bind:audioPunch
					{hasAudio}
					showTiming={isSequenceMode}
					bpm={sequenceBpm}
					{bpmDetecting}
					hasTrack={!!audio.trackFile}
					onDetectBpm={runSequenceBpmDetection}
					onBpmChange={setSequenceBpm}
				/>
			</div>
		{/snippet}
		{#snippet effectsPanel()}
			{#if selectedTextClip}
				<TextClipPanel
					lane={selectedTextLane}
					clip={selectedTextClip}
					onLaneChange={updateTextLane}
					onClipChange={updateTextClip}
					onBeforeEdit={pushTextHistory}
					onClose={() => (selectedTextClipId = null)}
					hasTrack={!!audio.trackFile || (isVideo && !!audio.analyserNode)}
					spectrumData={audio.spectrumData}
				/>
			{:else}
			<EffectsPanel
				bind:effects={getPanelEffects, setPanelEffects}
				hasTrack={!!audio.trackFile || (isVideo && !!audio.analyserNode)}
				spectrumData={audio.spectrumData}
				onVolumeLinkChange={(index, paramKey, link) => {
					panelBeforeEdit(`link:${index}:${paramKey}`);
					setPanelEffects(setVolumeLink(getPanelEffects(), index, paramKey, link));
					markPanelSegmentEdited();
				}}
				onEffectsReplaced={endPanelBurst}
				onPresetUpdated={seqSyncPreset}
				onPresetApplied={(preset) => {
					const target = selectedFxClip ?? panelSelectedSegment();
					if (target) {
						target.label = preset.name;
						target.presetName = preset.name;
						target.modified = false;
					}
				}}
				onUserEdit={markPanelSegmentEdited}
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

	{#if showShortcuts}
		<ShortcutsModal groups={shortcutGroups} onClose={() => (showShortcuts = false)} />
	{/if}

	{#if showClearSourcesConfirm}
		<ConfirmDialog
			title="Clear all sources?"
			message="Every source but the one marked BASE is removed from this song, and its segments go back to playing the base. Media that other songs still use is kept."
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
	.top-bar {
		display: flex;
		align-items: center;
		padding: 7px 12px 6px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}


	.toolbar {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* Splits the navigation icons from the output controls: two jobs, one bar. */
	.bar-sep {
		width: 1px;
		height: 18px;
		margin: 0 0.15rem;
		background: var(--line);
		flex-shrink: 0;
	}

	.output-group {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		line-height: 1;
	}

	.source-count {
		margin-left: auto;
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	/* Holds the canvas's place in the column so the grid can take the box
	   without the preview being torn down. */
	.preview-slot {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.preview-slot.hidden {
		display: none;
	}

	@media (max-width: 800px) {
		.output-group :global(.rack-label) {
			display: none;
		}
	}

	.mosh-group-wrap {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.help-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		border: 1.5px solid var(--line-strong);
		color: var(--text-3);
		cursor: pointer;
		flex-shrink: 0;
		padding: 0;
		box-sizing: border-box;
		transition:
			border-color var(--t),
			color var(--t);
	}

	.help-btn:hover {
		border-color: var(--text-3);
		color: var(--text);
	}

	.help-btn.seq-active {
		border-color: var(--live-dim);
		color: var(--live);
		background: rgba(110, 231, 192, 0.1);
	}

	@media (max-width: 800px) {
		.help-btn {
			width: 26px;
			height: 26px;
		}
	}

	.settings-divider {
		height: 1px;
		background: var(--line);
		margin: 0.15rem 0;
	}

	/* Action bar */
	.action-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 1rem;
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
		transition: border-color var(--t-fast), color var(--t-fast);
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

	.library-btn {
		display: none;
	}

	.library-btn:hover {
		border-color: var(--text-3);
		color: var(--text);
	}

	@media (max-width: 800px) {
		.action-bar {
			padding: 0.6rem 0.5rem;
			gap: 0.4rem;
		}

		.action-btn {
			padding: 0.6rem 1.2rem;
			font-size: 0.7rem;
		}

		.library-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 26px;
			height: 26px;
			border-radius: 50%;
			background: none;
			border: 1.5px solid var(--line-strong);
			color: var(--text-3);
			cursor: pointer;
			flex-shrink: 0;
			padding: 0;
			box-sizing: border-box;
			transition:
				border-color var(--t),
				color var(--t);
		}
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 2rem;
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			border-color var(--t),
			color var(--t),
			background var(--t);
	}

	.action-btn:hover {
		border-color: var(--text-3);
		color: var(--text);
	}

	.save-btn:hover {
		border-color: var(--live-dim);
		color: var(--live);
	}

	.play-btn:hover {
		border-color: var(--live-dim);
		color: var(--live);
		background: rgba(110, 231, 192, 0.1);
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

	.mosh-setting-row input[type='range'] {
		flex: 1;
		height: 3px;
		appearance: none;
		background: var(--sunken);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.mosh-setting-row input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		background: var(--text-2);
		cursor: pointer;
	}

	.mosh-setting-row input[type='checkbox'] {
		appearance: none;
		width: 14px;
		height: 14px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		background: var(--sunken);
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
	}

	.mosh-setting-row input[type='checkbox']:hover {
		border-color: var(--text-3);
	}

	.mosh-setting-row input[type='checkbox']:checked {
		background: rgba(110, 231, 192, 0.15);
		border-color: var(--live-dim);
	}

	.mosh-setting-row input[type='checkbox']:checked::after {
		content: '';
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6l2.5 2.5 4.5-5' stroke='%236ee7c0' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			center/contain no-repeat;
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
		content: '';
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
