<script lang="ts">
	import EffectsPanel from './EffectsPanel.svelte';
	import GlCanvas from './GlCanvas.svelte';
	import SlideshowConfigPanel from './SlideshowConfigPanel.svelte';
	import SlideshowGridView from './SlideshowGridView.svelte';
	import {
		EFFECT_DEFINITIONS,
		createEffectInstance,
		loadPresets,
		type EffectInstance,
		type VolumeLink,
		type Preset,
	} from '../effects';
	import type { GlRenderer } from '../gl/renderer';
	import type { RecordFormat } from '../recorder';
	import type { SpectrumData } from '../types';
	import {
		createAudioGraph,
		disposeAudioGraph as disposeAudioGraphState,
		computeVolumeLevel,
		applyVolumeLinksTick,
	} from '../audio/audio-controller';
	import { formatTime } from '../audio/audio-utils';
	import { generateMosh as generateMoshFn, clearEffects as clearEffectsFn } from '../editor/mosh';
	import type { SlideshowSlide, SlideshowConfig, TransitionType } from '../slideshow/types';
	import { DEFAULT_SLIDESHOW_CONFIG } from '../slideshow/types';
	import { detectBpm } from '../slideshow/bpm-detector';
	import { createBeatClock } from '../slideshow/beat-clock';
	import { computeEffectsForBeat, cloneEffects } from '../slideshow/sequencer';
	import { executeSlideshowRecording } from '../slideshow/slideshow-recorder';

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

	// Init slides from initial files
	$effect(() => {
		if (initialFiles.length > 0 && slides.length === 0) {
			addFiles(initialFiles);
		}
	});

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

	// ── Effects ──
	let effects: EffectInstance[] = $state(EFFECT_DEFINITIONS.map(createEffectInstance));
	let presets: Preset[] = $state(loadPresets());

	function setVolumeLink(index: number, paramKey: string, link: VolumeLink | null) {
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

	function onTimelinePointerDown(e: PointerEvent, handle: 'start' | 'end' | null) {
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
		const up = () => { draggingHandle = null; };
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
				context: audioContext, source: mediaSource!, analyser: analyserNode!,
				gain: gainNode!, frequencyData: frequencyData!, sampleRate: audioSampleRate,
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

	function openTrackPicker() { trackInput?.click(); }

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
			applyVolumeLinksTick(effects, volumeLevel, freqDataRef, sampleRate, fftSize);
			rafId = requestAnimationFrame(tick);
		}
		rafId = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafId);
	});

	let spectrumData: SpectrumData | null = $derived(
		frequencyData && audioSampleRate > 0 && audioFrequencyBinCount > 0
			? { data: frequencyData, sampleRate: audioSampleRate, binCount: audioFrequencyBinCount, tick: volumeLevel }
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
		let activeTransition: TransitionType | null = null;
		let previousSlideImg: HTMLImageElement | null = null;

		function pickRandomTransition(): TransitionType | null {
			const enabled = config.enabledTransitions;
			if (enabled.length === 0) return null;
			return enabled[Math.floor(Math.random() * enabled.length)];
		}

		function tick() {
			if (!previewPlaying || !glRenderer) return;

			const clock = createBeatClock(config.bpm, config.subdivision, config.beatOffset);

			let t: number;
			if (audioEl && trackFile && audioPlaying) {
				t = audioEl.currentTime - previewStartAudioTime;
				if (audioEl.currentTime >= spanEnd) {
					stopPreview();
					return;
				}
			} else {
				t = (performance.now() / 1000) % (slides.length * clock.intervalSeconds);
			}

			const { index: beatIndex, fraction } = clock.beatAt(Math.max(0, t));
			const slideIndex = config.loop
				? beatIndex % slides.length
				: Math.min(beatIndex, slides.length - 1);
			const slide = slides[slideIndex];

			if (beatIndex !== previewBeatIndex && slide) {
				// Save previous image for transition
				if (currentSlideId) {
					previousSlideImg = imageCache.get(currentSlideId) ?? null;
				}

				previewBeatIndex = beatIndex;
				activeTransition = pickRandomTransition();

				// Switch source image immediately
				const img = getCachedImage(slide);
				if (img && img.complete) {
					glRenderer.updateSourceImage(img);
					currentSlideId = slide.id;

					// Set up transition texture from previous slide
					if (activeTransition && previousSlideImg) {
						glRenderer.setTransitionImage(previousSlideImg);
					}
				}

				previewEffects = computeEffectsForBeat(
					config,
					slide,
					effects,
					smoothState,
					getMoshOptions(),
				);
			}

			const activeEffects = previewEffects.length > 0 ? previewEffects : effects;
			const now = performance.now() / 1000;

			// Render with or without transition
			if (activeTransition && previousSlideImg && config.transitionDuration > 0) {
				const progress = Math.min(1, fraction / config.transitionDuration);
				if (progress < 1) {
					glRenderer.renderWithTransition(activeEffects, now, activeTransition, progress);
				} else {
					glRenderer.clearTransitionImage();
					activeTransition = null;
					previousSlideImg = null;
					glRenderer.render(activeEffects, now);
				}
			} else {
				glRenderer.render(activeEffects, now);
			}

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
		if (glRenderer) glRenderer.clearTransitionImage();
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
			hasAudio: !!trackFile && !!audioContext,
			audioSampleRate,
			frequencyData,
		};
	}

	function mosh() {
		generateMoshFn(effects, getMoshOptions());
	}

	function clearEffects() {
		clearEffectsFn(effects);
	}

	// ── Recording ──
	let recordFormat: RecordFormat = $state('webm');
	let recordFps = $state(24);
	let recording = $state(false);
	let recordProgress = $state(0);
	let recordFinalizing = $state(false);
	let recordAbort: AbortController | null = $state(null);
	let showRecordSettings = $state(false);
	let recordGroupEl: HTMLDivElement;

	let recordDuration = $derived(
		trackFile && trackDuration > 0 ? spanEnd - spanStart : 5,
	);

	function handleRecordClickOutside(e: MouseEvent) {
		if (showRecordSettings && recordGroupEl && !recordGroupEl.contains(e.target as Node)) {
			showRecordSettings = false;
		}
	}

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
					volumeLinks: e.volumeLinks ? JSON.parse(JSON.stringify(e.volumeLinks)) : undefined,
				})),
				audioFile: trackFile,
				audioStart: spanStart,
				audioEnd: spanEnd,
				canvas: canvasEl,
				renderer: glRenderer,
				moshOptions: getMoshOptions(),
				onProgress: (p) => { recordProgress = p; },
				onFinalizing: () => { recordFinalizing = true; },
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
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
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
		handleRecordClickOutside(e);
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
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="19" y1="12" x2="5" y2="12" />
						<polyline points="12 19 5 12 12 5" />
					</svg>
				</button>

				<div class="view-toggle">
					<button
						class="view-btn"
						class:active={activeView === 'grid'}
						onclick={() => { activeView = 'grid'; if (previewPlaying) stopPreview(); }}
					>
						Grid
					</button>
					<button
						class="view-btn"
						class:active={activeView === 'preview'}
						onclick={() => { activeView = 'preview'; }}
					>
						Preview
					</button>
				</div>

				<span class="slide-count">{slides.length} images</span>

				<div class="spacer"></div>

				{#if !trackFile}
					<button class="track-btn" onclick={openTrackPicker}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M9 18V5l12-2v13" />
							<circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
						</svg>
						Add Audio
					</button>
				{:else}
					<button class="track-btn" onclick={clearTrack}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
					effects={previewPlaying && previewEffects.length > 0 ? previewEffects : effects}
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
			<button class="settings-btn" onclick={clearEffects} title="Clear all effects">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M18 6L6 18" /><path d="M6 6l12 12" />
				</svg>
			</button>
			<button class="action-btn mosh-btn" onclick={mosh}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
				</svg>
				MOSH
			</button>

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

			<div class="record-group" bind:this={recordGroupEl}>
				<button
					class="action-btn record-btn"
					onclick={() => (showRecordSettings = !showRecordSettings)}
					disabled={recording || slides.length === 0}
				>
					{#if recording}
						{#if recordFinalizing}
							Creating file...
						{:else}
							{Math.round(recordProgress * 100)}%
						{/if}
					{:else}
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<circle cx="12" cy="12" r="10" />
							<circle cx="12" cy="12" r="4" fill="currentColor" />
						</svg>
						RECORD
					{/if}
				</button>

				{#if recording}
					<button class="cancel-btn" onclick={cancelRecording}>Cancel</button>
				{/if}

				{#if showRecordSettings}
					<div class="record-settings">
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
						<button class="start-btn" onclick={startRecording} disabled={!trackFile}>
							{trackFile ? 'Start Recording' : 'Add audio first'}
						</button>
					</div>
				{/if}
			</div>
		</div>

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
							style="left: {(spanStart / trackDuration) * 100}%; width: {((spanEnd - spanStart) / trackDuration) * 100}%"
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
							onpointerdown={(e) => { e.stopPropagation(); onTimelinePointerDown(e, 'start'); }}
						></button>
						<button
							type="button"
							class="timeline-handle timeline-handle-end"
							style="left: {(spanEnd / trackDuration) * 100}%"
							title="Span end"
							onpointerdown={(e) => { e.stopPropagation(); onTimelinePointerDown(e, 'end'); }}
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
		{/if}
	</div>

	<div class="sidebar">
		<SlideshowConfigPanel
			{config}
			{bpmDetecting}
			onDetectBpm={runBpmDetection}
			{onConfigChange}
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

	.settings-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 1px solid #333;
		border-radius: 6px;
		background: transparent;
		color: #666;
		cursor: pointer;
	}

	.settings-btn:hover {
		border-color: #555;
		color: #ccc;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 1rem;
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

	.mosh-btn {
		border-color: #555;
	}

	.play-btn {
		border-color: #4a7;
		color: #8fc;
	}

	.play-btn:hover:not(:disabled) {
		border-color: #6c9;
	}

	.record-btn {
		border-color: #a44;
		color: #f88;
	}

	.record-group {
		position: relative;
	}

	.cancel-btn {
		padding: 0.3rem 0.6rem;
		border: 1px solid #a44;
		border-radius: 6px;
		background: transparent;
		color: #f88;
		font-size: 0.7rem;
		cursor: pointer;
		font-family: inherit;
	}

	.record-settings {
		position: absolute;
		bottom: 100%;
		right: 0;
		margin-bottom: 0.5rem;
		padding: 0.75rem;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 200px;
		z-index: 10;
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
