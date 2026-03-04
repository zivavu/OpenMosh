<script lang="ts">
	import {
		applyVolumeLinksTick,
		computeVolumeLevel,
		createAudioGraph,
		disposeAudioGraph as disposeAudioGraphState,
	} from '../audio/audio-controller';
	import {
		EFFECT_DEFINITIONS,
		createEffectInstance,
		loadInitialEffects,
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
	import type { SlideshowConfig, SlideshowSlide } from '../slideshow/types';
	import { DEFAULT_SLIDESHOW_CONFIG } from '../slideshow/types';
	import { DEFAULT_TEXT_OVERLAY_STYLE, parsePhrases } from '../text-overlay';
	import type { SpectrumData } from '../types';
	import EffectsPanel from './EffectsPanel.svelte';
	import GlCanvas from './GlCanvas.svelte';
	import RecordOverlay from './RecordOverlay.svelte';
	import SlideshowActionBar from './SlideshowActionBar.svelte';
	import SlideshowAudioTimeline from './SlideshowAudioTimeline.svelte';
	import SlideshowConfigPanel from './SlideshowConfigPanel.svelte';
	import SlideshowGridView from './SlideshowGridView.svelte';
	import SlideshowTopBar from './SlideshowTopBar.svelte';

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

	function shuffleSlides() {
		for (let i = slides.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const tmp = slides[i];
			slides[i] = slides[j];
			slides[j] = tmp;
		}
	}

	function setPresetIndex(slideId: string, presetIndex: number | null) {
		const s = slides.find((s) => s.id === slideId);
		if (s) s.presetIndex = presetIndex;
	}

	if (initialFiles.length > 0) {
		addFiles(initialFiles);
	}

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
	let effects: EffectInstance[] = $state(loadInitialEffects());
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

		if (!previewPlaying) return;

		if (audioEl && trackFile) {
			ensureAudioGraph();
			if (audioContext?.state === 'suspended') audioContext.resume();
			const t = audioEl.currentTime;
			if (t < spanStart || t >= spanEnd) {
				audioEl.currentTime = spanStart;
			}
			audioEl.play();
			audioPlaying = true;
		}

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
				t =
					((performance.now() / 1000) % (slides.length * fallbackInterval)) +
					config.beatOffset;
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

				const img = getCachedImage(slide);
				if (img && img.complete) {
					glRenderer.updateSourceImage(img);
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

	let recordDuration = $derived(
		trackFile && trackDuration > 0 ? spanEnd - spanStart : 5,
	);

	async function startRecording() {
		if (!canvasEl || !glRenderer || recording || slides.length === 0) return;
		if (!trackFile) {
			alert('Please add an audio track for slideshow recording.');
			return;
		}
		recording = true;
		recordProgress = 0;
		recordFinalizing = false;
		const abort = new AbortController();
		recordAbort = abort;

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
	onpointerdown={() => audioContext?.resume()}
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
		<SlideshowTopBar
			{activeView}
			slideCount={slides.length}
			{onBack}
			onViewChange={(view) => {
				activeView = view;
				if (view === 'grid' && previewPlaying) stopPreview();
			}}
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

		<SlideshowActionBar
			{previewPlaying}
			slidesEmpty={slides.length === 0}
			{trackFile}
			{resizeWidth}
			{resizeHeight}
			{maintainRatio}
			{recording}
			{recordProgress}
			{recordFinalizing}
			{recordFormat}
			{recordFps}
			{recordDuration}
			onTogglePreview={togglePreview}
			onStartRecording={startRecording}
			onCancelRecording={cancelRecording}
			onSetResizeWidth={setResizeWidth}
			onSetResizeHeight={setResizeHeight}
			onResetResize={resetResize}
			onMaintainRatioChange={(v) => (maintainRatio = v)}
			onRecordFormatChange={(f) => (recordFormat = f)}
			onRecordFpsChange={(fps) => (recordFps = fps)}
		/>

		<RecordOverlay
			{recording}
			{recordProgress}
			{recordFinalizing}
			{recordFormat}
			onCancel={cancelRecording}
		/>

		{#if !trackFile}
			<div class="track-add-bar">
				<button class="track-add-btn" onclick={openTrackPicker}>
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
						<circle cx="6" cy="18" r="3" />
						<circle cx="18" cy="16" r="3" />
					</svg>
					Add audio track
				</button>
			</div>
		{:else if trackFile && trackDuration > 0}
			<SlideshowAudioTimeline
				{trackDuration}
				{trackCurrentTime}
				{spanStart}
				{spanEnd}
				{audioPlaying}
				{outputVolume}
				{config}
				bind:selectedSegmentId
				{onConfigChange}
				onPlay={playAudio}
				onPause={pauseAudio}
				onSeek={seekTo}
				onSpanStartChange={(t) => (spanStart = t)}
				onSpanEndChange={(t) => (spanEnd = t)}
				onVolumeChange={(v) => {
					outputVolume = v;
					if (gainNode) gainNode.gain.value = v;
				}}
				onRemoveTrack={clearTrack}
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
		min-height: 0;
		overflow: hidden;
	}

	.track-add-bar {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding: 0.35rem 0.75rem;
		background: rgba(18, 18, 18, 0.9);
		border-top: 1px solid #2a2a2a;
	}

	.track-add-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.7rem;
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		font-family: inherit;
		background: none;
		border: 1px solid #333;
		border-radius: 5px;
		color: #666;
		cursor: pointer;
	}

	.track-add-btn:hover {
		color: #aaa;
		border-color: #555;
	}

	.preview-area {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: #0a0a0a;
	}

	.sidebar {
		width: 300px;
		border-left: 1px solid #2a2a2a;
		overflow-y: auto;
		flex-shrink: 0;
	}
</style>
