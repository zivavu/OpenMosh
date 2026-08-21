<script lang="ts">
	import { tick as domSettled, untrack } from 'svelte';
	import { fileDrop } from '../../actions/file-drop';
	import { readJson, writeJson } from '../../storage';
	import {
		generateId,
		loadInitialEffects,
		loadPresets,
		setVolumeLink,
		type EffectInstance,
		type Preset,
	} from '../../effects';
	import { MicVocal, Plus } from 'lucide-svelte';
	import {
		appendTextLane,
		chainLabels,
		createTextHistory,
		createTextTimeline,
		EMPTY_TEXT_TIMELINE,
		findTextClip,
		findTextClipLane,
		normalizeTextTimeline,
		resolveTextLayersAt,
		applyLyricsToTimeline,
		updateLane,
		type TextClip,
		type TextLane,
		type TextTimeline,
	} from '../../text';
	import type { LyricsSyncProps } from '../text/LyricsSyncModal.svelte';
	import TextTimelineLane from '../text/TextTimeline.svelte';
	import TextClipPanel from '../text/TextClipPanel.svelte';
	import type { GlRenderer } from '../../gl/renderer';
	import { fitPreviewSize, measureDisplaySize } from '../../gl/preview-size';
	import { detectBpm } from '../../slideshow/bpm-detector';
	import { SlideshowFrameDriver } from '../../slideshow/frame-driver';
	import { executeSlideshowRecording } from '../../slideshow/slideshow-recorder';
	import type { SlideshowConfig, SlideshowSlide } from '../../slideshow/types';
	import { DEFAULT_SLIDESHOW_CONFIG } from '../../slideshow/types';
	import {
		probeSlideVideo,
		SlideVideoSampler,
	} from '../../slideshow/video-sampler';
	import { showToast } from '../ui/toast.svelte';
	import { shuffleInPlace } from '../../utils';
	import GlCanvas from '../editor/GlCanvas.svelte';
	import RecordOverlay from '../editor/RecordOverlay.svelte';
	import AudioTimeline from '../ui/AudioTimeline.svelte';
	import TimelineStack from '../ui/TimelineStack.svelte';
	import type { TimelineStackState } from '../../editor/timeline-stack.svelte';
	import TimelineSegments from './TimelineSegments.svelte';
	import EffectsPanel from '../ui/EffectsPanel.svelte';
	import MobileSheet from '../ui/MobileSheet.svelte';
	import TrackAddBar from '../ui/TrackAddBar.svelte';
	import TrackLibrary from '../ui/TrackLibrary.svelte';
	import SlideshowActionBar from './SlideshowActionBar.svelte';
	import SlideshowConfigPanel from './SlideshowConfigPanel.svelte';
	import SlideshowGridView from './SlideshowGridView.svelte';
	import SlideshowTopBar from './SlideshowTopBar.svelte';
	import { AudioManager } from '../../audio/audio-manager.svelte';
	import { DEFAULT_AUDIO_RESPONSE } from '../../audio/auto-range';
	import { createTrackStore } from '../../audio/track-persistence';
	import {
		loadRenderSettings,
		saveRenderSettings,
	} from '../../editor/render-settings';
	import { createRecordingState } from '../../editor/recording-state.svelte';
	import { createMoshSession } from '../../editor/mosh-session';
	import { PanelBurstController } from '../../editor/panel-burst';
	import {
		isInteractiveTarget,
		isTextEntryTarget,
	} from '../../editor/shortcut-target';
	import { DEFAULT_SETTINGS, loadSettings, updateSettings } from '../../editor/settings';
	import { saveSession } from '../../editor/sessions';
	import { pruneSequenceMedia } from '../../editor/sequence-media-store';

	interface Props {
		initialFiles: File[];
		initialAudioFile?: File | null;
		/** Library id of `initialAudioFile`, when it came from a saved session. */
		initialTrackId?: string | null;
		/** Config restored from a saved session, if reopened from one. */
		initialConfig?: SlideshowConfig | null;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: import('../../gl/renderer').GlRenderer | null;
		onExit?: () => void;
	}

	let {
		initialFiles,
		initialAudioFile = null,
		initialTrackId = null,
		initialConfig = null,
		warmCanvas = null,
		warmRenderer = null,
		onExit,
	}: Props = $props();

	// ── Slides ──
	let slides: SlideshowSlide[] = $state([]);

	function addFiles(files: FileList | File[]) {
		const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
		const videoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
		const all = Array.from(files);
		const skipped = all.filter(
			(f) => !imageTypes.includes(f.type) && !videoTypes.includes(f.type),
		);
		if (skipped.length > 0) {
			showToast(
				skipped.length === all.length
					? `Can't add ${skipped.length === 1 ? `"${skipped[0].name}"` : 'those files'}. Supported formats: PNG, JPG, WEBP, GIF, MP4, WEBM, MOV`
					: `Skipped ${skipped.length} unsupported file${skipped.length === 1 ? '' : 's'}`,
				skipped.length === all.length ? 'error' : 'info',
				6000,
			);
		}
		for (const file of all) {
			if (imageTypes.includes(file.type)) {
				const slide: SlideshowSlide = {
					id: generateId(),
					file,
					objectUrl: URL.createObjectURL(file),
					thumbUrl: null,
					presetIndex: null,
					kind: 'image',
				};
				slides.push(slide);
				generateThumb(slide.id, slide.file, slide.objectUrl);
			} else if (videoTypes.includes(file.type)) {
				const slide: SlideshowSlide = {
					id: generateId(),
					file,
					objectUrl: URL.createObjectURL(file),
					thumbUrl: null,
					presetIndex: null,
					kind: 'video',
				};
				slides.push(slide);
				void probeVideoSlide(slide.id, file);
			}
		}
	}

	/** Fill in duration/dimensions/thumb for a video slide, or reject it. */
	async function probeVideoSlide(id: string, file: File) {
		const probe = await probeSlideVideo(file);
		const i = slides.findIndex((s) => s.id === id);
		if (i === -1) return;
		if (!probe) {
			showToast(`Couldn't decode video "${file.name}"`, 'error');
			removeSlide(id, false);
			return;
		}
		const s = slides[i];
		s.duration = probe.duration;
		s.width = probe.width;
		s.height = probe.height;
		if (probe.thumb) s.thumbUrl = URL.createObjectURL(probe.thumb);
	}

	async function generateThumb(id: string, file: File, objectUrl: string) {
		const SIZE = 100;
		let thumbUrl: string;
		try {
			const full = await createImageBitmap(file);
			const scale = Math.max(SIZE / full.width, SIZE / full.height);
			const cropW = SIZE / scale;
			const cropH = SIZE / scale;
			const cropped = await createImageBitmap(
				full,
				(full.width - cropW) / 2,
				(full.height - cropH) / 2,
				cropW,
				cropH,
			);
			full.close();
			const resized = await createImageBitmap(cropped, {
				resizeWidth: SIZE,
				resizeHeight: SIZE,
				resizeQuality: 'medium',
			});
			cropped.close();
			const canvas = new OffscreenCanvas(SIZE, SIZE);
			canvas.getContext('2d')!.drawImage(resized, 0, 0);
			resized.close();
			const blob = await canvas.convertToBlob({
				type: 'image/jpeg',
				quality: 0.8,
			});
			thumbUrl = URL.createObjectURL(blob);
		} catch {
			thumbUrl = objectUrl;
		}
		const s = slides.find((s) => s.id === id);
		if (s) s.thumbUrl = thumbUrl;
	}

	/** How long a removed slide stays restorable — matches its toast's lifetime. */
	const UNDO_WINDOW_MS = 8000;

	interface PendingRemoval {
		slide: SlideshowSlide;
		index: number;
		timer: ReturnType<typeof setTimeout>;
	}
	/** Removed slides awaiting either an Undo or the end of the undo window.
	 * Their object URLs stay alive until then, so a restore is a plain re-insert. */
	const pendingRemovals = new Map<string, PendingRemoval>();

	function disposeSlide(s: SlideshowSlide) {
		URL.revokeObjectURL(s.objectUrl);
		if (s.thumbUrl && s.thumbUrl !== s.objectUrl)
			URL.revokeObjectURL(s.thumbUrl);
		videoSamplers.get(s.id)?.dispose();
		videoSamplers.delete(s.id);
		samplerPromises.delete(s.id);
		dropCachedImage(s.id);
	}

	/** `undoable: false` for removals the user didn't ask for (a failed decode). */
	function removeSlide(id: string, undoable = true) {
		const i = slides.findIndex((s) => s.id === id);
		if (i === -1) return;
		const [slide] = slides.splice(i, 1);
		if (!undoable) {
			disposeSlide(slide);
			return;
		}
		const timer = setTimeout(() => {
			pendingRemovals.delete(id);
			disposeSlide(slide);
		}, UNDO_WINDOW_MS);
		pendingRemovals.set(id, { slide, index: i, timer });
		showToast(`Removed "${slide.file.name}"`, 'info', UNDO_WINDOW_MS, {
			label: 'Undo',
			run: () => restoreSlide(id),
		});
	}

	function restoreSlide(id: string) {
		const pending = pendingRemovals.get(id);
		if (!pending) return;
		clearTimeout(pending.timer);
		pendingRemovals.delete(id);
		slides.splice(Math.min(pending.index, slides.length), 0, pending.slide);
	}

	function reorderSlides(from: number, to: number) {
		const [item] = slides.splice(from, 1);
		slides.splice(to, 0, item);
	}

	function shuffleSlides() {
		const previousOrder = slides.map((s) => s.id);
		shuffleInPlace(slides);
		showToast('Slides shuffled', 'info', UNDO_WINDOW_MS, {
			label: 'Undo',
			run: () => restoreOrder(previousOrder),
		});
	}

	/** Re-apply a saved id order; slides added or removed since are left at the end. */
	function restoreOrder(order: string[]) {
		const byId = new Map(slides.map((s) => [s.id, s]));
		const restored = order
			.map((id) => byId.get(id))
			.filter((s): s is SlideshowSlide => s !== undefined);
		const known = new Set(order);
		slides = [...restored, ...slides.filter((s) => !known.has(s.id))];
	}

	// ── Session ──
	// The image set and the config that was built around it are saved together,
	// so the upload screen can offer the whole slideshow back.
	let sessionSaveTimer: ReturnType<typeof setTimeout> | undefined;

	function saveSlideshowSession() {
		const files = slides.map((s) => s.file);
		if (files.length === 0) return;
		// Keyed by the song when there is one, so the session sits alongside the
		// segments and text already saved under that track id.
		void saveSession(
			'slideshow',
			files,
			{ config: $state.snapshot(config) as SlideshowConfig },
			currentTrackId,
		)
			.then(() => pruneSequenceMedia())
			.catch((e) => {
				// Swallowing this outright is what made the last failure invisible.
				if (import.meta.env.DEV) console.error('Slideshow session save failed:', e);
			});
	}

	$effect(() => {
		// Deep-read, discarded: naming `slides` and `config` alone subscribes to
		// the two references only, so changing a segment or a slide's preset —
		// which is most of the editing — would never re-arm the debounce.
		$state.snapshot(slides);
		$state.snapshot(config);
		// Loading a different song re-keys the session, so it has to re-save.
		currentTrackId;
		clearTimeout(sessionSaveTimer);
		sessionSaveTimer = setTimeout(saveSlideshowSession, 600);
		return () => clearTimeout(sessionSaveTimer);
	});

	function handleExit() {
		if (!onExit) return;
		if (recordingState.recording) {
			showToast(
				'Cancel or wait for the recording to finish before exiting',
				'error',
			);
			return;
		}
		// No confirm: the slideshow is saved as a session and offered back on
		// the upload screen, so leaving costs nothing.
		clearTimeout(sessionSaveTimer);
		saveSlideshowSession();
		onExit();
	}

	function setPresetIndex(slideId: string, presetIndex: number | null) {
		const s = slides.find((s) => s.id === slideId);
		if (s) s.presetIndex = presetIndex;
	}

	// svelte-ignore state_referenced_locally
	if (initialFiles.length > 0) {
		addFiles(initialFiles);
	}

	$effect(() => {
		return () => {
			for (const s of slides) {
				URL.revokeObjectURL(s.objectUrl);
				if (s.thumbUrl && s.thumbUrl !== s.objectUrl)
					URL.revokeObjectURL(s.thumbUrl);
			}
			// Slides still inside their undo window own live object URLs too
			for (const { slide, timer } of pendingRemovals.values()) {
				clearTimeout(timer);
				URL.revokeObjectURL(slide.objectUrl);
				if (slide.thumbUrl && slide.thumbUrl !== slide.objectUrl)
					URL.revokeObjectURL(slide.thumbUrl);
			}
			pendingRemovals.clear();
			for (const sampler of videoSamplers.values()) sampler.dispose();
			videoSamplers.clear();
			samplerPromises.clear();
		};
	});

	// ── Video slide samplers (shared decode engine for preview; export creates its own) ──
	const videoSamplers = new Map<string, SlideVideoSampler>();
	const samplerPromises = new Map<string, Promise<SlideVideoSampler | null>>();

	function ensureSampler(slide: SlideshowSlide): Promise<SlideVideoSampler | null> {
		let p = samplerPromises.get(slide.id);
		if (!p) {
			p = SlideVideoSampler.create(slide.file).then((s) => {
				if (s) videoSamplers.set(slide.id, s);
				return s;
			});
			samplerPromises.set(slide.id, p);
		}
		return p;
	}

	// ── Config ──
	const CONFIG_KEY = 'openmosh-slideshow-config';
	function loadConfig(): SlideshowConfig {
		// A reopened session carries its own config; the global key is only the
		// "whatever was set last" default for a brand-new slideshow.
		const restored = untrack(() => initialConfig);
		if (restored) {
			return {
				...DEFAULT_SLIDESHOW_CONFIG,
				...restored,
				text: normalizeTextTimeline(restored.text),
			};
		}
		const saved = readJson<Partial<SlideshowConfig> | null>(CONFIG_KEY, null);
		if (saved) {
			return {
				...DEFAULT_SLIDESHOW_CONFIG,
				...saved,
				text: normalizeTextTimeline(saved.text),
			};
		}
		return { ...DEFAULT_SLIDESHOW_CONFIG };
	}
	let config: SlideshowConfig = $state(loadConfig());

	$effect(() => {
		writeJson(CONFIG_KEY, { ...config, outputVolume: audio.outputVolume });
	});

	let currentTrackId = $state<string | null>(null);

	interface SegmentsEntry {
		segments: SlideshowConfig['segments'];
		bpm?: number;
		/** Absent on entries saved before the text timeline existed. */
		text?: TextTimeline;
		spanStart?: number;
		spanEnd?: number;
	}

	const segmentsStore = createTrackStore<SegmentsEntry>(
		'openmosh-track-segments',
		// Backward compat: old format stored the segments array directly
		(raw) => (Array.isArray(raw) ? { segments: raw } : (raw as SegmentsEntry)),
	);

	/**
	 * The span worth writing back. Between adopting a track id and the audio
	 * element reporting its duration the live span reads 0/0, and persisting
	 * that would wipe the saved one for good if the metadata never lands. A
	 * restore still in flight is the real value; failing that, keep whatever
	 * was already stored rather than replacing it with an empty span.
	 */
	function spanForSave(trackId: string): Pick<SegmentsEntry, 'spanStart' | 'spanEnd'> {
		const pending = audio.pendingSpan;
		if (pending) return { spanStart: pending.start, spanEnd: pending.end };
		if (audio.trackDuration > 0 && audio.spanEnd > audio.spanStart) {
			return { spanStart: audio.spanStart, spanEnd: audio.spanEnd };
		}
		const prev = segmentsStore.load(trackId);
		if (prev?.spanStart !== undefined && prev.spanEnd !== undefined) {
			return { spanStart: prev.spanStart, spanEnd: prev.spanEnd };
		}
		return {};
	}

	function saveSegments(trackId: string) {
		segmentsStore.save(trackId, {
			segments: config.segments,
			bpm: config.bpm,
			text: $state.snapshot(config.text) as TextTimeline,
			...spanForSave(trackId),
		});
	}

	function onConfigChange(next: SlideshowConfig) {
		// A tempo set by hand outranks a detection still running.
		if (next.bpm !== config.bpm) bpmEpoch++;
		config = next;
		if (currentTrackId) saveSegments(currentTrackId);
	}

	// Save span when user adjusts it while a library track is loaded
	$effect(() => {
		audio.spanStart;
		audio.spanEnd;
		if (currentTrackId) saveSegments(currentTrackId);
	});

	let selectedSegmentId = $state<string | null>(null);

	// ── Effects ──
	let effects: EffectInstance[] = $state(loadInitialEffects());
	let presets: Preset[] = $state(loadPresets());

	const moshSession = createMoshSession({
		getEffects: () => effects,
		setEffects: (v) => (effects = v),
		getMoshOptions,
		cancelBurst: () => panelBurst.cancel(),
		endBurst: () => panelBurst.end(),
	});

	// ── Canvas / Renderer ──
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let glRenderer: GlRenderer | null = $state(null);
	let naturalWidth = $state<number | undefined>(undefined);
	let naturalHeight = $state<number | undefined>(undefined);
	let currentFps = $state(0);
	let showFps = $state(loadSettings().showFps ?? DEFAULT_SETTINGS.showFps);
	// GlCanvas is externally driven here, so its own counter never ticks — the
	// preview loop below feeds this one instead.
	let frameTimes: number[] = [];
	let lastFpsUpdate = 0;
	/** Only called while the overlay is on — see GlCanvas.trackFps. */
	function trackFps(now: number) {
		frameTimes.push(now);
		if (now - lastFpsUpdate < 400) return;
		lastFpsUpdate = now;
		frameTimes = frameTimes.filter((t) => t > now - 1000);
		currentFps = frameTimes.length;
	}
	$effect(() => {
		updateSettings({ showFps });
	});
	let resizeWidth = $state(0);
	let resizeHeight = $state(0);

	/** Set when a project restores its output size, so the slides finishing
	 * their load doesn't default it straight back to their own. Consumed once:
	 * media picked afterwards is a deliberate change and should win. */
	let sizeRestoredFromProject = false;

	$effect(() => {
		const nw = naturalWidth;
		const nh = naturalHeight;
		if (nw != null && nh != null && nw > 0 && nh > 0) {
			if (sizeRestoredFromProject) {
				sizeRestoredFromProject = false;
				return;
			}
			resizeWidth = nw;
			resizeHeight = nh;
		}
	});

	// Preview render size, decoupled from the output size (same as the single
	// editor). For image-first slides GlCanvas owns this; the video-first path
	// below drives the renderer directly and must apply it itself.
	let previewArea = $state<HTMLDivElement | null>(null);
	let displayW = $state(0);
	let displayH = $state(0);
	$effect(() => {
		const el = previewArea;
		if (!el) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const measure = () => {
			const { width, height } = measureDisplaySize(el);
			displayW = width;
			displayH = height;
		};
		measure();
		const ro = new ResizeObserver(() => {
			clearTimeout(timer);
			timer = setTimeout(measure, 150);
		});
		ro.observe(el);
		return () => {
			clearTimeout(timer);
			ro.disconnect();
		};
	});
	const previewRenderSize = $derived(
		fitPreviewSize(resizeWidth, resizeHeight, displayW, displayH),
	);

	// Size the preview canvas from the first slide, matching the export:
	// image → GlCanvas image loading; video → probed dimensions.
	let previewImageSrc = $state('');
	$effect(() => {
		const first = slides[0];
		if (!first) return;
		if (first.kind === 'image') {
			if (!previewImageSrc) previewImageSrc = first.objectUrl;
			return;
		}
		// Video-first: allocate the source texture from the probed dimensions
		// (width/height arrive async after the add-time probe).
		if (previewImageSrc || !glRenderer || naturalWidth != null) return;
		if (first.width && first.height) {
			glRenderer.initVideoSource(first.width, first.height);
			naturalWidth = first.width;
			naturalHeight = first.height;
			// Show the first frame instead of a blank canvas until play
			void ensureSampler(first).then(async (sampler) => {
				if (!sampler || !glRenderer || previewPlaying) return;
				const frame = await sampler.at(0);
				if (frame) {
					glRenderer.updateSourceFrame(frame);
					frame.close();
					glRenderer.render(effects, 0, currentTextLayers());
				}
			});
		}
	});

	// GlCanvas applies the preview size only after its own image/video load
	// (imageReady) — the video-first path above bypasses it, so apply here.
	// Also re-runs when recording ends (which resized the renderer to full
	// output res), restoring the smaller preview size.
	$effect(() => {
		recordingState.recording;
		if (previewImageSrc || !glRenderer || naturalWidth == null) return;
		if (previewRenderSize) {
			glRenderer.resize(previewRenderSize.width, previewRenderSize.height);
			if (!previewPlaying) glRenderer.render(effects, 0, currentTextLayers());
		}
	});

	// Image-first counterpart. GlCanvas uploads the texture and sizes the canvas
	// itself here, but it never draws: the slideshow owns rendering
	// (externallyDriven), so both its animation loop and its static redraw bail
	// out. Nothing else drew either, which left the preview black until playback
	// started. Sizing stays GlCanvas's job — this only supplies the frame.
	$effect(() => {
		recordingState.recording;
		if (!previewImageSrc || !glRenderer || naturalWidth == null) return;
		if (previewPlaying) return;
		// Re-draw after a resize, and on effect edits, so a stopped preview
		// reflects the panel the way the single editor's does.
		previewRenderSize;
		for (const e of effects) {
			e.enabled;
			for (const k of Object.keys(e.values)) e.values[k];
		}
		textTime;
		textTimeline;
		glRenderer.setBeat(beatsAt(textTime), config.bpm / 60);
		glRenderer.render(effects, 0, currentTextLayers());
	});

	// ── Audio ──
	// Load outputVolume from config before constructing manager
	const savedOutputVolume = loadConfig().outputVolume ?? 1;

	const audio = new AudioManager({
		// One group: the slideshow drives effects from beats, so there are no
		// per-lane responses to keep apart.
		getLinkGroups: () => [
			{
				scope: '',
				effects:
					previewPlaying && previewEffects.length > 0 ? previewEffects : effects,
				response: DEFAULT_AUDIO_RESPONSE,
			},
		],
		initialOutputVolume: savedOutputVolume,
		initialLoop: loadSettings().loopAudio ?? false,
	});

	function toggleLoop() {
		audio.loopAudio = !audio.loopAudio;
		updateSettings({ loopAudio: audio.loopAudio });
	}

	// Close the AudioContext on unmount so repeated visits don't leak contexts.
	$effect(() => () => audio.disposeAudioGraph());

	// Sync audioEl DOM binding into the manager
	let audioEl = $state<HTMLAudioElement | undefined>(undefined);
	$effect(() => { audio.setAudioEl(audioEl); });

	// Seed track from audio selected on the upload screen
	$effect(() => {
		if (initialAudioFile && !audio.trackFile) {
			audio.trackFile = initialAudioFile;
			// Reopened from a saved session: adopting the library id is what
			// brings its segments, BPM and text timeline back with it.
			if (initialTrackId) adoptLibraryTrack(initialTrackId);
		}
	});

	// ── Track file picker ──
	let trackInput: HTMLInputElement;

	function openTrackPicker() {
		trackInput?.click();
	}

	function onTrackInputChange() {
		const f = trackInput?.files?.[0];
		if (f) {
			// Drop the previous track's normalize gain until the auto-add
			// measurement reports the new track's own.
			audio.setNormalizeGain(1.0);
			audio.trackFile = f;
			trackInput.value = '';
		}
	}

	function clearTrack() {
		// Unloading is a song change too — onLibraryLoadTrack saves before
		// switching, and dropping the track has to do the same.
		if (currentTrackId) saveSegments(currentTrackId);
		audio.clearTrack();
		currentTrackId = null;
	}

	function onLibraryLoadTrack(file: File, trackId: string, autoplay = false) {
		stopPreview();
		if (currentTrackId) saveSegments(currentTrackId);
		// Partial audio reset — intentionally skip zeroing trackDuration and trackFile
		// so AudioTimeline stays mounted during the switch (avoids a remount flash).
		audio.resetPlayback();
		currentTrackId = null;
		audio.disposeAudioGraph();
		currentTrackId = trackId;
		audio.trackFile = file;
		applySavedSegments(trackId);
		if (autoplay) audio.autoplayOnLoad = true;
	}

	function applySavedSegments(trackId: string) {
		const saved = segmentsStore.load(trackId);
		if (saved === null) return;
		config = {
			...config,
			segments: saved.segments,
			...(saved.bpm !== undefined ? { bpm: saved.bpm } : {}),
			...(saved.text !== undefined
				? { text: normalizeTextTimeline(saved.text) }
				: {}),
		};
		if (saved.bpm !== undefined) {
			// The song brought its own tempo back: nothing to detect, and a
			// detection already running must not overwrite it.
			bpmEpoch++;
			bpmRestoredFor = trackId;
		}
		// An empty span is never something the user chose — it's an entry left
		// behind by an older build. Fall through to the whole track.
		if (
			saved.spanStart !== undefined &&
			saved.spanEnd !== undefined &&
			saved.spanEnd > saved.spanStart
		) {
			audio.pendingSpan = { start: saved.spanStart, end: saved.spanEnd };
		}
	}

	/** A track picked on the upload screen: the library reports its id once it
	 * has been saved, or straight away if it was already there. That id is what
	 * keys the segments, so restore against it too. */
	function adoptLibraryTrack(trackId: string) {
		if (currentTrackId === trackId) return;
		currentTrackId = trackId;
		applySavedSegments(trackId);
	}

	// ── BPM Detection ──
	let bpmDetecting = $state(false);
	let bpmDetectAbort: AbortController | null = $state(null);
	/** Bumped whenever the BPM is settled from elsewhere — a restored song, a
	 * typed correction. A detection that started before that yields to it. */
	let bpmEpoch = 0;
	/** The track the automatic pass has already been spent on. */
	let autoBpmFor: File | null = null;
	/** Track id whose saved BPM came back with it, so it needs no detection. */
	let bpmRestoredFor: string | null = null;

	// A new track detects its own tempo: everything here is cut to the beat, and
	// the default 120 is only right by accident.
	$effect(() => {
		const file = audio.trackFile;
		if (!file) return;
		untrack(() => {
			if (autoBpmFor === file) return;
			autoBpmFor = file;
			// A song reopened from the library brings its own BPM back.
			if (currentTrackId && bpmRestoredFor === currentTrackId) return;
			void runBpmDetection(true);
		});
	});

	async function runBpmDetection(auto = false) {
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
			config = { ...config, bpm: result.bpm, beatOffset: result.offset };
		} catch (e) {
			if (!(e instanceof DOMException && e.name === 'AbortError')) {
				console.error('BPM detection failed:', e);
				showToast(
					"Couldn't detect the BPM for this track. Set it by hand or use Tap.",
					'error',
					6000,
				);
			}
		} finally {
			bpmDetecting = false;
			bpmDetectAbort = null;
		}
	}

	// ── Preview ──
	let activeView: 'grid' | 'preview' = $state('grid');
	let previewPlaying = $state(false);
	let previewRafId = $state<number | null>(null);
	let previewEffects: EffectInstance[] = $state([]);
	let previewDriver: SlideshowFrameDriver | null = null;

	// ImageBitmaps, not <img>: uploading an <img> re-decodes it on every
	// texImage2D, which at 1/16 and 1/32 beats is most of a frame's budget.
	// A bitmap is already decoded, so the upload is a straight copy.
	const imageCache = new Map<string, ImageBitmap>();
	/** In-flight decodes, so a slide recurring before it lands isn't decoded twice. */
	const imageDecodes = new Map<string, Promise<void>>();

	/**
	 * Bitmaps are decoded at the size the preview actually draws, not the size
	 * the file happens to be: a pool of camera photos would neither fit in
	 * memory nor upload inside a frame at 1/32, and nothing above the preview's
	 * own resolution is visible anyway. Export is unaffected — the recorder
	 * decodes the originals itself.
	 *
	 * Rounded up to 512px steps so ordinary window resizing doesn't invalidate
	 * the whole cache.
	 */
	const bitmapCap = $derived(
		Math.max(
			1024,
			Math.ceil(
				Math.max(previewRenderSize?.width ?? 0, previewRenderSize?.height ?? 0) /
					512,
			) * 512,
		),
	);

	/** Backstop for pools too big to hold at preview size (~256 MB of RGBA). */
	const IMAGE_CACHE_PIXELS = 64_000_000;
	let cachedPixels = 0;
	/** Play position of the last slide asked for — eviction measures against it. */
	let lastRequestedIndex = 0;

	function dropCachedImage(id: string) {
		const bitmap = imageCache.get(id);
		if (!bitmap) return;
		cachedPixels -= bitmap.width * bitmap.height;
		bitmap.close();
		imageCache.delete(id);
	}

	function clearImageCache() {
		for (const id of [...imageCache.keys()]) dropCachedImage(id);
		cachedPixels = 0;
	}

	/** Cap the cached bitmaps were decoded against. */
	let cachedCap = 0;

	// Only a preview that outgrows the cached bitmaps forces a re-decode. A
	// shrinking one keeps them: oversized is still correct, and entering the
	// preview view resizes the canvas right as the pool finishes decoding.
	$effect(() => {
		const cap = bitmapCap;
		untrack(() => {
			if (cap <= cachedCap) return;
			clearImageCache();
			cachedCap = cap;
		});
	});

	function evictImages() {
		// Slides are played in order and on a loop, so the one to give up is the
		// one furthest ahead of the playhead — dropping the oldest would throw
		// out whatever is due next and decode the whole pool every cycle.
		while (cachedPixels > IMAGE_CACHE_PIXELS && imageCache.size > 4) {
			let victim: string | null = null;
			let furthest = -1;
			for (const id of imageCache.keys()) {
				const i = slides.findIndex((s) => s.id === id);
				const ahead =
					i < 0
						? Number.MAX_SAFE_INTEGER
						: (i - lastRequestedIndex + slides.length) % slides.length;
				if (ahead > furthest) {
					furthest = ahead;
					victim = id;
				}
			}
			if (!victim) break;
			dropCachedImage(victim);
		}
	}

	/** Decode a slide into the cache. Resolves once it is usable (or failed). */
	function loadSlideBitmap(slide: SlideshowSlide): Promise<void> {
		if (imageCache.has(slide.id)) return Promise.resolve();
		const pending = imageDecodes.get(slide.id);
		if (pending) return pending;
		const cap = bitmapCap;
		const job = fetch(slide.objectUrl)
			.then((r) => r.blob())
			.then((blob) => createImageBitmap(blob))
			.then(async (full) => {
				const scale = Math.min(1, cap / Math.max(full.width, full.height));
				if (scale >= 1) return full;
				const shrunk = await createImageBitmap(full, {
					resizeWidth: Math.max(1, Math.round(full.width * scale)),
					resizeHeight: Math.max(1, Math.round(full.height * scale)),
					resizeQuality: "high",
				});
				full.close();
				return shrunk;
			})
			.then((bitmap) => {
				// Dropped while decoding, or decoded against a cap that has since
				// changed — don't resurrect it or leak the bitmap.
				if (!slides.some((s) => s.id === slide.id) || cap < bitmapCap) {
					bitmap.close();
					return;
				}
				imageCache.set(slide.id, bitmap);
				cachedCap = Math.max(cachedCap, cap);
				cachedPixels += bitmap.width * bitmap.height;
				evictImages();
			})
			.catch(() => {})
			.finally(() => imageDecodes.delete(slide.id));
		imageDecodes.set(slide.id, job);
		return job;
	}

	function getCachedImage(slide: SlideshowSlide): ImageBitmap | undefined {
		const at = slides.indexOf(slide);
		if (at >= 0) lastRequestedIndex = at;
		const hit = imageCache.get(slide.id);
		if (hit) return hit;
		void loadSlideBitmap(slide);
		return undefined;
	}

	async function startPreview() {
		if (slides.length === 0) return;
		activeView = 'preview';
		previewPlaying = true;

		// Measure the preview box now rather than waiting on the ResizeObserver:
		// the canvas grows when the grid gives way, and a pool decoded against
		// the grid's smaller size would be thrown out mid-playback.
		await domSettled();
		if (previewArea) {
			const { width, height } = measureDisplaySize(previewArea);
			displayW = width;
			displayH = height;
		}

		await Promise.all([
			...slides.filter((s) => s.kind === 'image').map(loadSlideBitmap),
			...slides
				.filter((s) => s.kind === 'video')
				.map((slide) => ensureSampler(slide).then(() => {})),
		]);

		if (!previewPlaying || !glRenderer) return;

		// Fresh run: video slides start from their beginning, like the export
		for (const sampler of videoSamplers.values()) sampler.reset();

		if (audio.trackFile) {
			audio.playAudio();
			selectedSegmentId = null;
		}

		previewDriver?.dispose();
		const driver = new SlideshowFrameDriver({
			getConfig: () => config,
			getSlides: () => slides,
			baseEffects: effects,
			getMoshOptions,
			getRenderer: () => glRenderer!,
			sources: {
				getImage: getCachedImage,
				getSampler: (slide) => videoSamplers.get(slide.id),
			},
		});
		previewDriver = driver;
		// Raw reference of the chain last handed to `previewEffects`; comparing
		// against the $state proxy would never match, so this keeps the
		// assignment (and the reactivity it triggers) on beat changes only.
		let lastAppliedEffects: EffectInstance[] | null = null;

		function tick() {
			if (!previewPlaying || !glRenderer) return;

			let t: number;
			if (audio.trackFile && audio.audioPlaying) {
				audio.tickCurrentTime();
				t = audio.trackCurrentTime;
				if (t >= audio.spanEnd) {
					if (audio.loopAudio) {
						audio.seekTo(audio.spanStart);
						t = audio.spanStart;
					} else {
						stopPreview();
						return;
					}
				}
			} else {
				const fallbackInterval =
					config.subdivision === 0 ? 1 : (60 / config.bpm) * config.subdivision;
				t =
					((performance.now() / 1000) % (slides.length * fallbackInterval)) +
					config.beatOffset;
			}

			// The video-frame upload is left unawaited here: the render loop must
			// not stall on the decoder (the export awaits it instead).
			const nowMs = performance.now();
			if (showFps) trackFps(nowMs);
			const frame = driver.advance(t);
			if (frame.effects !== lastAppliedEffects) {
				lastAppliedEffects = frame.effects;
				previewEffects = frame.effects;
			}

			textTime = t;
			// Slideshow drives the renderer itself, so it owns this call too.
			glRenderer.setSpectrum(audio.frequencyData, nowMs / 1000);
			glRenderer.setBeat(beatsAt(t), config.bpm / 60);
			glRenderer.render(
				previewEffects.length > 0 ? previewEffects : effects,
				nowMs / 1000,
				currentTextLayers(),
			);

			previewRafId = requestAnimationFrame(tick);
		}

		previewRafId = requestAnimationFrame(tick);
	}

	function stopPreview() {
		previewPlaying = false;
		frameTimes = [];
		currentFps = 0;
		if (previewRafId !== null) {
			cancelAnimationFrame(previewRafId);
			previewRafId = null;
		}
		if (audio.audioPlaying) {
			audio.pauseAudio();
		}
		previewDriver?.dispose();
		previewDriver = null;
		previewEffects = [];
	}

	function togglePreview() {
		if (previewPlaying) stopPreview();
		else startPreview();
	}

	function addTextLane() {
		pushTextHistory();
		setTextTimeline(appendTextLane(textTimeline));
	}

	/** Scrubbing the shared timeline axis: the audio clock when there is a
	 * track, and the text lanes' own clock when the slideshow is silent. */
	function seekMaster(t: number) {
		textTime = t;
		if (audio.trackFile) audio.seekTo(t);
	}

	// ── Mosh ──
	function getMoshOptions() {
		return {
			moshMin: config.moshMin,
			moshMax: config.moshMax,
			randomizeOrder: true,
			moshAudioLink: config.moshAudioLink,
			moshAudioLinkStrength: config.moshAudioLinkStrength,
			hasAudio: !!audio.trackFile && !!audio.audioContext,
		};
	}

	// Panel edits mutate the chain in place, so the post-edit state is pushed
	// once the burst settles.
	const panelBurst = new PanelBurstController({
		onEditStart: () => () => moshSession.pushEdit(effects),
	});
	const endPanelBurst = () => panelBurst.end();
	const panelBeforeEdit = (coalesceKey?: string) =>
		panelBurst.beforeEdit(coalesceKey);

	// ── Recording ──
	let recordFps = $state(60);
	/** Export length for silent (no-track) recordings. */
	let recordDuration = $state(10);

	// Export settings ride with the song, and under their own mode prefix: the
	// same song sequenced in #editor keeps a separate set.
	let renderKey = $derived(currentTrackId && `slideshow:${currentTrackId}`);
	let renderKeyLoaded = $state<string | null>(null);

	$effect(() => {
		const key = renderKey;
		if (!key || untrack(() => renderKeyLoaded) === key) return;
		untrack(() => {
			renderKeyLoaded = key;
			const saved = loadRenderSettings(key);
			if (saved?.fps) recordFps = saved.fps;
			if (saved?.duration) recordDuration = saved.duration;
			if (saved?.width && saved?.height) {
				resizeWidth = saved.width;
				resizeHeight = saved.height;
				sizeRestoredFromProject = true;
			}
		});
	});

	$effect(() => {
		const key = renderKey;
		const fps = recordFps;
		const duration = recordDuration;
		const width = resizeWidth;
		const height = resizeHeight;
		// Until this song's own values are in, the live ones are the last song's.
		if (!key || renderKeyLoaded !== key) return;
		saveRenderSettings(key, {
			fps,
			duration,
			...(width > 0 && height > 0 ? { width, height } : {}),
		});
	});

	// ── Text timeline ──
	// Keyed to audio time, the same clock the beat driver runs on.
	let selectedTextClipId = $state<string | null>(null);
	let lyricsOpen = $state(false);
	let textTime = $state(0);
	const textHistory = createTextHistory();

	let textTimeline = $derived(config.text ?? EMPTY_TEXT_TIMELINE);
	let textDuration = $derived(
		audio.trackFile && audio.trackDuration > 0
			? audio.trackDuration
			: recordDuration,
	);
	let textChainLabels = $derived(chainLabels(effects));
	let selectedTextClip = $derived(findTextClip(textTimeline, selectedTextClipId));
	/** The lane holding the selected clip — the panel edits its style. */
	let selectedTextLane = $derived(
		findTextClipLane(textTimeline, selectedTextClipId),
	);

	/** Layers for whatever the preview is showing right now. */
	function currentTextLayers() {
		return resolveTextLayersAt(textTimeline, textTime);
	}

	/** Song-grid position of master time `t`, for beat-synced effects. */
	function beatsAt(t: number): number | null {
		if (config.bpm <= 0) return null;
		return ((t - config.beatOffset) * config.bpm) / 60;
	}

	function setTextTimeline(next: TextTimeline) {
		onConfigChange({ ...config, text: next });
	}

	function pushTextHistory(coalesceKey?: string) {
		textHistory.push(
			$state.snapshot(textTimeline) as TextTimeline,
			coalesceKey,
		);
	}

	function updateTextClip(next: TextClip) {
		setTextTimeline({
			...textTimeline,
			lanes: textTimeline.lanes.map((lane) => ({
				...lane,
				clips: lane.clips.map((c) => (c.id === next.id ? next : c)),
			})),
		});
	}

	function updateTextLane(next: TextLane) {
		setTextTimeline(updateLane(textTimeline, next.id, () => next));
	}

	function toggleTextTimeline() {
		pushTextHistory();
		setTextTimeline(
			textTimeline.enabled
				? { ...textTimeline, enabled: false }
				: textTimeline.lanes.length > 0
					? { ...textTimeline, enabled: true }
					: createTextTimeline(),
		);
		if (!textTimeline.enabled) {
			selectedTextClipId = null;
			lyricsOpen = false;
		}
	}


	/** Transport for the lyrics-sync modal: the preview drives the same audio
	 * clock the beats and text timeline run on. */
	let lyricsSync = $derived<LyricsSyncProps | null>(
		textTimeline.enabled
			? {
				isPlaying: previewPlaying,
				spanStart: audio.spanStart,
				spanEnd: audio.spanEnd,
				getCurrentTime: () => textTime,
				onPlay: () => void startPreview(),
				onPause: stopPreview,
				onSeek: (t) => {
					textTime = t;
					if (audio.trackFile) audio.seekTo(t);
				},
				onApply: applyLyrics,
			}
		: null,
	);

	/** Drop the synced lines into the lyrics lane and select the first one. */
	function applyLyrics(clips: TextClip[]) {
		if (clips.length === 0) return;
		pushTextHistory();
		setTextTimeline(applyLyricsToTimeline(textTimeline, clips));
		selectedTextClipId = clips[0].id;
	}
	const recordingState = createRecordingState();

	async function startRecording() {
		if (!canvasEl || !glRenderer || recordingState.recording || slides.length === 0)
			return;

		if (previewPlaying) stopPreview();

		await recordingState.run(
			(signal) =>
				executeSlideshowRecording({
					fps: recordFps,
					slides: [...slides],
					config,
					baseEffects: effects.map((e) => ({
						...e,
						values: { ...e.values },
						volumeLinks: e.volumeLinks
							? JSON.parse(JSON.stringify(e.volumeLinks))
							: undefined,
					})),
					audioFile: audio.trackFile,
					audioStart: audio.spanStart,
					audioEnd: audio.spanEnd,
					normalizeGain: audio.normalizeGain,
					noAudioDuration: recordDuration,
					canvas: canvasEl!,
					renderer: glRenderer!,
					outputWidth: resizeWidth > 0 ? resizeWidth : undefined,
					outputHeight: resizeHeight > 0 ? resizeHeight : undefined,
					moshOptions: getMoshOptions(),
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
				fallbackErrorMessage: 'Recording failed.',
			},
		);

		// Export resized the renderer to full output res — restore preview size.
		if (canvasEl && glRenderer) {
			if (previewRenderSize) {
				glRenderer.resize(previewRenderSize.width, previewRenderSize.height);
			}
			glRenderer.render(effects, performance.now() / 1000, currentTextLayers());
		}
	}

	function cancelRecording() {
		recordingState.cancel();
	}

	// ── Drag & Drop ──
	let dragging = $state(false);

	/** Audio replaces the track; anything else is added as slides. */
	function handleDroppedFiles(files: FileList) {
		if (files[0].type.startsWith('audio/')) {
			clearTrack();
			audio.trackFile = files[0];
		} else {
			addFiles(files);
		}
	}

	// ── Component refs ──
	let _mobileSheetRef: MobileSheet | undefined = undefined;

	// ── Keyboard ──
	/** The timeline's shared axis, once the stack is mounted — the C shortcut
	 * fires from the window, outside the context the stack puts it in. */
	let timelineAxis = $state<TimelineStackState | undefined>(undefined);

	function handleKeydown(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();

		// Undo/redo reach the app even while a dropdown or slider holds focus;
		// only a text field owns Ctrl+Z.
		if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
			// A selected text clip means the last thing edited was text.
			if (selectedTextClipId && textHistory.canRedo) {
				const next = textHistory.redo();
				if (next) setTextTimeline(next);
				return;
			}
			moshSession.redoEdit();
			return;
		}
		if (mod && key === 'z') {
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
			if (selectedTextClipId && textHistory.canUndo) {
				const prev = textHistory.undo();
				if (prev) setTextTimeline(prev);
				return;
			}
			moshSession.undoEdit();
			return;
		}
		// Leave every other modifier combo (copy, paste, save…) to the browser.
		if (mod) return;

		// Bare keys belong to whichever control has focus, if any.
		if (isInteractiveTarget(e.target)) return;

		if (e.code === 'Space') {
			e.preventDefault();
			togglePreview();
		} else if (e.code === 'Escape' && previewPlaying) {
			stopPreview();
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			moshSession.forward();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			moshSession.back();
		} else if (key === 'c' && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			if (timelineAxis) timelineAxis.followPlayhead = !timelineAxis.followPlayhead;
		}
	}
