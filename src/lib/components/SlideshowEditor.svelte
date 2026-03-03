<script lang="ts">
	import {
		applyVolumeLinksTick,
		computeVolumeLevel,
		createAudioGraph,
		disposeAudioGraph as disposeAudioGraphState,
	} from '../audio/audio-controller';
	import { formatTime } from '../audio/audio-utils';
	import {
		EFFECT_DEFINITIONS,
		createEffectInstance,
		loadPresets,
		type EffectInstance,
		type Preset,
		type VolumeLink,
	} from '../effects';
	import type { GlRenderer } from '../gl/renderer';
	import type { RecordFormat } from '../recorder';
	import { beatAtTime } from '../slideshow/beat-clock';
	import { detectBpm } from '../slideshow/bpm-detector';
	import { cloneEffects, computeEffectsForBeat } from '../slideshow/sequencer';
	import { executeSlideshowRecording } from '../slideshow/slideshow-recorder';
	import type {
		SlideshowConfig,
		SlideshowSlide,
	} from '../slideshow/types';
	import { DEFAULT_SLIDESHOW_CONFIG } from '../slideshow/types';
	import { DEFAULT_TEXT_OVERLAY_STYLE, parsePhrases } from '../text-overlay';
	import type { SpectrumData } from '../types';
	import EffectsPanel from './EffectsPanel.svelte';
	import GlCanvas from './GlCanvas.svelte';
	import RecordGroup from './RecordGroup.svelte';
	import RecordOverlay from './RecordOverlay.svelte';
	import SlideshowConfigPanel from './SlideshowConfigPanel.svelte';
	import SlideshowGridView from './SlideshowGridView.svelte';
	import TimelineSegments from './TimelineSegments.svelte';

	interface Props {
		initialFiles: File[];
		onBack: () => void;
	}

	let { initialFiles, onBack }: Props = $props();

	// ── Slides ──
	let slides: SlideshowSlide[] = $state([]);

	function addFiles(files: FileList | File[]) {
		const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
		const newSlides: SlideshowSlide[] = Array.from(files)
			.filter((f) => imageTypes.includes(f.type))
			.map((file) => ({
				id: crypto.randomUUID(),
				file,
				objectUrl: URL.createObjectURL(file),
				presetIndex: null,
			}));
		slides.push(...newSlides);
	}

	function removeSlide(id: string) {
		const i = slides.findIndex((s) => s.id === id);
		if (i === -1) return;
		URL.revokeObjectURL(slides[i].objectUrl);
		slides.splice(i, 1);
	}

	function reorderSlides(from: number, to: number) {
		const [item] = slides.splice(from, 1);
		slides.splice(to, 0, item);
	}

	function setPresetIndex(slideId: string, presetIndex: number | null) {
		const s = slides.find((s) => s.id === slideId);
		if (s) s.presetIndex = presetIndex;
	}

	// Init slides from initial files (run once at mount)
	if (initialFiles.length > 0) {
		addFiles(initialFiles);
	}

	// Cleanup on destroy
	$effect(() => {
		return () => {
			for (const s of slides) URL.revokeObjectURL(s.objectUrl);
		};
	});

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
		localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
	});

	function onConfigChange(next: SlideshowConfig) {
		config = next;
	}

	let selectedSegmentId = $state<string | null>(null);

	// ── Effects ──
	let effects: EffectInstance[] = $state(
		EFFECT_DEFINITIONS.map(createEffectInstance),
	);
	let presets: Preset[] = $state(loadPresets());

	function setVolumeLink(
		index: number,
		paramKey: string,
		link: VolumeLink | null,
	) {
		const e = effects[index];
		const nextLinks = e.volumeLinks ? { ...e.volumeLinks } : {};
		if (link === null) {
			delete nextLinks[paramKey];
		} else {
			nextLinks[paramKey] = link;
		}
		effects = effects.map((eff, i) =>
			i === index ? { ...eff, volumeLinks: nextLinks } : eff,
		);
	}

	// ── Canvas / Renderer ──
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let glRenderer: GlRenderer | null = $state(null);
	let naturalWidth = $state<number | undefined>(undefined);
	let naturalHeight = $state<number | undefined>(undefined);
	let currentFps = $state(0);
	let resizeWidth = $state(0);
	let resizeHeight = $state(0);
	let maintainRatio = $state(true);

	$effect(() => {
		const nw = naturalWidth;
		const nh = naturalHeight;
		if (nw != null && nh != null && nw > 0 && nh > 0) {
			resizeWidth = nw;
			resizeHeight = nh;
		}
	});

	const aspectRatio = $derived(
		naturalWidth != null && naturalHeight != null && naturalHeight > 0
			? naturalWidth / naturalHeight
			: 1,
	);

	const MAX_RESIZE = 10000;

	function setResizeWidth(w: number) {
		const val = Math.min(MAX_RESIZE, Math.max(1, Math.round(w)));
		resizeWidth = val;
		if (maintainRatio && aspectRatio > 0) {
			resizeHeight = Math.min(
				MAX_RESIZE,
				Math.max(1, Math.round(val / aspectRatio)),
			);
		}
	}

	function setResizeHeight(h: number) {
		const val = Math.min(MAX_RESIZE, Math.max(1, Math.round(h)));
		resizeHeight = val;
		if (maintainRatio && aspectRatio > 0) {
			resizeWidth = Math.min(
				MAX_RESIZE,
				Math.max(1, Math.round(val * aspectRatio)),
			);
		}
	}

	function resetResize() {
		if (naturalWidth != null && naturalHeight != null) {
			resizeWidth = naturalWidth;
			resizeHeight = naturalHeight;
		}
	}

	// Use first slide as default canvas source
	let previewImageSrc = $state('');
	$effect(() => {
		if (slides.length > 0 && !previewImageSrc) {
			previewImageSrc = slides[0].objectUrl;
		}
	});

	function selectSlide(slide: SlideshowSlide) {
		previewImageSrc = slide.objectUrl;
	}

	// ── Audio ──
	let trackFile = $state<File | null>(null);
	let trackObjectUrl = $state<string | null>(null);
	let trackInput: HTMLInputElement;

	$effect(() => {
		const f = trackFile;
		let url: string | null = null;
		if (f) {
			url = URL.createObjectURL(f);
			trackObjectUrl = url;
		} else {
			trackObjectUrl = null;
		}
		return () => {
			if (url) URL.revokeObjectURL(url);
		};
	});

	let audioEl = $state<HTMLAudioElement | undefined>(undefined);
	let trackDuration = $state(0);
	let trackCurrentTime = $state(0);
	let spanStart = $state(0);
	let spanEnd = $state(0);
	let audioPlaying = $state(false);
	let draggingHandle = $state<'start' | 'end' | null>(null);
	let timelineTrackEl = $state<HTMLDivElement | undefined>(undefined);

	let volumeLevel = $state(0);
	let frequencyData = $state<Uint8Array | null>(null);
	let audioSampleRate = $state(0);
	let audioFrequencyBinCount = $state(0);
	let audioContext = $state<AudioContext | null>(null);
	let analyserNode = $state<AnalyserNode | null>(null);
	let gainNode = $state<GainNode | null>(null);
	let outputVolume = $state(1);
	let mediaSource = $state<MediaElementAudioSourceNode | null>(null);

	function onAudioLoadedMetadata() {
		const d = audioEl?.duration;
		if (typeof d === 'number' && Number.isFinite(d)) {
			trackDuration = d;
			spanStart = 0;
			spanEnd = d;
		}
	}

	function onAudioTimeUpdate() {
		if (!audioEl) return;
		trackCurrentTime = audioEl.currentTime;
		if (audioPlaying && audioEl.currentTime >= spanEnd) {
			audioEl.pause();
			audioEl.currentTime = spanStart;
			trackCurrentTime = spanStart;
			audioPlaying = false;
		}
	}

	function ensureAudioGraph() {
		if (!audioEl || audioContext) return;
		const state = createAudioGraph(audioEl);
		audioContext = state.context;
		mediaSource = state.source;
		analyserNode = state.analyser;
		gainNode = state.gain;
		gainNode.gain.value = outputVolume;
		frequencyData = state.frequencyData;
		audioSampleRate = state.sampleRate;
		audioFrequencyBinCount = state.binCount;
	}

	function playAudio() {
		if (!trackFile || !trackObjectUrl || !audioEl) return;
		ensureAudioGraph();
		if (audioContext?.state === 'suspended') audioContext.resume();
		const t = audioEl.currentTime;
		if (t < spanStart || t >= spanEnd) {
			audioEl.currentTime = spanStart;
			trackCurrentTime = spanStart;
		}
		audioEl.play();
		audioPlaying = true;
		selectedSegmentId = null;
	}

	function pauseAudio() {
		audioEl?.pause();
		audioPlaying = false;
	}

	function seekTo(t: number) {
		if (!audioEl) return;
		const tClamp = Math.max(0, Math.min(trackDuration, t));
		audioEl.currentTime = tClamp;
		trackCurrentTime = tClamp;
	}

	function timeFromEvent(e: { clientX: number }): number {
		if (!timelineTrackEl) return 0;
		const rect = timelineTrackEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const pct = Math.max(0, Math.min(1, x / rect.width));
		return pct * trackDuration;
	}

	function onTimelinePointerDown(
		e: PointerEvent,
		handle: 'start' | 'end' | null,
	) {
		e.preventDefault();
		if (handle === 'start' || handle === 'end') {
			draggingHandle = handle;
			(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		} else {
			seekTo(timeFromEvent(e));
		}
	}

	$effect(() => {
		const handle = draggingHandle;
		if (handle === null) return;
		const move = (e: PointerEvent) => {
			if (!timelineTrackEl) return;
			const rect = timelineTrackEl.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const pct = Math.max(0, Math.min(1, x / rect.width));
			const t = pct * trackDuration;
			if (handle === 'start') {
				spanStart = Math.max(0, Math.min(t, spanEnd - 0.1));
			} else {
				spanEnd = Math.max(spanStart + 0.1, Math.min(trackDuration, t));
			}
		};
		const up = () => {
			draggingHandle = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		return () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
	});

	function disposeAudioGraph() {
		if (audioContext) {
			disposeAudioGraphState({
				context: audioContext,
				source: mediaSource!,
				analyser: analyserNode!,
				gain: gainNode!,
				frequencyData: frequencyData!,
				sampleRate: audioSampleRate,
				binCount: audioFrequencyBinCount,
			});
		}
		mediaSource = null;
		analyserNode = null;
		gainNode = null;
		frequencyData = null;
		audioSampleRate = 0;
		audioFrequencyBinCount = 0;
		audioContext = null;
		volumeLevel = 0;
	}

	function openTrackPicker() {
		trackInput?.click();
	}

	function onTrackInputChange() {
		const f = trackInput?.files?.[0];
		if (f) {
			trackFile = f;
			trackInput.value = '';
		}
	}

	function clearTrack() {
		if (audioEl) {
			audioEl.pause();
			audioPlaying = false;
		}
		trackFile = null;
		trackDuration = 0;
		trackCurrentTime = 0;
		spanStart = 0;
		spanEnd = 0;
		disposeAudioGraph();
	}

	// Audio volume tick
	$effect(() => {
		const analyser = analyserNode;
		if (!analyser) return;
		const timeData = new Uint8Array(analyser.fftSize);
		const freqDataRef = frequencyData;
		const sampleRate = audioSampleRate;
		const fftSize = analyser.fftSize;
		let rafId: number;
		function tick() {
			if (!analyser) return;
			volumeLevel = computeVolumeLevel(analyser, timeData);
			if (freqDataRef)
				analyser.getByteFrequencyData(freqDataRef as Uint8Array<ArrayBuffer>);
			applyVolumeLinksTick(
				effects,
				volumeLevel,
				freqDataRef,
				sampleRate,
				fftSize,
			);
			rafId = requestAnimationFrame(tick);
		}
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	});

	let spectrumData: SpectrumData | null = $derived(
		frequencyData && audioSampleRate > 0 && audioFrequencyBinCount > 0
			? {
					data: frequencyData,
					sampleRate: audioSampleRate,
					binCount: audioFrequencyBinCount,
					tick: volumeLevel,
				}
			: null,
	);

	// ── BPM Detection ──
	let bpmDetecting = $state(false);
	let bpmDetectAbort: AbortController | null = $state(null);

	async function runBpmDetection() {
		if (!trackFile || bpmDetecting) return;
		bpmDetecting = true;
		bpmDetectAbort = new AbortController();
		try {
			const result = await detectBpm(trackFile, bpmDetectAbort.signal);
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
	let previewStartAudioTime = $state(0);
	let previewBeatIndex = $state(-1);
	let previewEffects: EffectInstance[] = $state([]);
	let smoothState = $state({ effects: cloneEffects(effects) });

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

	// Image cache for preview
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

		// Pre-load all slide images before starting
		await Promise.all(
			slides.map(
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
		);

		// Check if preview was cancelled during loading
		if (!previewPlaying) return;

		if (audioEl && trackFile) {
			ensureAudioGraph();
			if (audioContext?.state === 'suspended') audioContext.resume();
			const t = audioEl.currentTime;
			if (t < spanStart || t >= spanEnd) {
				audioEl.currentTime = spanStart;
			}
			previewStartAudioTime = audioEl.currentTime;
			audioEl.play();
			audioPlaying = true;
		}

		let currentSlideId: string | null = null;
		let lastTextUpdateTime = 0;
		const TEXT_OVERLAY_THROTTLE_MS = 100;

		function tick() {
			if (!previewPlaying || !glRenderer) return;

			let t: number;
			if (audioEl && trackFile && audioPlaying) {
				t = audioEl.currentTime;
				if (t >= spanEnd) {
					stopPreview();
					return;
				}
			} else {
				const fallbackInterval = (60 / config.bpm) * config.subdivision;
				t = (performance.now() / 1000) % (slides.length * fallbackInterval);
			}

			const { index: beatIndex, fraction } = beatAtTime(
				Math.max(0, t),
				config.bpm,
				config.beatOffset,
				config.segments,
				config.manualSwitchPoints,
				config.subdivision,
			);
			const slideIndex = config.loop
				? beatIndex % slides.length
				: Math.min(beatIndex, slides.length - 1);
			const slide = slides[slideIndex];

			// Text overlay: throttle updates so 1/16 stays usable (~10 text updates/sec max)
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
					glRenderer.setTextOverlay(phrase, previewTextStyle, undefined, {
						layout: previewTextLayout,
						seed: beatIndex,
						blendMode: to?.blendMode ?? 'normal',
						invert: to?.invert ?? false,
					});
				}
			} else if (glRenderer) {
				glRenderer.setTextOverlay(null);
			}

			if (beatIndex !== previewBeatIndex && slide) {
				previewBeatIndex = beatIndex;

				// Switch source image immediately
				const img = getCachedImage(slide);
				if (img && img.complete) {
					glRenderer.updateSourceImage(img);
					currentSlideId = slide.id;
				}

				previewEffects = computeEffectsForBeat(
					config,
					slide,
					effects,
					smoothState,
					getMoshOptions(),
				);
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
		if (audioEl && audioPlaying) {
			audioEl.pause();
			audioPlaying = false;
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
			hasAudio: !!trackFile && !!audioContext,
			audioSampleRate,
			frequencyData,
		};
	}

	// ── Recording ──
	let recordFormat: RecordFormat = $state('webm');
	let recordFps = $state(24);
	let recording = $state(false);
	let recordProgress = $state(0);
	let recordFinalizing = $state(false);
	let recordAbort: AbortController | null = $state(null);
	let showRecordSettings = $state(false);
	let recordGroupRef = $state<RecordGroup>();
	let showOptionsPanel = $state(false);
	let optionsGroupEl: HTMLDivElement | undefined;

	let recordDuration = $derived(
		trackFile && trackDuration > 0 ? spanEnd - spanStart : 5,
	);

	async function startRecording() {
		if (!canvasEl || !glRenderer || recording || slides.length === 0) return;
		if (!trackFile) {
			alert('Please add an audio track for slideshow recording.');
			return;
		}
		showRecordSettings = false;
		recording = true;
		recordProgress = 0;
		recordFinalizing = false;
		const abort = new AbortController();
		recordAbort = abort;

		// Stop preview if running
		if (previewPlaying) stopPreview();

		try {
			await executeSlideshowRecording({
				format: recordFormat,
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
				audioFile: trackFile,
				audioStart: spanStart,
				audioEnd: spanEnd,
				canvas: canvasEl,
				renderer: glRenderer,
				outputWidth: resizeWidth > 0 ? resizeWidth : undefined,
				outputHeight: resizeHeight > 0 ? resizeHeight : undefined,
				moshOptions: getMoshOptions(),
				onProgress: (p) => {
					recordProgress = p;
				},
				onFinalizing: () => {
					recordFinalizing = true;
				},
				signal: abort.signal,
			});
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				// cancelled
			} else {
				console.error('Recording failed:', e);
				alert(e instanceof Error ? e.message : 'Recording failed.');
			}
		} finally {
			recording = false;
			recordFinalizing = false;
			recordAbort = null;
			if (canvasEl && glRenderer) {
				glRenderer.render(effects, performance.now() / 1000);
			}
		}
	}

	function cancelRecording() {
		recordAbort?.abort();
	}

	// ── Keyboard ──
	function handleKeydown(e: KeyboardEvent) {
		if (
			e.target instanceof HTMLInputElement ||
			e.target instanceof HTMLSelectElement ||
			e.target instanceof HTMLTextAreaElement
		)
			return;
		if (e.code === 'Space') {
			e.preventDefault();
			togglePreview();
		} else if (e.code === 'Escape' && previewPlaying) {
			stopPreview();
		}
	}
</script>

<svelte:window
	onkeydown={handleKeydown}
	onpointerdown={(e) => {
		audioContext?.resume();
		recordGroupRef?.handleClickOutside(e);
		if (
			showOptionsPanel &&
			optionsGroupEl &&
			!optionsGroupEl.contains(e.target as Node)
		) {
			showOptionsPanel = false;
		}
	}}
/>

{#if trackObjectUrl}
	<audio
		bind:this={audioEl}
		src={trackObjectUrl}
		onloadedmetadata={onAudioLoadedMetadata}
		ontimeupdate={onAudioTimeUpdate}
		onplay={() => (audioPlaying = true)}
		onpause={() => (audioPlaying = false)}
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

<div class="editor">
	<div class="main-area">
		<div class="top-bar">
			<div class="toolbar">
				<button class="back-btn" onclick={onBack} title="Back to upload">
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<line x1="19" y1="12" x2="5" y2="12" />
						<polyline points="12 19 5 12 12 5" />
					</svg>
				</button>

				<div class="view-toggle">
					<button
						class="view-btn"
						class:active={activeView === 'grid'}
						onclick={() => {
							activeView = 'grid';
							if (previewPlaying) stopPreview();
						}}
					>
						Grid
					</button>
					<button
						class="view-btn"
						class:active={activeView === 'preview'}
						onclick={() => {
							activeView = 'preview';
						}}
					>
						Preview
					</button>
				</div>

				<span class="slide-count">{slides.length} images</span>

				<div class="spacer"></div>

				{#if !trackFile}
					<button class="track-btn" onclick={openTrackPicker}>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M9 18V5l12-2v13" />
							<circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
						</svg>
						Add Audio
					</button>
				{:else}
					<button class="track-btn" onclick={clearTrack}>
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
						>
							<path d="M18 6L6 18" /><path d="M6 6l12 12" />
						</svg>
						Remove Audio
					</button>
				{/if}
			</div>
		</div>

		{#if activeView === 'grid'}
			<SlideshowGridView
				{slides}
				{config}
				{presets}
				onAddFiles={(files) => addFiles(files)}
				onRemoveSlide={removeSlide}
				onReorderSlides={reorderSlides}
				onSetPresetIndex={setPresetIndex}
				onSelectSlide={selectSlide}
			/>
		{:else}
			<div class="preview-area">
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
				/>
			</div>
		{/if}

		<div class="action-bar">
			<div class="options-group" bind:this={optionsGroupEl}>
				<button
					class="action-btn options-btn"
					onclick={() => (showOptionsPanel = !showOptionsPanel)}
					title="Preview size options"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="3" />
						<path
							d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
						/>
					</svg>
					OPTIONS
				</button>
				{#if showOptionsPanel}
					<div class="options-panel">
						<div class="option-row">
							<label for="ss-resize-width">Width</label>
							<input
								id="ss-resize-width"
								class="size-input"
								type="number"
								min="1"
								max="10000"
								step="1"
								value={resizeWidth}
								oninput={(e) =>
									setResizeWidth(+(e.currentTarget as HTMLInputElement).value)}
							/>
						</div>
						<div class="option-row">
							<label for="ss-resize-height">Height</label>
							<input
								id="ss-resize-height"
								class="size-input"
								type="number"
								min="1"
								max="10000"
								step="1"
								value={resizeHeight}
								oninput={(e) =>
									setResizeHeight(+(e.currentTarget as HTMLInputElement).value)}
							/>
						</div>
						<div class="option-row">
							<label for="ss-resize-ratio">Maintain ratio</label>
							<input
								id="ss-resize-ratio"
								type="checkbox"
								bind:checked={maintainRatio}
							/>
						</div>
						<button
							class="resize-reset-btn"
							onclick={resetResize}
							title="Reset to original size"
						>
							Reset to original
						</button>
					</div>
				{/if}
			</div>

			<button
				class="action-btn play-btn"
				onclick={togglePreview}
				disabled={slides.length === 0}
			>
				{#if previewPlaying}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
						<rect x="6" y="4" width="4" height="16" />
						<rect x="14" y="4" width="4" height="16" />
					</svg>
					STOP
				{:else}
					<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
						<polygon points="5 3 19 12 5 21 5 3" />
					</svg>
					PLAY
				{/if}
			</button>

			<RecordGroup
				bind:this={recordGroupRef}
				{recording}
				{recordProgress}
				{recordFinalizing}
				disabled={slides.length === 0}
				bind:showSettings={showRecordSettings}
				onCancelRecording={cancelRecording}
			>
				{#snippet settingsContent()}
					<div class="setting-row">
						<label for="ss-rec-format">Format</label>
						<select id="ss-rec-format" bind:value={recordFormat}>
							<option value="webm">WebM</option>
							<option value="gif">GIF</option>
						</select>
					</div>
					<div class="setting-row">
						<span class="setting-label">Duration</span>
						<span class="setting-val">{recordDuration.toFixed(1)}s</span>
					</div>
					<div class="setting-row">
						<label for="ss-rec-fps">FPS</label>
						<select id="ss-rec-fps" bind:value={recordFps}>
							<option value={15}>15</option>
							<option value={24}>24</option>
							<option value={30}>30</option>
							<option value={60}>60</option>
						</select>
						{#if recordFormat === 'gif' && recordFps > 15}
							<span class="hint">capped to 15</span>
						{/if}
					</div>
					<button
						class="start-btn"
						onclick={startRecording}
						disabled={!trackFile}
					>
						{trackFile ? 'Start Recording' : 'Add audio first'}
					</button>
				{/snippet}
			</RecordGroup>
		</div>

		<RecordOverlay
			{recording}
			{recordProgress}
			{recordFinalizing}
			{recordFormat}
			onCancel={cancelRecording}
		/>

		{#if trackFile && trackDuration > 0}
			<div class="timeline-bar">
				<span class="timeline-label">AUD</span>
				<button
					class="timeline-play-btn"
					onclick={audioPlaying ? pauseAudio : playAudio}
					title={audioPlaying ? 'Pause' : 'Play'}
				>
					{#if audioPlaying}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
							<rect x="6" y="4" width="4" height="16" />
							<rect x="14" y="4" width="4" height="16" />
						</svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
							<polygon points="5 3 19 12 5 21 5 3" />
						</svg>
					{/if}
				</button>
				<span class="timeline-time">{formatTime(trackCurrentTime)}</span>
				<div
					class="timeline-track-wrap"
					bind:this={timelineTrackEl}
					role="slider"
					aria-label="Timeline"
					aria-valuenow={trackCurrentTime}
					aria-valuemin={0}
					aria-valuemax={trackDuration}
					tabindex="0"
					onpointerdown={(e) => onTimelinePointerDown(e, null)}
				>
					<div class="timeline-track">
						<div
							class="timeline-span"
							style="left: {(spanStart / trackDuration) *
								100}%; width: {((spanEnd - spanStart) / trackDuration) * 100}%"
						></div>
						<div
							class="timeline-playhead"
							style="left: {(trackCurrentTime / trackDuration) * 100}%"
						></div>
						<button
							type="button"
							class="timeline-handle timeline-handle-start"
							style="left: {(spanStart / trackDuration) * 100}%"
							title="Span start"
							onpointerdown={(e) => {
								e.stopPropagation();
								onTimelinePointerDown(e, 'start');
							}}
						></button>
						<button
							type="button"
							class="timeline-handle timeline-handle-end"
							style="left: {(spanEnd / trackDuration) * 100}%"
							title="Span end"
							onpointerdown={(e) => {
								e.stopPropagation();
								onTimelinePointerDown(e, 'end');
							}}
						></button>
					</div>
				</div>
				<span class="timeline-time">{formatTime(spanEnd)}</span>
				<input
					type="range"
					class="volume-slider"
					min="0"
					max="1"
					step="0.01"
					value={outputVolume}
					oninput={(e) => {
						outputVolume = +(e.currentTarget as HTMLInputElement).value;
						if (gainNode) gainNode.gain.value = outputVolume;
					}}
					title="Volume: {Math.round(outputVolume * 100)}%"
				/>
			</div>
			<TimelineSegments
				{config}
				{trackDuration}
				{onConfigChange}
				alignToEl={timelineTrackEl}
				bind:selectedSegmentId
				currentTime={trackCurrentTime}
				onSeek={seekTo}
			/>
		{/if}
	</div>

	<div class="sidebar">
		<SlideshowConfigPanel
			{config}
			{bpmDetecting}
			onDetectBpm={runBpmDetection}
			{onConfigChange}
			{trackCurrentTime}
			{trackDuration}
		/>
		<EffectsPanel
			bind:effects
			hasTrack={!!trackFile}
			{spectrumData}
			onVolumeLinkChange={setVolumeLink}
		/>
	</div>
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
	}

	.top-bar {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #2a2a2a;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 1px solid #333;
		border-radius: 6px;
		background: transparent;
		color: #999;
		cursor: pointer;
	}

	.back-btn:hover {
		border-color: #555;
		color: #fff;
	}

	.view-toggle {
		display: flex;
		border: 1px solid #333;
		border-radius: 6px;
		overflow: hidden;
	}

	.view-btn {
		padding: 0.3rem 0.8rem;
		border: none;
		background: transparent;
		color: #666;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
	}

	.view-btn.active {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}

	.slide-count {
		font-size: 0.75rem;
		color: #666;
	}

	.spacer {
		flex: 1;
	}

	.track-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid #333;
		border-radius: 6px;
		background: transparent;
		color: #999;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		font-family: inherit;
	}

	.track-btn:hover {
		border-color: #555;
		color: #fff;
	}

	.preview-area {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: #0a0a0a;
	}

	.action-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid #2a2a2a;
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
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		cursor: pointer;
		font-family: inherit;
	}

	.action-btn:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
	}

	.action-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.play-btn:hover:not(:disabled) {
		border-color: #4a7;
		color: #8fc;
	}

	.setting-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
	}

	.setting-row label,
	.setting-row .setting-label {
		min-width: 60px;
		color: #999;
	}

	.setting-row select {
		flex: 1;
		padding: 0.2rem 0.3rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #1a1a1a;
		color: #e0e0e0;
		font-size: 0.75rem;
		font-family: inherit;
	}

	.setting-val {
		color: #888;
		font-size: 0.75rem;
	}

	.hint {
		color: #a44;
		font-size: 0.65rem;
	}

	.start-btn {
		padding: 0.35rem 0.75rem;
		border: 1px solid #444;
		border-radius: 6px;
		background: transparent;
		color: #ccc;
		font-size: 0.75rem;
		cursor: pointer;
		font-family: inherit;
	}

	.start-btn:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
	}

	.start-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.options-group {
		position: relative;
		display: flex;
		align-items: center;
	}

	.options-btn:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
	}

	.options-panel {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 0;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 200px;
		z-index: 20;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
	}

	.option-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.option-row label {
		font-size: 0.7rem;
		color: #888;
		min-width: 72px;
		flex-shrink: 0;
	}

	.option-row input[type='checkbox'] {
		appearance: none;
		-webkit-appearance: none;
		width: 14px;
		height: 14px;
		border: 1px solid #555;
		border-radius: 2px;
		background: #1a1a1a;
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
		display: grid;
		place-items: center;
	}

	.option-row input[type='checkbox']::after {
		content: '';
		position: absolute;
		inset: 0;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6l2.5 2.5 4.5-5' stroke='%23ddd' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			center/contain no-repeat;
		opacity: 0;
	}

	.option-row input[type='checkbox']:checked {
		background: #555;
		border-color: #888;
	}

	.option-row input[type='checkbox']:checked::after {
		opacity: 1;
	}

	.size-input {
		width: 4.5rem;
		background: #1a1a1a;
		color: #aaa;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		font-size: 0.7rem;
		font-family: inherit;
		outline: none;
	}

	.size-input:focus {
		border-color: #555;
	}

	.resize-reset-btn {
		margin-top: 0.25rem;
		padding: 0.35rem 0.75rem;
		border: 1px solid #444;
		border-radius: 6px;
		background: none;
		color: #888;
		font-size: 0.7rem;
		font-family: inherit;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.resize-reset-btn:hover {
		color: #ccc;
		border-color: #666;
	}

	/* Timeline (same pattern as Editor.svelte) */
	.timeline-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem;
		border-top: 1px solid #2a2a2a;
		font-size: 0.7rem;
	}

	.timeline-label {
		color: #555;
		font-weight: 600;
		letter-spacing: 0.05em;
		min-width: 24px;
	}

	.timeline-play-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		color: #999;
		cursor: pointer;
		border-radius: 4px;
	}

	.timeline-play-btn:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.05);
	}

	.timeline-time {
		color: #666;
		font-variant-numeric: tabular-nums;
		min-width: 36px;
	}

	.timeline-track-wrap {
		flex: 1;
		height: 24px;
		display: flex;
		align-items: center;
		cursor: pointer;
		outline: none;
	}

	.timeline-track {
		position: relative;
		width: 100%;
		height: 4px;
		background: #2a2a2a;
		border-radius: 2px;
	}

	.timeline-span {
		position: absolute;
		top: 0;
		height: 100%;
		background: rgba(255, 255, 255, 0.12);
		border-radius: 2px;
	}

	.timeline-playhead {
		position: absolute;
		top: -4px;
		width: 2px;
		height: 12px;
		background: #fff;
		border-radius: 1px;
		transform: translateX(-1px);
		pointer-events: none;
	}

	.timeline-handle {
		position: absolute;
		top: -6px;
		width: 8px;
		height: 16px;
		background: #888;
		border: none;
		border-radius: 2px;
		cursor: ew-resize;
		transform: translateX(-4px);
		padding: 0;
	}

	.timeline-handle:hover {
		background: #ccc;
	}

	.volume-slider {
		width: 60px;
		accent-color: #888;
	}

	/* Sidebar */
	.sidebar {
		width: 300px;
		border-left: 1px solid #2a2a2a;
		overflow-y: auto;
		flex-shrink: 0;
	}
</style>
