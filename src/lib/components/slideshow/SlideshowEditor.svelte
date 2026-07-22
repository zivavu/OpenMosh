<script lang="ts">
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
	import { beatAtTime } from '../../slideshow/beat-clock';
	import { detectBpm } from '../../slideshow/bpm-detector';
	import {
		cloneEffects,
		computeEffectsForBeat,
	} from '../../slideshow/sequencer';
	import { executeSlideshowRecording } from '../../slideshow/slideshow-recorder';
	import type { SlideshowConfig, SlideshowSlide } from '../../slideshow/types';
	import { DEFAULT_SLIDESHOW_CONFIG } from '../../slideshow/types';
	import {
		probeSlideVideo,
		SlideVideoSampler,
	} from '../../slideshow/video-sampler';
	import { showToast } from '../ui/toast.svelte';
	import { DEFAULT_TEXT_OVERLAY_STYLE, parsePhrases } from '../../text-overlay';
	import { shuffleInPlace } from '../../utils';
	import GlCanvas from '../editor/GlCanvas.svelte';
	import RecordOverlay from '../editor/RecordOverlay.svelte';
	import AudioTimeline from '../ui/AudioTimeline.svelte';
	import EffectsPanel from '../ui/EffectsPanel.svelte';
	import MobileSheet from '../ui/MobileSheet.svelte';
	import TrackAddBar from '../ui/TrackAddBar.svelte';
	import TrackLibrary from '../ui/TrackLibrary.svelte';
	import SlideshowActionBar from './SlideshowActionBar.svelte';
	import SlideshowConfigPanel from './SlideshowConfigPanel.svelte';
	import SlideshowGridView from './SlideshowGridView.svelte';
	import SlideshowTopBar from './SlideshowTopBar.svelte';
	import { AudioManager } from '../../audio/audio-manager.svelte';
	import { createTrackStore } from '../../audio/track-persistence';
	import { createRecordingState } from '../../editor/recording-state.svelte';
	import { createEffectHistory } from '../../editor/history.svelte';
	import { generateMosh as generateMoshFn } from '../../editor/mosh';
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
		for (const file of Array.from(files)) {
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
			removeSlide(id);
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

	function removeSlide(id: string) {
		const i = slides.findIndex((s) => s.id === id);
		if (i === -1) return;
		const s = slides[i];
		URL.revokeObjectURL(s.objectUrl);
		if (s.thumbUrl && s.thumbUrl !== s.objectUrl)
			URL.revokeObjectURL(s.thumbUrl);
		slides.splice(i, 1);
		videoSamplers.get(id)?.dispose();
		videoSamplers.delete(id);
		samplerPromises.delete(id);
	}

	function reorderSlides(from: number, to: number) {
		const [item] = slides.splice(from, 1);
		slides.splice(to, 0, item);
	}

	function shuffleSlides() {
		shuffleInPlace(slides);
	}

	function handleExit() {
		if (!onExit) return;
		if (recordingState.recording) {
			alert('Please cancel or wait for the recording to finish before exiting.');
			return;
		}
		if (slides.length > 0 && !confirm('Discard current slideshow and return to upload?')) {
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

	// Same split as the single editor: ←/→ walk the moshes of the base chain,
	// Ctrl+Z/Y walk hand-edits to it. A mosh rebases the edit history onto the
	// new chain so an edit undo lands on the mosh you were tweaking.
	const history = createEffectHistory();
	const moshHistory = createEffectHistory();

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
	const savedOutputVolume =
		((loadConfig() as unknown as Record<string, unknown>).outputVolume as number) ?? 1;

	const audio = new AudioManager({
		getEffects: () =>
			previewPlaying && previewEffects.length > 0 ? previewEffects : effects,
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
	let previewBeatIndex = $state(-1);
	let previewEffects: EffectInstance[] = $state([]);
	let smoothState = $state<{ effects: EffectInstance[] } | null>(null);

	const previewPhrases = $derived(
		config.textOverlay?.enabled && config.textOverlay?.dictionary?.trim()
			? parsePhrases(config.textOverlay.dictionary, config.textOverlay.splitBy)
			: [],
	);
	const previewTextStyle = $derived(
		config.textOverlay?.style != null
			? { ...DEFAULT_TEXT_OVERLAY_STYLE, ...config.textOverlay.style }
			: null,
	);
	const previewTextChance = $derived(
		Math.max(0, Math.min(1, config.textOverlay?.chance ?? 0.8)),
	);
	const previewTextLayout = $derived(config.textOverlay?.layout ?? 'scattered');

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
		smoothState = { effects: cloneEffects(effects) };
		previewBeatIndex = -1;

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

		if (!previewPlaying) return;

		// Fresh run: video slides start from their beginning, like the export
		for (const sampler of videoSamplers.values()) sampler.reset();
		let lastVideoSlideId: string | null = null;
		let lastVideoTickMs = 0;

		if (audio.trackFile) {
			audio.playAudio();
			selectedSegmentId = null;
		}

		let lastTextUpdateTime = 0;
		const TEXT_OVERLAY_THROTTLE_MS = 100;

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

			const { index: beatIndex } = beatAtTime(
				Math.max(0, t),
				config.bpm,
				config.beatOffset,
				config.segments,
				config.subdivision,
			);

			// subdivision === 0 means stop — hold current slide, do not advance
			if (beatIndex === Number.MAX_SAFE_INTEGER) {
				glRenderer.render(
					previewEffects.length > 0 ? previewEffects : effects,
					performance.now() / 1000,
				);
				previewRafId = requestAnimationFrame(tick);
				return;
			}

			const slideIndex = config.loop
				? beatIndex % slides.length
				: Math.min(beatIndex, slides.length - 1);
			const slide = slides[slideIndex];

			const textRoll = ((beatIndex * 31) % 1000) / 1000;
			const showText =
				previewPhrases.length > 0 &&
				previewTextStyle &&
				glRenderer &&
				textRoll < previewTextChance;
			if (showText && glRenderer) {
				const now = performance.now() / 1000;
				const throttleSec = TEXT_OVERLAY_THROTTLE_MS / 1000;
				const shouldUpdateText =
					now - lastTextUpdateTime >= throttleSec || lastTextUpdateTime === 0;
				if (shouldUpdateText) {
					lastTextUpdateTime = now;
					const phrase =
						previewPhrases[beatIndex % previewPhrases.length] ?? null;
					const to = config.textOverlay;
					glRenderer.setTextOverlay(phrase, previewTextStyle, {
						layout: previewTextLayout,
						seed: beatIndex,
						blendMode: to?.blendMode ?? 'normal',
						invert: to?.invert ?? false,
						opacity: to?.opacity ?? 1,
					});
				}
			} else if (glRenderer) {
				glRenderer.setTextOverlay(null);
			}

			if (beatIndex !== previewBeatIndex && slide) {
				previewBeatIndex = beatIndex;

				if (slide.kind === 'image') {
					const img = getCachedImage(slide);
					if (img && img.complete) {
						glRenderer.updateSourceImage(img);
					}
				}

				previewEffects = computeEffectsForBeat(
					config,
					slide,
					effects,
					smoothState!,
					getMoshOptions(),
				);
			}

			// Video slides advance only while visible: resume position across
			// appearances, dt = rAF delta while the same slide stays on screen.
			if (slide?.kind === 'video') {
				const sampler = videoSamplers.get(slide.id);
				const nowMs = performance.now();
				if (sampler) {
					const dt =
						lastVideoSlideId === slide.id
							? (nowMs - lastVideoTickMs) / 1000
							: 0;
					void sampler.next(dt).then((frame) => {
						if (frame) {
							if (previewPlaying && glRenderer)
								glRenderer.updateSourceFrame(frame);
							frame.close();
						}
					});
				}
				lastVideoSlideId = slide.id;
				lastVideoTickMs = nowMs;
			} else {
				lastVideoSlideId = null;
			}

			const activeEffects =
				previewEffects.length > 0 ? previewEffects : effects;
			const now = performance.now() / 1000;

			glRenderer.render(activeEffects, now);

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
		previewBeatIndex = -1;
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
			audioSampleRate: audio.audioSampleRate,
			frequencyData: audio.frequencyData,
		};
	}

	function generateMosh() {
		cancelPanelBurst();
		generateMoshFn(effects, getMoshOptions());
		moshHistory.push(effects);
		history.reset(effects);
	}

	/** → : forward through the mosh history, rolling a new mosh at its top. */
	function mosh() {
		const next = moshHistory.redo();
		if (!next) {
			generateMosh();
			return;
		}
		cancelPanelBurst();
		effects = next;
		history.reset(effects);
	}

	/** ← : back through the mosh history. Never touches the edit history. */
	function undoMosh() {
		const prev = moshHistory.undo();
		if (!prev) return;
		cancelPanelBurst();
		effects = prev;
		history.reset(effects);
	}

	function undo() {
		cancelPanelBurst();
		const prev = history.undo();
		if (prev) effects = prev;
	}

	function redo() {
		cancelPanelBurst();
		const next = history.redo();
		if (next) effects = next;
	}

	// Panel edits mutate the chain in place, so the post-edit state is pushed
	// once the burst settles — 500 ms of coalescing keeps a slider drag to one
	// undo entry.
	let panelBurstTimer: ReturnType<typeof setTimeout> | undefined;
	let panelBurstPending = false;

	function endPanelBurst() {
		clearTimeout(panelBurstTimer);
		panelBurstTimer = undefined;
		if (panelBurstPending) {
			panelBurstPending = false;
			history.push(effects);
		}
	}

	function cancelPanelBurst() {
		clearTimeout(panelBurstTimer);
		panelBurstTimer = undefined;
		panelBurstPending = false;
	}

	function panelBeforeEdit() {
		if (panelBurstTimer !== undefined) clearTimeout(panelBurstTimer);
		else panelBurstPending = true;
		panelBurstTimer = setTimeout(endPanelBurst, 500);
	}

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

	// ── Component refs ──
	let _mobileSheetRef: MobileSheet | undefined = undefined;

	// ── Keyboard ──
	function handleKeydown(e: KeyboardEvent) {
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLSelectElement ||
			e.target instanceof HTMLTextAreaElement
		)
			return;
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();
		if (e.code === 'Space') {
			e.preventDefault();
			togglePreview();
		} else if (e.code === 'Escape' && previewPlaying) {
			stopPreview();
		} else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
			e.preventDefault();
			redo();
		} else if (mod && key === 'z') {
			e.preventDefault();
			undo();
		} else if (mod) {
			// Leave every other modifier combo (copy, paste, save…) to the browser.
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			mosh();
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			undoMosh();
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
		const files = e.dataTransfer?.files;
		if (!files || files.length === 0) return;
		const first = files[0];
		if (first.type.startsWith('audio/')) {
			clearTrack();
			audio.trackFile = first;
		} else {
			addFiles(files);
		}
	}}
>
	<TrackLibrary
		activeTrackName={audio.trackFile?.name ?? null}
		onLoadTrack={onLibraryLoadTrack}
		onPlay={() => startPreview()}
		onPause={stopPreview}
		mainPlaying={audio.audioPlaying}
		pendingTrack={audio.trackFile}
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
					panelBeforeEdit();
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
