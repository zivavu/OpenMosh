<script lang="ts">
	import { untrack } from 'svelte';
	import { Download, HelpCircle, Home, Library, ListVideo } from 'lucide-svelte';
	import { createAudioGraph, createOutputAudioGraph } from '../../audio/audio-controller';
	import { AudioManager } from '../../audio/audio-manager.svelte';
	import { createTrackStore } from '../../audio/track-persistence';
	import { createKeyboardHandler } from '../../editor/keyboard';
	import {
		clearEffects as clearEffectsFn,
		generateMosh as generateMoshFn,
	} from '../../editor/mosh';
	import { executeRecording } from '../../editor/recording';
	import { createRecordingState } from '../../editor/recording-state.svelte';
	import { createEffectHistory } from '../../editor/history.svelte';
	import { loadSettings, saveSettings } from '../../editor/settings';
	import {
		applyPreset,
		cloneEffectInstance,
		loadInitialEffects,
		setVolumeLink,
		type EffectInstance,
		type Preset,
	} from '../../effects';
	import {
		cloneSegmentForSplit,
	createSequenceEffectSource,
	createSequenceSegment,
	resolveTransitionAt,
		findSegmentAt,
		randomSeed,
		type ResolvedTransition,
		type SegmentTransition,
		type SequenceSegment,
		type SequenceSegmentMode,
	} from '../../editor/sequence';
	import { SegmentBoundaryController } from '../../editor/segment-boundary-controller.svelte';
	import type { GlRenderer } from '../../gl/renderer';
	import { VideoPreviewPlayer } from '../../video-preview/preview-player.svelte';
	import AudioTimeline from '../ui/AudioTimeline.svelte';
	import EffectsPanel from '../ui/EffectsPanel.svelte';
	import GithubLink from '../ui/GithubLink.svelte';
	import ButtonGroup from '../ui/ButtonGroup.svelte';
	import MobileSheet from '../ui/MobileSheet.svelte';
	import ResizeSettings from '../ui/ResizeSettings.svelte';
	import TrackAddBar from '../ui/TrackAddBar.svelte';
	import TrackLibrary from '../ui/TrackLibrary.svelte';
	import GlCanvas from './GlCanvas.svelte';
	import SequenceTimeline from './SequenceTimeline.svelte';
	import MoshGroup from './MoshGroup.svelte';
	import MoshSettingsPanel from './MoshSettingsPanel.svelte';
	import RecordGroup from './RecordGroup.svelte';
	import RecordOverlay from './RecordOverlay.svelte';
	import ShortcutsModal from '../ui/ShortcutsModal.svelte';

	interface Props {
		file: File;
		onfile: (f: File) => void;
		initialAudioFile?: File | null;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: import('../../gl/renderer').GlRenderer | null;
		onExit?: () => void;
	}

	let {
		file,
		onfile,
		initialAudioFile = null,
		warmCanvas = null,
		warmRenderer = null,
		onExit,
	}: Props = $props();
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
			p.play();
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
	let moshMin = $state(saved.moshMin ?? 3);
	let moshMax = $state(saved.moshMax ?? 6);
	let randomizeOrder = $state(saved.randomizeOrder ?? true);
	let showMoshSettings = $state(false);
	let moshAudioLink = $state(saved.moshAudioLink ?? true);
	let moshAudioLinkStrength = $state(saved.moshAudioLinkStrength ?? 0.8);
	let showFps = $state(saved.showFps ?? false);
	let videoLoop = $state(saved.loopVideo ?? true);
	let showShortcuts = $state(false);

	let sequenceEnabled = $state(false);

	const shortcutGroups = $derived([
		{
			title: 'Shortcuts',
			shortcuts: [
				{ keys: ['→'], description: 'Redo if available, otherwise new mosh' },
				{ keys: ['←', 'Ctrl/Cmd+Z'], description: 'Undo' },
				{ keys: ['Ctrl/Cmd+Shift+Z', 'Ctrl/Cmd+Y'], description: 'Redo' },
				{ keys: ['Ctrl/Cmd+S'], description: 'Save current frame' },
				{ keys: ['Space'], description: 'Play / pause' },
				{ keys: ['V'], description: 'Re-input current frame' },
			],
		},
		...(sequenceEnabled
			? [
					{
						title: 'Sequence timeline',
						shortcuts: [
							{ keys: ['Dbl-click'], description: 'Create / split segment' },
							{ keys: ['Ctrl+Click'], description: 'Split segment at cursor' },
							{ keys: ['Click'], description: 'Select segment for editing' },
							{ keys: ['→'], description: 'Re-roll selected segment' },
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
							{ keys: ['Shift+Drag'], description: 'Rectangle-select boundaries' },
							{ keys: ['Ctrl/Cmd+C'], description: 'Copy selected boundaries' },
							{ keys: ['Ctrl/Cmd+V'], description: 'Paste boundaries' },
							{ keys: ['Scroll', 'Shift+Scroll'], description: 'Zoom / pan timeline' },
						],
					},
				]
			: []),
	]);

	const audio = new AudioManager({
		getEffects: () => effects,
		initialOutputVolume: saved.outputVolume ?? 1,
		initialLoop: saved.loopAudio ?? false,
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

	let normalizeGain = $state(1.0);

	// Sync audioEl DOM binding into the manager
	let audioEl = $state<HTMLAudioElement | undefined>(undefined);
	$effect(() => { audio.setAudioEl(audioEl); });

	// Seed track from audio selected on the upload screen
	$effect(() => {
		if (initialAudioFile && !audio.trackFile) {
			audio.trackFile = initialAudioFile;
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
			showFps,
			outputVolume: audio.outputVolume,
			loopAudio: audio.loopAudio,
			loopVideo: videoLoop,
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

	$effect(() => {
		const nw = naturalWidth;
		const nh = naturalHeight;
		if (nw != null && nh != null && nw > 0 && nh > 0) {
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
			normalizeGain = 1.0;
			audio.trackFile = f;
			trackInput.value = '';
		}
	}

	function clearTrack() {
		audio.clearTrack();
		currentTrackId = null;
		normalizeGain = 1.0;
	}

	function onLibraryLoadTrack(file: File, trackId: string, autoplay = false) {
		clearTrack();
		currentTrackId = trackId;
		audio.trackFile = file;
		const savedSpan = spanStore.load(trackId);
		if (savedSpan !== null) {
			audio.pendingSpan = { start: savedSpan.spanStart, end: savedSpan.spanEnd };
		}
		// Restore this track's saved sequence timeline; keep the current one when
		// the track has nothing saved yet.
		const savedSeq = seqStore.load(trackId);
		if (savedSeq !== null) {
			sequenceSegments = savedSeq.segments;
			sequenceEnabled = savedSeq.enabled;
			selectedSegmentId = null;
		}
		if (autoplay) audio.autoplayOnLoad = true;
	}

	function ensureVideoAudioGraph() {
		// Skip silent videos: there's nothing to hear or analyze, and capturing
		// them into Web Audio breaks the speed control in Firefox (see videoHasAudio).
		if (audio.audioContext || audio.trackFile || !videoHasAudio) return;
		if (previewPlayer) {
			// WebCodecs preview: sourceless graph, the player connects its own
			// AudioBufferSourceNode into normalizeGain.
			const state = createOutputAudioGraph();
			audio.applyAudioGraphState(state);
			audio.setNormalizeGain(normalizeGain);
			previewPlayer.attachAudioOutput(state.context, state.normalizeGain);
			state.context.resume().catch(() => {});
			return;
		}
		if (!videoEl) return;
		videoEl.muted = false;
		const state = createAudioGraph(videoEl);
		audio.applyAudioGraphState(state);
		audio.setNormalizeGain(normalizeGain);
		audio.audioContext!.resume().catch(() => {});
	}

	function playVideo() {
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

	function getMoshOptions() {
		return {
			moshMin,
			moshMax,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			hasAudio: !!audio.trackFile && !!audio.audioContext,
			audioSampleRate: audio.audioSampleRate,
			frequencyData: audio.frequencyData,
		};
	}

	// ── Sequence mode: timeline of preset/mosh segments over the video ───────
	// (sequenceEnabled is declared above the shortcut groups that read it)
	let sequenceSegments = $state<SequenceSegment[]>([]);
	let selectedSegmentId = $state<string | null>(null);

	// With an external track the audio is the master clock (matches export,
	// where the audio span sets the duration and the video loops inside it).
	// Segments then live on the audio timeline, not the video's.
	const seqStore = createTrackStore<{
		enabled: boolean;
		segments: SequenceSegment[];
	}>('openmosh-sequence');

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
		const playing =
			audio.audioPlaying ||
			(previewPlayer ? previewPlayer.playing : videoPlaying);
		if (playing) return;
		const segs = $state.snapshot(sequenceSegments) as SequenceSegment[];
		const enabled = sequenceEnabled;
		const trackId = currentTrackId;
		if (!trackId) return;
		clearTimeout(seqSaveTimer);
		seqSaveTimer = setTimeout(() => {
			seqStore.save(trackId, { enabled, segments: segs });
		}, 300);
	});

	let seqMasterIsAudio = $derived(!!audio.trackFile && audio.trackDuration > 0);
	let seqMasterDuration = $derived(
		seqMasterIsAudio ? audio.trackDuration : videoDuration,
	);

	function seqMasterTime(): number {
		if (seqMasterIsAudio) return audio.trackCurrentTime;
		return previewPlayer ? previewPlayer.currentTime : videoCurrentTime;
	}

	// Owns undo/redo + boundary selection/clipboard for every sequenceSegments
	// edit — timeline drags/splits (in SequenceTimeline.svelte) as well as
	// preset/mosh/mode changes made from the segment toolbar below, so Ctrl+Z
	// in SEQ mode undoes the last sequence edit regardless of where it came from.
	const seqBoundaries = new SegmentBoundaryController<SequenceSegment>({
		getSegments: () => sequenceSegments,
		getTrackDuration: () => seqMasterDuration,
		onChange: (segments) => (sequenceSegments = segments),
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

	function toggleSequence() {
		sequenceEnabled = !sequenceEnabled;
		if (!sequenceEnabled) {
			selectedSegmentId = null;
			return;
		}
		if (sequenceSegments.length === 0 && seqMasterDuration > 0) {
			// Seed the first segment from the current panel state; open-ended so
			// it stretches if the master timeline changes (e.g. a track is added)
			const seg = createSequenceSegment(0, null);
			seg.effects = effects.map(cloneEffectInstance);
			seg.label = 'current';
			sequenceSegments = [seg];
		}
	}

	// While audio is master the video must always loop its span, regardless of
	// the user's loop toggle — master positions past the video length land
	// inside the loop instead of on a paused last frame.
	let seqForceLoop = $derived(sequenceEnabled && seqMasterIsAudio);

	// Single playhead: audio master drives the video. Runs only on the ~4 Hz
	// audio clock ticks — video position/play-state are read untracked, so this
	// never re-runs per rendered frame (a reactive read of the video clock here
	// caused a seek storm that thrashed the decoder down to a few FPS).
	$effect(() => {
		if (!sequenceEnabled || !seqMasterIsAudio || !isVideo) return;
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
	let seqTransition = $state<ResolvedTransition | null>(null);
	$effect(() => {
		if (
			!sequenceEnabled ||
			sequenceSegments.length === 0 ||
			seqMasterDuration <= 0
		) {
			seqTransition = null;
			return;
		}
		const playing = seqMasterIsAudio
			? audio.audioPlaying
			: previewPlayer
				? previewPlayer.playing
				: videoPlaying;
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
		if (next && next !== lastSeqApplied) {
			lastSeqApplied = next;
			effects = next;
		}
	});

	// Fallback <video> path only (WebCodecs player ticks its own clock per
	// frame): pull the element clock into state while playing so the effect
	// above notices transition windows at frame rate, not at the 4 Hz
	// timeupdate cadence.
	$effect(() => {
		if (!sequenceEnabled || seqMasterIsAudio || previewPlayer || !videoPlaying)
			return;
		let raf = requestAnimationFrame(function loop() {
			videoCurrentTime = videoEl?.currentTime ?? 0;
			raf = requestAnimationFrame(loop);
		});
		return () => cancelAnimationFrame(raf);
	});

	function seqApplyPreset(segId: string, preset: Preset) {
		seqBoundaries.commit(
			sequenceSegments.map((s) =>
				s.id === segId
					? {
							...s,
							mode: 'static',
							label: preset.name,
							presetName: preset.name,
							modified: false,
							effects: applyPreset(preset),
						}
					: s,
			),
		);
	}

	// A preset was explicitly overwritten in the panel — refresh every static
	// segment that was filled from it, so segments track the newest version.
	// Hand-edited ("modified") segments keep their edits; overwriting a preset
	// never re-assigns it to the selected segment.
	function seqSyncPreset(preset: Preset) {
		sequenceSegments = sequenceSegments.map((s) =>
			s.mode === 'static' && s.presetName === preset.name && !s.modified
				? { ...s, label: preset.name, effects: applyPreset(preset) }
				: s,
		);
	}

	// Loop playback inside the selected segment (edit-while-playing aid).
	let seqSegmentLoop = $state(false);
	$effect(() => {
		if (!sequenceEnabled || !seqSegmentLoop || !selectedSegmentId) return;
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
		if (!sequenceEnabled || !selectedSegmentId) return null;
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

	function seqRoll(segId: string) {
		seqBoundaries.commit(
			sequenceSegments.map((s) => {
				if (s.id !== segId) return s;
				if (s.mode === 'interval') return { ...s, seed: randomSeed() };
				const fx = loadInitialEffects();
				generateMoshFn(fx, getMoshOptions());
				return {
					...s,
					label: 'mosh',
					presetName: undefined,
					modified: false,
					effects: fx,
				};
			}),
		);
	}

	function seqModeChange(
		segId: string,
		mode: SequenceSegmentMode,
		intervalSec?: number,
	) {
		seqBoundaries.commit(
			sequenceSegments.map((s) =>
				s.id === segId
					? {
							...s,
							mode,
							intervalSec: intervalSec ?? s.intervalSec ?? 0.25,
							seed: s.seed ?? randomSeed(),
						}
					: s,
			),
		);
	}

	function seqTransitionChange(
		segId: string,
		transition: SegmentTransition | null,
		transitionOnTick?: boolean,
	) {
		seqBoundaries.commit(
			sequenceSegments.map((s) =>
				s.id === segId
					? {
							...s,
							transition: transition ?? undefined,
							transitionOnTick: transitionOnTick ?? s.transitionOnTick,
						}
					: s,
			),
		);
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

	const history = createEffectHistory();
	let moshGroupRef: MoshGroup | undefined = $state(undefined);
	// svelte-ignore non_reactive_update
	let recordGroupRef: RecordGroup | undefined = undefined;
	let trackLibraryRef: TrackLibrary | undefined = undefined;

	function generateMosh() {
		generateMoshFn(effects, getMoshOptions());
		history.push(effects);
	}

	function mosh() {
		// Sequence mode: the mosh group is hidden, so the shortcut rolls the
		// selected (or playhead-active) segment via the timeline path instead.
		if (sequenceEnabled && sequenceSegments.length > 0) {
			const seg =
				(selectedSegmentId &&
					sequenceSegments.find((s) => s.id === selectedSegmentId)) ||
				findSegmentAt(sequenceSegments, seqMasterTime(), seqMasterDuration);
			if (seg) seqRoll(seg.id);
			return;
		}
		const next = history.redo();
		if (next) {
			effects = next;
		} else {
			generateMosh();
		}
	}

	function undo() {
		const prev = history.undo();
		if (prev) effects = prev;
	}

	function redo() {
		const next = history.redo();
		if (next) effects = next;
	}

	function clearEffects() {
		clearEffectsFn(effects);
		// In sequence mode the live effects can be the selected segment's own
		// array — a clear is a hand-edit to that segment.
		const seg = panelSelectedSegment();
		if (seg && seg.effects === effects) seg.modified = true;
		history.push(effects);
	}

	function handleExit() {
		if (!onExit) return;
		if (recordingState.recording) {
			alert('Please cancel or wait for the recording to finish before exiting.');
			return;
		}
		if (history.canUndo && !confirm('Discard current edits and return to upload?')) {
			return;
		}
		onExit();
	}

	function reInput() {
		if (!canvasEl) return;
		canvasEl.toBlob((blob) => {
			if (!blob) return;
			const newFile = new File([blob], `openmosh-reinput-${Date.now()}.png`, {
				type: 'image/png',
			});
			effects.forEach((e) => (e.enabled = false));
			history.reset(effects);
			onfile(newFile);
		}, 'image/png');
	}

	const handleKeydown = createKeyboardHandler({
		save,
		mosh,
		undo,
		redo,
		reInput,
		playSpan,
		pauseTrack,
		hasTrack: () => (!!audio.trackFile && !!audioEl) || isVideo,
		isPlaying: () =>
			audio.audioPlaying || videoPlaying || !!previewPlayer?.playing,
	});

	function save() {
		if (!canvasEl) return;
		const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
		const ext = format === 'jpg' ? 'jpg' : 'png';
		canvasEl.toBlob(
			(blob) => {
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
	}

	let showRecordSettings = $state(false);
	let recordDuration = $state(5);
	let recordFps = $state(60);
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
					normalizeGain,
					sequence:
						sequenceEnabled && sequenceSegments.length > 0
							? {
									segments: $state.snapshot(sequenceSegments) as SequenceSegment[],
									moshOptions: getMoshOptions(),
									duration: seqMasterDuration,
									masterIsAudio: seqMasterIsAudio,
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
				onError: (message) =>
					import('../../components/ui/toast.svelte').then(({ showToast }) =>
						showToast(message, 'error'),
					),
				fallbackErrorMessage:
					'Recording failed. Check the browser console for details.',
			},
		);

		// Resume playback after recording
		audio.playAudio();
		if (previewPlayer) previewPlayer.play();
		else if (isVideo && videoEl) videoEl.play().catch(() => {});
		if (canvasEl && glRenderer) {
			glRenderer.render(effects, performance.now() / 1000);
		}
	}

	function cancelRecording() {
		recordingState.cancel();
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



<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="editor"
	class:drag-over={dragging}
	ondragover={(e) => {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragging = true;
	}}
	ondragenter={(e) => {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={(e) => {
		if (
			e.currentTarget === e.target ||
			!e.currentTarget.contains(e.relatedTarget as Node)
		)
			dragging = false;
	}}
	ondrop={(e) => {
		e.preventDefault();
		dragging = false;
		const f = e.dataTransfer?.files[0];
		if (!f) return;
		if (f.type.startsWith('audio/')) {
			clearTrack();
			audio.trackFile = f;
		} else if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
			onfile(f);
		}
	}}
>
	<TrackLibrary
		bind:this={trackLibraryRef}
		activeTrackName={audio.trackFile?.name ?? null}
		activeTrackId={currentTrackId}
		onLoadTrack={onLibraryLoadTrack}
		onPlay={() => audio.playAudio()}
		onPause={() => audio.pauseAudio()}
		mainPlaying={audio.audioPlaying}
		pendingTrack={audio.trackFile}
		onNormalizeChange={(gain) => {
			normalizeGain = gain;
			audio.setNormalizeGain(gain);
		}}
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
			{effects}
			canvasWidth={resizeWidth || undefined}
			canvasHeight={resizeHeight || undefined}
			bind:canvasEl
			bind:glRenderer
			bind:naturalWidth
			bind:naturalHeight
			bind:fps={currentFps}
			showFps={showFps && !isImageFormat}
			videoEl={isVideo && !previewPlayer ? videoEl : null}
			frameSource={previewPlayer}
			freezeAnimation={isImageFormat}
			suspended={recordingState.recording}
			{warmCanvas}
			{warmRenderer}
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
				{#if seqMasterDuration > 0}
					<button
						class="help-btn"
						class:seq-active={sequenceEnabled}
						onclick={toggleSequence}
						title="Sequence timeline — different presets/moshes over time"
					>
						<ListVideo size={14} />
					</button>
				{/if}
				<MoshGroup
					bind:this={moshGroupRef}
					onMosh={mosh}
					onClear={clearEffects}
					onUndo={undo}
					canUndo={history.canUndo}
					canClear={history.canUndo}
					hideActions={sequenceEnabled}
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
		{#if seqMasterDuration > 0 && sequenceEnabled}
			<SequenceTimeline
				segments={sequenceSegments}
				trackDuration={seqMasterDuration}
				boundaries={seqBoundaries}
				currentTime={seqMasterIsAudio
					? audio.trackCurrentTime
					: previewPlayer
						? previewPlayer.currentTime
						: videoCurrentTime}
				onSeek={(t) => (seqMasterIsAudio ? seekTo(t) : seekVideoTo(t))}
				bind:selectedSegmentId
				onApplyPreset={seqApplyPreset}
				onRoll={seqRoll}
				onModeChange={seqModeChange}
				onTransitionChange={seqTransitionChange}
				segmentLoop={seqSegmentLoop}
				onToggleSegmentLoop={() => (seqSegmentLoop = !seqSegmentLoop)}
			/>
		{/if}
		<!-- One playhead in sequence mode with a track: hide the video transport,
		     the audio timeline below is the master -->
		{#if isVideo && videoDuration > 0 && !(sequenceEnabled && seqMasterIsAudio)}
			<AudioTimeline
				label="VID"
				trackDuration={videoDuration}
				trackCurrentTime={previewPlayer ? previewPlayer.currentTime : videoCurrentTime}
				spanStart={videoSpanStart}
				spanEnd={videoSpanEnd}
				isPlaying={previewPlayer ? previewPlayer.playing : videoPlaying}
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
		{#if !audio.trackFile}
			<TrackAddBar
				onOpenPicker={openTrackPicker}
				hintText="Add music to make effects react to the beat"
			/>
		{/if}
		{#if audio.trackFile && audio.trackDuration > 0}
			<AudioTimeline
				label="AUD"
				trackDuration={audio.trackDuration}
				trackCurrentTime={audio.trackCurrentTime}
				spanStart={audio.spanStart}
				spanEnd={audio.spanEnd}
				isPlaying={audio.audioPlaying}
				loopEnabled={audio.loopAudio}
				onToggleLoop={() => (audio.loopAudio = !audio.loopAudio)}
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
				/>
			</div>
		{/snippet}
		{#snippet effectsPanel()}
			<EffectsPanel
				bind:effects={getPanelEffects, setPanelEffects}
				hasTrack={!!audio.trackFile || (isVideo && !!audio.analyserNode)}
				spectrumData={audio.spectrumData}
				onVolumeLinkChange={(index, paramKey, link) => {
					setPanelEffects(setVolumeLink(getPanelEffects(), index, paramKey, link));
					markPanelSegmentEdited();
				}}
				onEffectsReplaced={() => {
					if (!sequenceEnabled) history.push(effects);
				}}
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
			/>
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
