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
	import type { RecordFormat } from '../../recorder';
	import { beatAtTime } from '../../slideshow/beat-clock';
	import { detectBpm } from '../../slideshow/bpm-detector';
	import {
		cloneEffects,
		computeEffectsForBeat,
	} from '../../slideshow/sequencer';
	import { executeSlideshowRecording } from '../../slideshow/slideshow-recorder';
	import type { SlideshowConfig, SlideshowSlide } from '../../slideshow/types';
	import { DEFAULT_SLIDESHOW_CONFIG } from '../../slideshow/types';
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

	interface Props {
		initialFiles: File[];
		initialAudioFile?: File | null;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: import('../../gl/renderer').GlRenderer | null;
	}

	let {
		initialFiles,
		initialAudioFile = null,
		warmCanvas = null,
		warmRenderer = null,
	}: Props = $props();

	// ── Slides ──
	let slides: SlideshowSlide[] = $state([]);

	function addFiles(files: FileList | File[]) {
		const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
		const newSlides: SlideshowSlide[] = Array.from(files)
			.filter((f) => imageTypes.includes(f.type))
			.map((file) => ({
				id: generateId(),
				file,
				objectUrl: URL.createObjectURL(file),
				thumbUrl: null,
				presetIndex: null,
			}));
		slides.push(...newSlides);
		for (const slide of newSlides)
			generateThumb(slide.id, slide.file, slide.objectUrl);
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
	}

	function reorderSlides(from: number, to: number) {
		const [item] = slides.splice(from, 1);
		slides.splice(to, 0, item);
	}

	function shuffleSlides() {
		shuffleInPlace(slides);
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
		localStorage.setItem(
			CONFIG_KEY,
			JSON.stringify({ ...config, outputVolume: audio.outputVolume }),
		);
	});

	let currentTrackId = $state<string | null>(null);
	const TRACK_SEGMENTS_KEY = 'openmosh-track-segments';

	function saveSegments(trackId: string) {
		try {
			const all = JSON.parse(localStorage.getItem(TRACK_SEGMENTS_KEY) ?? '{}');
			all[trackId] = {
				segments: config.segments,
				bpm: config.bpm,
				textOverlay: config.textOverlay,
				spanStart: audio.spanStart,
				spanEnd: audio.spanEnd,
			};
			localStorage.setItem(TRACK_SEGMENTS_KEY, JSON.stringify(all));
		} catch {}
	}

	function loadSegments(trackId: string): {
		segments: SlideshowConfig['segments'];
		bpm?: number;
		textOverlay?: SlideshowConfig['textOverlay'];
		spanStart?: number;
		spanEnd?: number;
	} | null {
		try {
			const all = JSON.parse(localStorage.getItem(TRACK_SEGMENTS_KEY) ?? '{}');
			const entry = all[trackId];
			if (!entry) return null;
			// Backward compat: old format stored segments array directly
			if (Array.isArray(entry)) return { segments: entry };
			return entry;
		} catch {}
		return null;
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

	// Use first slide as default canvas source
	let previewImageSrc = $state('');
	$effect(() => {
		if (slides.length > 0 && !previewImageSrc) {
			previewImageSrc = slides[0].objectUrl;
		}
	});

	// ── Audio ──
	// Load outputVolume from config before constructing manager
	const savedOutputVolume =
		((loadConfig() as unknown as Record<string, unknown>).outputVolume as number) ?? 1;

	const audio = new AudioManager({
		getEffects: () => effects,
		initialOutputVolume: savedOutputVolume,
	});

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

	function onLibraryLoadTrack(file: File, trackId: string) {
		stopPreview();
		if (currentTrackId) saveSegments(currentTrackId);
		// Partial audio reset — intentionally skip zeroing trackDuration and trackFile
		// so AudioTimeline stays mounted during the switch (avoids a remount flash).
		audio.resetPlayback();
		currentTrackId = null;
		audio.disposeAudioGraph();
		currentTrackId = trackId;
		audio.trackFile = file;
		const saved = loadSegments(trackId);
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
	// svelte-ignore state_referenced_locally
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
				t = audioEl?.currentTime ?? audio.trackCurrentTime;
				audio.trackCurrentTime = t;
				if (t >= audio.spanEnd) {
					stopPreview();
					return;
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
					glRenderer.setTextOverlay(phrase, previewTextStyle, undefined, {
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

	// ── Recording ──
	let recordFormat: RecordFormat = $state('webm');
	let recordFps = $state(60);
	let recording = $state(false);
	let recordProgress = $state(0);
	let recordFinalizing = $state(false);
	let recordAbort: AbortController | null = $state(null);

	async function startRecording() {
		if (!canvasEl || !glRenderer || recording || slides.length === 0) return;
		if (!audio.trackFile) {
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
				audioFile: audio.trackFile,
				audioStart: audio.spanStart,
				audioEnd: audio.spanEnd,
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

	// ── Drag & Drop ──
	let dragging = $state(false);

	// ── Component refs ──
	let trackLibraryRef = $state<TrackLibrary>();
	let _mobileSheetRef = $state<MobileSheet>();

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
	onpointerdown={() => audio.audioContext?.resume()}
/>

{#if audio.trackObjectUrl}
	<audio
		bind:this={audioEl}
		src={audio.trackObjectUrl}
		onloadedmetadata={() => audio.onAudioLoadedMetadata()}
		ontimeupdate={() => audio.onAudioTimeUpdate()}
		onplay={() => (audio.audioPlaying = true)}
		onpause={() => (audio.audioPlaying = false)}
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
		bind:this={trackLibraryRef}
		activeTrackName={audio.trackFile?.name ?? null}
		onLoadTrack={onLibraryLoadTrack}
		onPreviewStart={() => audio.pauseAudio()}
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
		<div class="preview-area" class:hidden={activeView === 'grid'}>
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
			{recording}
			{recordFps}
			recordDuration={audio.trackFile && audio.trackDuration > 0 ? audio.spanEnd - audio.spanStart : 5}
			onTogglePreview={togglePreview}
			onStartRecording={startRecording}
			onRecordFpsChange={(fps) => (recordFps = fps)}
			onOpenSheet={() => trackLibraryRef?.openLibrary()}
		/>

		<RecordOverlay
			{recording}
			{recordProgress}
			{recordFinalizing}
			{recordFormat}
			onCancel={cancelRecording}
		/>

		{#if !audio.trackFile}
			<TrackAddBar
				onOpenPicker={openTrackPicker}
				hintText="Add music to sync transitions to the beat"
			/>
		{:else if audio.trackFile && audio.trackDuration > 0}
			<AudioTimeline
				trackDuration={audio.trackDuration}
				trackCurrentTime={audio.trackCurrentTime}
				spanStart={audio.spanStart}
				spanEnd={audio.spanEnd}
				audioPlaying={audio.audioPlaying}
				outputVolume={audio.outputVolume}
				{config}
				bind:selectedSegmentId
				{onConfigChange}
				onPlay={() => audio.playAudio()}
				onPause={() => audio.pauseAudio()}
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
					effects = setVolumeLink(effects, index, paramKey, link);
				}}
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