</script>

<svelte:window
	onkeydown={handleKeydown}
	onpointerdown={() => audio.audioContext?.resume()}
/>

{#if audio.trackObjectUrl}
	<audio
		bind:this={audioEl}
		src={audio.trackObjectUrl}
		onloadedmetadata={() => audio.onAudioLoadedMetadata()}
		onerror={() => showToast('Could not load this audio track', 'error')}
		ontimeupdate={() => audio.onAudioTimeUpdate()}
		onended={() => audio.onAudioEnded()}
		onplay={() => {
			audio.audioPlaying = true;
			// External playback (media keys) — bring the preview along
			if (!previewPlaying) startPreview();
		}}
		onpause={() => {
			audio.audioPlaying = false;
			if (previewPlaying) stopPreview();
		}}
		hidden
	></audio>
{/if}

<input
	bind:this={trackInput}
	type="file"
	accept="audio/*"
	onchange={onTrackInputChange}
	hidden
/>

<div
	class="editor"
	class:drag-over={dragging}
	use:fileDrop={{
		onDraggingChange: (d) => (dragging = d),
		onDrop: handleDroppedFiles,
	}}
>
	<TrackLibrary
		activeTrackName={audio.trackFile?.name ?? null}
		activeTrackId={currentTrackId}
		onLoadTrack={onLibraryLoadTrack}
		onUnloadTrack={clearTrack}
		onPlay={() => startPreview()}
		onPause={stopPreview}
		mainPlaying={audio.audioPlaying}
		pendingTrack={audio.trackFile}
		onNormalizeChange={(gain) => audio.setNormalizeGain(gain)}
		onAutoAdded={adoptLibraryTrack}
	/>
	<div class="main-area">
		<SlideshowTopBar
			{activeView}
			slideCount={slides.length}
			onViewChange={(view) => {
				activeView = view;
				if (view === 'grid' && previewPlaying) stopPreview();
			}}
			onExit={onExit ? handleExit : undefined}
		/>

		{#if activeView === 'grid'}
			<SlideshowGridView
				{slides}
				{config}
				{presets}
				onAddFiles={(files) => addFiles(files)}
				onRemoveSlide={removeSlide}
				onReorderSlides={reorderSlides}
				onShuffleSlides={shuffleSlides}
				onSetPresetIndex={setPresetIndex}
			/>
		{/if}
		<div
			class="preview-area"
			class:hidden={activeView === 'grid'}
			bind:this={previewArea}
		>
			<GlCanvas
				imageSrc={previewImageSrc}
				effects={previewPlaying && previewEffects.length > 0
					? previewEffects
					: effects}
				canvasWidth={resizeWidth || undefined}
				canvasHeight={resizeHeight || undefined}
				bind:canvasEl
				bind:glRenderer
				bind:naturalWidth
				bind:naturalHeight
				fps={currentFps}
				{showFps}
				freezeAnimation={!previewPlaying}
				suspended={recordingState.recording}
				externallyDriven
				{warmCanvas}
				{warmRenderer}
			/>
		</div>

		<SlideshowActionBar
			{previewPlaying}
			slidesEmpty={slides.length === 0}
			trackFile={audio.trackFile}
			bind:resizeWidth
			bind:resizeHeight
			{naturalWidth}
			{naturalHeight}
			recording={recordingState.recording}
			{recordFps}
			recordDuration={audio.trackFile && audio.trackDuration > 0
				? audio.spanEnd - audio.spanStart
				: recordDuration}
			textEnabled={textTimeline.enabled}
			onToggleText={toggleTextTimeline}
			onTogglePreview={togglePreview}
			onStartRecording={startRecording}
			bind:showFps
			onRecordFpsChange={(fps) => (recordFps = fps)}
			onRecordDurationChange={(d) => (recordDuration = d)}
		/>

		<RecordOverlay
			recording={recordingState.recording}
			recordProgress={recordingState.recordProgress}
			recordFinalizing={recordingState.recordFinalizing}
			onCancel={cancelRecording}
		/>

		<TimelineStack
			bind:axis={timelineAxis}
			trackDuration={textDuration}
			currentTime={textTime}
			isPlaying={previewPlaying}
			onTogglePlay={() => (previewPlaying ? stopPreview() : startPreview())}
			onSeek={seekMaster}
			loopEnabled={audio.loopAudio}
			onToggleLoop={audio.trackFile ? toggleLoop : null}
		>
			{#snippet toolbar()}
				{#if textTimeline.enabled}
					<div class="tl-tool-sep"></div>
					<span class="tl-tool-label">Text</span>
					<button class="tl-tool-btn" title="Add a text lane" onclick={addTextLane}>
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
			{/snippet}
			{#if audio.trackFile && audio.trackDuration > 0}
				<AudioTimeline
					layout="lane"
					label="AUD"
					trackDuration={audio.trackDuration}
					trackCurrentTime={audio.trackCurrentTime}
					spanStart={audio.spanStart}
					spanEnd={audio.spanEnd}
					isPlaying={previewPlaying}
					outputVolume={audio.outputVolume}
					onPlay={() => startPreview()}
					onPause={stopPreview}
					onSeek={seekMaster}
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
			{#if audio.trackFile && audio.trackDuration > 0}
				<TimelineSegments
					{config}
					{onConfigChange}
					bind:selectedSegmentId
					onSeek={seekMaster}
				/>
			{/if}
		</TimelineStack>
		{#if !audio.trackFile}
			<TrackAddBar
				onOpenPicker={openTrackPicker}
				hintText="Add music to sync transitions to the beat"
			/>
		{/if}
	</div>

	<MobileSheet bind:this={_mobileSheetRef}>
		{#snippet settings()}
			<SlideshowConfigPanel
				{config}
				{bpmDetecting}
				hasTrack={!!audio.trackFile}
				onDetectBpm={runBpmDetection}
				{onConfigChange}
				trackCurrentTime={audio.trackCurrentTime}
				trackDuration={audio.trackDuration}
			/>
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
					hasTrack={!!audio.trackFile}
					spectrumData={audio.spectrumData}
				/>
			{:else}
			<EffectsPanel
				bind:effects
				hasTrack={!!audio.trackFile}
				spectrumData={audio.spectrumData}
				onVolumeLinkChange={(index, paramKey, link) => {
					panelBeforeEdit(`link:${index}:${paramKey}`);
					effects = setVolumeLink(effects, index, paramKey, link);
				}}
				onBeforeUserEdit={panelBeforeEdit}
				onEffectsReplaced={endPanelBurst}
			/>
			{/if}
		{/snippet}
	</MobileSheet>

	{#if dragging}
		<div class="drop-overlay">
			<span>Drop to add images or replace audio</span>
		</div>
	{/if}

</div>

<style>
	.editor {
		display: flex;
		height: 100%;
		overflow: hidden;
	}

	.main-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	.preview-area {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: stretch;
		justify-content: center;
		overflow: hidden;
		background: #0a0a0a;
	}

	.preview-area.hidden {
		display: none;
	}

	.editor {
		position: relative;
	}

	.editor.drag-over::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 99;
		border: 2px dashed var(--text-3);
		border-radius: 8px;
		pointer-events: none;
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
		color: var(--text);
		letter-spacing: 0.04em;
	}

	@media (max-width: 800px) {
		.main-area {
			padding-bottom: 44px;
		}
	}
</style>
