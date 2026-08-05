<script lang="ts">
	import { fileDrop } from '../../actions/file-drop';
	import {
		generateId,
		loadInitialEffects,
		loadPresets,
		setVolumeLink,
		type EffectInstance,
		type Preset,
	} from '../../effects';
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
	import { ensureFontLoaded } from '../../text-overlay';
	import { shuffleInPlace } from '../../utils';
	import GlCanvas from '../editor/GlCanvas.svelte';
	import RecordOverlay from '../editor/RecordOverlay.svelte';
	import AudioTimeline from '../ui/AudioTimeline.svelte';
	import ConfirmDialog from '../ui/ConfirmDialog.svelte';
	import EffectsPanel from '../ui/EffectsPanel.svelte';
	import MobileSheet from '../ui/MobileSheet.svelte';
	import TrackAddBar from '../ui/TrackAddBar.svelte';
	import TrackLibrary from '../ui/TrackLibrary.svelte';
	import SlideshowActionBar from './SlideshowActionBar.svelte';
	import SlideshowConfigPanel from './SlideshowConfigPanel.svelte';
	import SlideshowGridView from './SlideshowGridView.svelte';
	import SlideshowTopBar from './SlideshowTopBar.svelte';
	import { AudioManager } from '../../audio/audio-manager.svelte';
	import { DEFAULT_AUTO_RANGE_AMOUNT } from '../../audio/auto-range';
	import { createTrackStore } from '../../audio/track-persistence';
	import { createRecordingState } from '../../editor/recording-state.svelte';
	import { createMoshSession } from '../../editor/mosh-session';
	import { PanelBurstController } from '../../editor/panel-burst';
	import {
		isInteractiveTarget,
		isTextEntryTarget,
	} from '../../editor/shortcut-target';
	import { loadSettings, updateSettings } from '../../editor/settings';

	interface Props {
		initialFiles: File[];
		initialAudioFile?: File | null;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: import('../../gl/renderer').GlRenderer | null;
		onExit?: () => void;
	}

	let {
		initialFiles,
		initialAudioFile = null,
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
					? `Can't add ${skipped.length === 1 ? `"${skipped[0].name}"` : 'those files'} — supported formats: PNG, JPG, WEBP, GIF, MP4, WEBM, MOV`
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
		imageCache.delete(s.id);
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
		if (slides.length > 0) {
			showExitConfirm = true;
			return;
		}
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
		try {
			const raw = localStorage.getItem(CONFIG_KEY);
			if (raw) return { ...DEFAULT_SLIDESHOW_CONFIG, ...JSON.parse(raw) };
		} catch {}
		return { ...DEFAULT_SLIDESHOW_CONFIG };
	}
	let config: SlideshowConfig = $state(loadConfig());

	$effect(() => {
		localStorage.setItem(
			CONFIG_KEY,
			JSON.stringify({ ...config, outputVolume: audio.outputVolume }),
		);
	});

	let currentTrackId = $state<string | null>(null);

	interface SegmentsEntry {
		segments: SlideshowConfig['segments'];
		bpm?: number;
		textOverlay?: SlideshowConfig['textOverlay'];
		spanStart?: number;
		spanEnd?: number;
	}

	const segmentsStore = createTrackStore<SegmentsEntry>(
		'openmosh-track-segments',
		// Backward compat: old format stored the segments array directly
		(raw) => (Array.isArray(raw) ? { segments: raw } : (raw as SegmentsEntry)),
	);

	function saveSegments(trackId: string) {
		segmentsStore.save(trackId, {
			segments: config.segments,
			bpm: config.bpm,
			textOverlay: config.textOverlay,
			spanStart: audio.spanStart,
			spanEnd: audio.spanEnd,
		});
	}

	function onConfigChange(next: SlideshowConfig) {
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
	let resizeWidth = $state(0);
	let resizeHeight = $state(0);

	$effect(() => {
		const nw = naturalWidth;
		const nh = naturalHeight;
		if (nw != null && nh != null && nw > 0 && nh > 0) {
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
				const frame = await sampler.next(0);
				if (frame) {
					glRenderer.updateSourceFrame(frame);
					frame.close();
					glRenderer.render(effects, 0);
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
			if (!previewPlaying) glRenderer.render(effects, 0);
		}
	});

	// ── Audio ──
	// Load outputVolume from config before constructing manager
	const savedOutputVolume = loadConfig().outputVolume ?? 1;

	const audio = new AudioManager({
		getEffects: () =>
			previewPlaying && previewEffects.length > 0 ? previewEffects : effects,
		// Unused here — the slideshow drives effects from beats, never volume links.
		getAutoRangeAmount: () => DEFAULT_AUTO_RANGE_AMOUNT,
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
		const saved = segmentsStore.load(trackId);
		if (saved !== null) {
			config = {
				...config,
				segments: saved.segments,
				...(saved.bpm !== undefined ? { bpm: saved.bpm } : {}),
				...(saved.textOverlay !== undefined
					? { textOverlay: saved.textOverlay }
					: {}),
			};
			if (saved.spanStart !== undefined && saved.spanEnd !== undefined) {
				audio.pendingSpan = { start: saved.spanStart, end: saved.spanEnd };
			}
		}
		if (autoplay) audio.autoplayOnLoad = true;
	}

	// ── BPM Detection ──
	let bpmDetecting = $state(false);
	let bpmDetectAbort: AbortController | null = $state(null);

	async function runBpmDetection() {
		if (!audio.trackFile || bpmDetecting) return;
		bpmDetecting = true;
		bpmDetectAbort = new AbortController();
		try {
			const result = await detectBpm(audio.trackFile, bpmDetectAbort.signal);
			config = { ...config, bpm: result.bpm, beatOffset: result.offset };
		} catch (e) {
			if (!(e instanceof DOMException && e.name === 'AbortError')) {
				console.error('BPM detection failed:', e);
				showToast(
					"Couldn't detect the BPM for this track — set it by hand or use Tap",
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

	// Load the configured overlay font (covers fonts restored from a saved config)
	$effect(() => {
		const family = config.textOverlay?.style?.fontFamily;
		if (family) void ensureFontLoaded(family);
	});

	const imageCache = new Map<string, HTMLImageElement>();
	const IMAGE_CACHE_SIZE = 12;

	function getCachedImage(slide: SlideshowSlide): HTMLImageElement | undefined {
		if (imageCache.has(slide.id)) return imageCache.get(slide.id);
		const img = new Image();
		img.src = slide.objectUrl;
		img.onload = () => {
			if (imageCache.size >= IMAGE_CACHE_SIZE) {
				const oldest = imageCache.keys().next().value;
				if (oldest) imageCache.delete(oldest);
			}
			imageCache.set(slide.id, img);
		};
		return undefined;
	}

	async function startPreview() {
		if (slides.length === 0) return;
		activeView = 'preview';
		previewPlaying = true;

		await Promise.all([
			...slides
				.filter((s) => s.kind === 'image')
				.map(
					(slide) =>
						new Promise<void>((resolve) => {
							if (imageCache.has(slide.id)) {
								resolve();
								return;
							}
							const img = new Image();
							img.onload = () => {
								imageCache.set(slide.id, img);
								resolve();
							};
							img.onerror = () => resolve();
							img.src = slide.objectUrl;
						}),
				),
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
		let lastTickMs = performance.now();
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
			const frame = driver.advance(t, (nowMs - lastTickMs) / 1000);
			lastTickMs = nowMs;
			if (frame.effects !== lastAppliedEffects) {
				lastAppliedEffects = frame.effects;
				previewEffects = frame.effects;
			}

			glRenderer.render(
				previewEffects.length > 0 ? previewEffects : effects,
				nowMs / 1000,
			);

			previewRafId = requestAnimationFrame(tick);
		}

		previewRafId = requestAnimationFrame(tick);
	}

	function stopPreview() {
		previewPlaying = false;
		if (previewRafId !== null) {
			cancelAnimationFrame(previewRafId);
			previewRafId = null;
		}
		if (audio.audioPlaying) {
			audio.pauseAudio();
		}
		if (glRenderer) {
			glRenderer.clearTextOverlay();
		}
		previewDriver?.dispose();
		previewDriver = null;
		previewEffects = [];
	}

	function togglePreview() {
		if (previewPlaying) stopPreview();
		else startPreview();
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
			glRenderer.render(effects, performance.now() / 1000);
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
	function handleKeydown(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();

		// Undo/redo reach the app even while a dropdown or slider holds focus;
		// only a text field owns Ctrl+Z.
		if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
			moshSession.redoEdit();
			return;
		}
		if (mod && key === 'z') {
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
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
		onPlay={() => startPreview()}
		onPause={stopPreview}
		mainPlaying={audio.audioPlaying}
		pendingTrack={audio.trackFile}
		onNormalizeChange={(gain) => audio.setNormalizeGain(gain)}
		onAutoAdded={(trackId) => (currentTrackId = trackId)}
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
				bind:fps={currentFps}
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
			onTogglePreview={togglePreview}
			onStartRecording={startRecording}
			onRecordFpsChange={(fps) => (recordFps = fps)}
			onRecordDurationChange={(d) => (recordDuration = d)}
		/>

		<RecordOverlay
			recording={recordingState.recording}
			recordProgress={recordingState.recordProgress}
			recordFinalizing={recordingState.recordFinalizing}
			onCancel={cancelRecording}
		/>

		{#if !audio.trackFile}
			<TrackAddBar
				onOpenPicker={openTrackPicker}
				hintText="Add music to sync transitions to the beat"
			/>
		{:else if audio.trackFile && audio.trackDuration > 0}
			<AudioTimeline
				label="AUD"
				trackDuration={audio.trackDuration}
				trackCurrentTime={audio.trackCurrentTime}
				spanStart={audio.spanStart}
				spanEnd={audio.spanEnd}
				isPlaying={previewPlaying}
				loopEnabled={audio.loopAudio}
				onToggleLoop={toggleLoop}
				outputVolume={audio.outputVolume}
				{config}
				bind:selectedSegmentId
				{onConfigChange}
				onPlay={() => startPreview()}
				onPause={stopPreview}
				onSeek={(t) => audio.seekTo(t)}
				onSpanStartChange={(t) => (audio.spanStart = t)}
				onSpanEndChange={(t) => (audio.spanEnd = t)}
				onVolumeChange={(v) => audio.setOutputVolume(v)}
				onRemoveTrack={clearTrack}
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
		{/snippet}
	</MobileSheet>

	{#if dragging}
		<div class="drop-overlay">
			<span>Drop to add images or replace audio</span>
		</div>
	{/if}

	{#if showExitConfirm}
		<ConfirmDialog
			title="Return to upload?"
			message="Your current slideshow will be discarded. Presets you've saved are kept."
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
		border: 2px dashed #888;
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
		color: #ccc;
		letter-spacing: 0.04em;
	}

	@media (max-width: 800px) {
		.main-area {
			padding-bottom: 44px;
		}
	}
</style>
