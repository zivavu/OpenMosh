<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		Download,
		HelpCircle,
		Home,
		Library,
		Maximize,
		MicVocal,
		Plus,
		Trash2,
		Type,
	} from 'lucide-svelte';
	import { fileDrop } from '../../actions/file-drop';
	import { createAudioGraph, createOutputAudioGraph } from '../../audio/audio-controller';
	import { AudioManager } from '../../audio/audio-manager.svelte';
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
		saveSettings,
	} from '../../editor/settings';
	import {
		cloneEffectInstance,
		getDefinition,
		loadInitialEffects,
		setVolumeLink,
		type EffectInstance,
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
		type ResolvedTransition,
		type SegmentTransitionChange,
		type SequenceSegment,
		type SequenceSegmentMode,
		applyBpmToSegments,
	} from '../../editor/sequence';
	import { detectBpm } from '../../slideshow/bpm-detector';
	import { SequenceFrameDriver } from '../../editor/sequence-frames';
	import { SequenceSourceRegistry } from '../../editor/sequence-sources.svelte';
	import {
		loadMediaPool,
		pruneSequenceMedia,
		saveMediaPool,
	} from '../../editor/sequence-media-store';
	import {
		applyTransitionChanges,
		clearSegments,
		fillSegmentsFromPreset,
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
	import SequenceTimeline from './SequenceTimeline.svelte';
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


	let format = $state<'png' | 'jpg' | 'webm'>(isMobile ? 'png' : 'webm');
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
	let effects: EffectInstance[] = $state(loadInitialEffects());

	const saved = loadSettings();
	let moshMin = $state(saved.moshMin ?? DEFAULT_SETTINGS.moshMin);
	let moshMax = $state(saved.moshMax ?? DEFAULT_SETTINGS.moshMax);
	let randomizeOrder = $state(saved.randomizeOrder ?? DEFAULT_SETTINGS.randomizeOrder);
	let showMoshSettings = $state(false);
	let moshAudioLink = $state(saved.moshAudioLink ?? DEFAULT_SETTINGS.moshAudioLink);
	let moshAudioLinkStrength = $state(
		saved.moshAudioLinkStrength ?? DEFAULT_SETTINGS.moshAudioLinkStrength,
	);
	let autoRangeAmount = $state(
		saved.autoRangeAmount ?? DEFAULT_SETTINGS.autoRangeAmount,
	);
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
		getAutoRangeAmount: () => autoRangeAmount,
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
		autoRangeAmount;
		showFps;
		audio.outputVolume;
		audio.loopAudio;
		videoLoop;
		saveSettings({
			moshMin,
			moshMax,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			autoRangeAmount,
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
			hasAudio,
		};
	}

	// ── Sequence mode: timeline of preset/mosh segments over the video ───────
	// Only ever populated on the sequence route; single mode has no timeline.
	let sequenceSegments = $state<SequenceSegment[]>([]);
	let selectedSegmentId = $state<string | null>(null);

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
		const entry = seqStore.load(seqKeyPrefix + baseKey);
		if (entry !== null) return entry;
		return isSequenceMode ? seqStore.load(baseKey) : null;
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
		const key = seqStoreKey;
		if (!key) return;
		clearTimeout(seqSaveTimer);
		seqSaveTimer = setTimeout(() => {
			seqStore.save(key, { segments: segs, bpm, text });
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

	onMount(() => {
		if (!isSequenceMode) return;
		void (async () => {
			// Not persisted: the primary belongs to the editor session, never to
			// a song's pool, so storing it would write (possibly hundreds of MB
			// of) video into IndexedDB that nothing would ever read back.
			await sourceRegistry.add([file], { primary: true, persist: false });
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

	/** Segments pointing at a removed source fall back to the primary. */
	function removeSequenceSource(id: string) {
		if (sourceRegistry.get(id)?.primary) {
			showToast("The first source can't be removed", 'info');
			return;
		}
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

	function seqPlaying(): boolean {
		return seqMasterIsAudio ? audio.audioPlaying : videoIsPlaying;
	}

	/** Source under the playhead — or, while paused, under the selected segment,
	 * matching which chain the panel is editing. */
	function activeSourceId(): string | null {
		const primary = sourceRegistry.primaryId;
		if (!isSequenceMode) return primary;
		if (!seqPlaying() && selectedSegmentId) {
			const sel = sequenceSegments.find((s) => s.id === selectedSegmentId);
			if (sel) return sel.sourceId ?? primary;
		}
		const seg = findSegmentAt(
			sequenceSegments,
			seqMasterTime(),
			seqMasterDuration,
		);
		return seg?.sourceId ?? primary;
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
	// already keeps animating.
	let seqSourceAnimating = $derived(
		seqActiveSource?.kind === 'video' && !seqActiveSource.primary,
	);

	function driveSequenceSource(dt: number): boolean {
		if (!isSequenceMode) return false;
		return seqFrames.advance(activeSourceId(), dt);
	}

	/**
	 * Source the running transition is fading *out* of, or null when there
	 * isn't one or both sides draw from the same media (nothing to cross-fade,
	 * so the effect chains blend over one texture as before).
	 */
	function outgoingSourceId(): string | null {
		const tr = seqTransition;
		if (!tr) return null;
		const primary = sourceRegistry.primaryId;
		const segA = findSegmentAt(
			sequenceSegments,
			tr.boundaryTime - 0.001,
			seqMasterDuration,
		);
		const idA = segA?.sourceId ?? primary;
		return idA && idA !== activeSourceId() ? idA : null;
	}

	function driveOutgoingSource(dt: number): boolean {
		if (!isSequenceMode) return true;
		return seqFrames.advanceOutgoing(outgoingSourceId(), dt);
	}

	let seqCrossFades = $derived.by(() => outgoingSourceId() !== null);

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
	/** What is actually on screen right now. */
	let renderedEffects = $derived(seqPlaybackEffects ?? effects);
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

	// A hand-edit to a preset-filled segment: label gains a "*" and explicit
	// preset overwrites stop clobbering it. Driven by explicit edit callbacks
	// (not data watching) — the audio volume-link tick also mutates values.
	function markPanelSegmentEdited() {
		const seg = panelSelectedSegment();
		if (seg && !seg.modified) seg.modified = true;
	}

	function getPanelEffects(): EffectInstance[] {
		return panelSelectedSegment()?.effects ?? effects;
	}

	function setPanelEffects(v: EffectInstance[]) {
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

	/** Correcting the BPM retimes every segment whose spacing was set in beats. */
	function setSequenceBpm(bpm: number) {
		bpmEpoch++;
		sequenceBpm = bpm;
		const retimed = applyBpmToSegments(sequenceSegments, bpm);
		if (retimed !== sequenceSegments) seqBoundaries.commit(retimed);
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
		if (isSequenceMode) {
			seqBoundaries.redo();
			return;
		}
		moshSession.redoEdit();
	}

	function clearEffects() {
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

	let showExitConfirm = $state(false);

	function handleExit() {
		if (!onExit) return;
		if (recordingState.recording) {
			showToast(
				'Cancel or wait for the recording to finish before exiting',
				'error',
			);
			return;
		}
		if (moshSession.touched) {
			showExitConfirm = true;
			return;
		}
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
	let textTimeline = $state<TextTimeline>({ ...EMPTY_TEXT_TIMELINE });
	let selectedTextClipId = $state<string | null>(null);
	let lyricsOpen = $state(false);

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
								keys: ['Dbl-click', 'Ctrl+Click'],
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
	// header row each. The media bin is collapsed by default — a grid of chips is
	// the tallest thing in the stack and it's only needed while assigning sources
	// — and the choice is remembered.
	const BIN_KEY = 'openmosh-seq-bin-open';
	let binOpen = $state(readBinOpen());
	let sourceInput = $state<HTMLInputElement | undefined>(undefined);

	function readBinOpen(): boolean {
		try {
			return localStorage.getItem(BIN_KEY) === '1';
		} catch {
			return false;
		}
	}

	function toggleBin() {
		binOpen = !binOpen;
		try {
			localStorage.setItem(BIN_KEY, binOpen ? '1' : '0');
		} catch {
			// Private mode / storage blocked — remembered for this session only.
		}
	}

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
					autoRangeAmount,
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
		</div>

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

		<GlCanvas
			{imageSrc}
			effects={renderedEffects}
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
			suspended={recordingState.recording}
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
		/>

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
				accent={isSequenceMode ? 'purple' : 'blue'}
			>
				{#snippet toolbar()}
					{#if isSequenceMode && sequenceSources.length > 0}
						<div class="tl-tool-sep"></div>
						<button
							class="tl-tool-btn"
							class:active={binOpen}
							aria-expanded={binOpen}
							title="Show the pool of images and videos the segments draw from"
							onclick={toggleBin}
						>
							<Library size={12} /> Sources
							<span class="tl-tool-count">{sequenceSources.length}</span>
						</button>
						{#if sequenceSources.length > 1}
							<button
								class="tl-tool-btn danger"
								title="Remove every added source from this song"
								onclick={() => (showClearSourcesConfirm = true)}
							>
								<Trash2 size={11} />
							</button>
						{/if}
						<button
							class="tl-tool-btn"
							title="Add images or videos to the pool"
							onclick={() => sourceInput?.click()}
						>
							<Plus size={12} />
						</button>
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
						onRemoveTrack={clearTrack}
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
						onAddSources={isSequenceMode
							? (files) => void addSequenceSources(files)
							: undefined}
						onRemoveSource={isSequenceMode ? removeSequenceSource : undefined}
						onClearSources={isSequenceMode
							? () => (showClearSourcesConfirm = true)
							: undefined}
						{binOpen}
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
					bind:autoRangeAmount
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
					const seg = panelSelectedSegment();
					if (seg) {
						seg.label = preset.name;
						seg.presetName = preset.name;
						seg.modified = false;
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

	{#if showExitConfirm}
		<ConfirmDialog
			title="Return to upload?"
			message="This discards your current edits. Presets you've saved stay."
			confirmLabel="Discard and exit"
			cancelLabel="Keep editing"
			danger
			onConfirm={() => {
				showExitConfirm = false;
				onExit?.();
			}}
			onCancel={() => (showExitConfirm = false)}
		/>
	{/if}

	{#if showClearSourcesConfirm}
		<ConfirmDialog
			title="Clear all sources?"
			message="Every image and video you added to this song is removed, and its segments go back to the original source. The file you opened with stays, along with media that other songs still use."
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
	}

	.main-area {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		position: relative;
		min-width: 0;
	}

	.top-bar {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #2a2a2a;
		flex-shrink: 0;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
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
		background: rgba(18, 18, 18, 0.85);
		border: 1.5px solid #444;
		color: #888;
		cursor: pointer;
		flex-shrink: 0;
		padding: 0;
		box-sizing: border-box;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.help-btn:hover {
		border-color: #777;
		color: #ccc;
	}

	.help-btn.seq-active {
		border-color: #b08ad0;
		color: #d8b8f8;
	}

	@media (max-width: 800px) {
		.help-btn {
			width: 26px;
			height: 26px;
		}
	}

	.settings-divider {
		height: 1px;
		background: #333;
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

	.library-btn {
		display: none;
	}

	.library-btn:hover {
		border-color: #777;
		color: #ccc;
	}

	@media (max-width: 800px) {
		.action-bar {
			padding: 0.6rem 0.5rem;
			gap: 0.4rem;
		}

		.action-btn {
			padding: 0.6rem 1.2rem;
			font-size: 0.72rem;
		}

		.library-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 26px;
			height: 26px;
			border-radius: 50%;
			background: none;
			border: 1.5px solid #444;
			color: #888;
			cursor: pointer;
			flex-shrink: 0;
			padding: 0;
			box-sizing: border-box;
			transition:
				border-color 0.2s,
				color 0.2s;
		}
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 2rem;
		border: 1.5px solid #444;
		border-radius: 999px;
		background: transparent;
		color: #ccc;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}

	.action-btn:hover {
		border-color: #888;
		color: #fff;
		background: rgba(255, 255, 255, 0.04);
	}

	.mosh-setting-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.mosh-setting-row label,
	.rec-duration-label {
		font-size: 0.7rem;
		color: #888;
		min-width: 72px;
		flex-shrink: 0;
	}

	.mosh-setting-row input[type='range'] {
		flex: 1;
		height: 3px;
		appearance: none;
		background: #333;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.mosh-setting-row input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
	}

	.mosh-setting-row input[type='checkbox'] {
		appearance: none;
		width: 14px;
		height: 14px;
		border: 1px solid #555;
		border-radius: 2px;
		background: #1a1a1a;
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
	}

	.mosh-setting-row input[type='checkbox']:hover {
		border-color: #777;
	}

	.mosh-setting-row input[type='checkbox']:checked {
		background: #555;
		border-color: #888;
	}

	.mosh-setting-row input[type='checkbox']:checked::after {
		content: '';
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6l2.5 2.5 4.5-5' stroke='%23ddd' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			center/contain no-repeat;
	}

	.mosh-setting-row select {
		flex: 1;
		background: #1a1a1a;
		color: #aaa;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		font-size: 0.7rem;
		font-family: inherit;
		cursor: pointer;
		outline: none;
	}

	.mosh-setting-row select:focus {
		border-color: #555;
	}

	.mosh-setting-val {
		font-size: 0.7rem;
		color: #999;
		min-width: 20px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.editor.drag-over::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 99;
		border: 2px dashed #888;
		border-radius: 8px;
		pointer-events: none;
	}

	.rec-start-btn {
		margin-top: 0.25rem;
		padding: 0.45rem 1rem;
		border: 1.5px solid #c05050;
		border-radius: 6px;
		background: rgba(192, 80, 80, 0.1);
		color: #e88;
		font-size: 0.72rem;
		font-weight: 600;
		font-family: inherit;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.rec-start-btn:hover {
		background: rgba(192, 80, 80, 0.2);
		color: #faa;
	}

	.drop-overlay {
		position: absolute;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.drop-overlay span {
		font-size: 1.2rem;
		font-weight: 600;
		color: #ccc;
		letter-spacing: 0.04em;
	}

	@media (max-width: 800px) {
		.main-area {
			padding-bottom: 44px;
		}
	}
</style>
