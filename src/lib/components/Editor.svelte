<script lang="ts">
	import EffectsPanel from './EffectsPanel.svelte';
	import GlCanvas from './GlCanvas.svelte';
	import MoshGroup from './MoshGroup.svelte';
	import RecordGroup from './RecordGroup.svelte';
	import RecordOverlay from './RecordOverlay.svelte';
	import {
		EFFECT_DEFINITIONS,
		createEffectInstance,
		type EffectInstance,
		type VolumeLink,
	} from '../effects';
	import type { GlRenderer } from '../gl/renderer';
	import type { RecordFormat } from '../recorder';
	import { executeRecording } from '../editor/recording';
	import { formatTime } from '../audio/audio-utils';
	import {
		createAudioGraph,
		disposeAudioGraph as disposeAudioGraphState,
		computeVolumeLevel,
		applyVolumeLinksTick,
	} from '../audio/audio-controller';
	import {
		generateMosh as generateMoshFn,
		clearEffects as clearEffectsFn,
	} from '../editor/mosh';
	import { createKeyboardHandler } from '../editor/keyboard';

	interface Props {
		file: File;
		onBack: () => void;
		onfile: (f: File) => void;
	}

	let { file, onBack, onfile }: Props = $props();
	let dragging = $state(false);

	let isVideo = $derived(file.type.startsWith('video/'));
	let videoEl = $state<HTMLVideoElement | null>(null);
	let videoDuration = $state(0);
	let videoCurrentTime = $state(0);
	let videoSpanStart = $state(0);
	let videoSpanEnd = $state(0);
	let videoPlaying = $state(false);
	let draggingVideoHandle = $state<'start' | 'end' | null>(null);
	let videoTimelineTrackEl = $state<HTMLDivElement | undefined>(undefined);

	let format = $state<'png' | 'jpg' | 'webm' | 'gif'>('png');
	let isImageFormat = $derived(format === 'png' || format === 'jpg');
	let isVideoFormat = $derived(format === 'webm' || format === 'gif');
	let imageSrc = $state('');
	$effect(() => {
		const url = URL.createObjectURL(file);
		imageSrc = url;
		return () => URL.revokeObjectURL(url);
	});
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let glRenderer: GlRenderer | null = $state(null);
	let effects: EffectInstance[] = $state(
		EFFECT_DEFINITIONS.map(createEffectInstance),
	);

	const SETTINGS_KEY = 'openmosh-settings';
	function loadSettings() {
		try {
			const raw = localStorage.getItem(SETTINGS_KEY);
			if (raw) return JSON.parse(raw);
		} catch {}
		return {};
	}
	function saveSettings() {
		localStorage.setItem(
			SETTINGS_KEY,
			JSON.stringify({ moshMin, moshMax, randomizeOrder, moshAudioLink, moshAudioLinkStrength, showFps, outputVolume }),
		);
	}
	const saved = loadSettings();
	let moshMin = $state(saved.moshMin ?? 3);
	let moshMax = $state(saved.moshMax ?? 6);
	let randomizeOrder = $state(saved.randomizeOrder ?? true);
	let showMoshSettings = $state(false);
	let moshAudioLink = $state(saved.moshAudioLink ?? true);
	let moshAudioLinkStrength = $state(saved.moshAudioLinkStrength ?? 0.8);
	let showFps = $state(saved.showFps ?? false);
	$effect(() => {
		// subscribe to all settings
		moshMin; moshMax; randomizeOrder; moshAudioLink; moshAudioLinkStrength; showFps; outputVolume;
		saveSettings();
	});
	let currentFps = $state(0);

	let naturalWidth = $state<number | undefined>(undefined);
	let naturalHeight = $state<number | undefined>(undefined);
	let resizeWidth = $state(0);
	let resizeHeight = $state(0);
	let maintainRatio = $state(true);

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
			resizeHeight = Math.min(MAX_RESIZE, Math.max(1, Math.round(val / aspectRatio)));
		}
	}

	function setResizeHeight(h: number) {
		const val = Math.min(MAX_RESIZE, Math.max(1, Math.round(h)));
		resizeHeight = val;
		if (maintainRatio && aspectRatio > 0) {
			resizeWidth = Math.min(MAX_RESIZE, Math.max(1, Math.round(val * aspectRatio)));
		}
	}

	function resetResize() {
		if (naturalWidth != null && naturalHeight != null) {
			resizeWidth = naturalWidth;
			resizeHeight = naturalHeight;
		}
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
	let outputVolume = $state(saved.outputVolume ?? 1);
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

	function playSpan() {
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

	function pauseTrack() {
		audioEl?.pause();
		audioPlaying = false;
	}

	function seekTo(t: number) {
		if (!audioEl) return;
		const tClamp = Math.max(0, Math.min(trackDuration, t));
		audioEl.currentTime = tClamp;
		trackCurrentTime = tClamp;
	}

	function timeFromEvent(e: { clientX: number } | TouchEvent): number {
		if (!timelineTrackEl) return 0;
		const rect = timelineTrackEl.getBoundingClientRect();
		const clientX =
			'touches' in e
				? e.touches[0]?.clientX
				: (e as { clientX: number }).clientX;
		const x = typeof clientX === 'number' ? clientX - rect.left : 0;
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

	$effect(() => {
		const handle = draggingVideoHandle;
		if (handle === null) return;
		const move = (e: PointerEvent) => {
			if (!videoTimelineTrackEl) return;
			const rect = videoTimelineTrackEl.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const pct = Math.max(0, Math.min(1, x / rect.width));
			const t = pct * videoDuration;
			if (handle === 'start') {
				videoSpanStart = Math.max(0, Math.min(t, videoSpanEnd - 0.1));
			} else {
				videoSpanEnd = Math.max(
					videoSpanStart + 0.1,
					Math.min(videoDuration, t),
				);
			}
		};
		const up = () => {
			draggingVideoHandle = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		return () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
	});

	function applyAudioGraphState(state: ReturnType<typeof createAudioGraph>) {
		audioContext = state.context;
		mediaSource = state.source;
		analyserNode = state.analyser;
		gainNode = state.gain;
		gainNode.gain.value = outputVolume;
		frequencyData = state.frequencyData;
		audioSampleRate = state.sampleRate;
		audioFrequencyBinCount = state.binCount;
	}

	function ensureAudioGraph() {
		if (!audioEl || audioContext) return;
		applyAudioGraphState(createAudioGraph(audioEl));
	}

	function ensureVideoAudioGraph() {
		if (!videoEl || audioContext || trackFile) return;
		videoEl.muted = false;
		applyAudioGraphState(createAudioGraph(videoEl));
		audioContext!.resume().catch(() => {});
	}

	function playVideo() {
		if (!videoEl) return;
		audioContext?.resume();
		videoEl.play().catch(() => {});
	}

	function pauseVideo() {
		videoEl?.pause();
	}

	function seekVideoTo(t: number) {
		if (!videoEl || !videoDuration) return;
		const tClamp = Math.max(0, Math.min(videoDuration, t));
		videoEl.currentTime = tClamp;
		videoCurrentTime = tClamp;
	}

	function videoTimeFromEvent(e: PointerEvent): number {
		if (!videoTimelineTrackEl || !videoDuration) return 0;
		const rect = videoTimelineTrackEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const pct = Math.max(0, Math.min(1, x / rect.width));
		return pct * videoDuration;
	}

	function onVideoTimelinePointerDown(
		e: PointerEvent,
		handle: 'start' | 'end' | null,
	) {
		e.preventDefault();
		if (handle === 'start' || handle === 'end') {
			draggingVideoHandle = handle;
			(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		} else {
			seekVideoTo(videoTimeFromEvent(e));
		}
	}

	function disposeAudioGraph() {
		if (audioContext) {
			disposeAudioGraphState({ context: audioContext, source: mediaSource!, analyser: analyserNode!, gain: gainNode!, frequencyData: frequencyData!, sampleRate: audioSampleRate, binCount: audioFrequencyBinCount });
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

	function getMoshOptions() {
		return {
			moshMin,
			moshMax,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			hasAudio: !!trackFile && !!audioContext,
			audioSampleRate,
			frequencyData,
		};
	}

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

	let history: EffectInstance[][] = $state([
		$state.snapshot(EFFECT_DEFINITIONS.map(createEffectInstance)),
	]);
	let historyIndex = $state(0);
	let canUndo = $derived(historyIndex > 0);
	let canRedo = $derived(historyIndex < history.length - 1);
	let moshGroupRef = $state<MoshGroup>();
	let recordGroupRef = $state<RecordGroup>();

	function pushHistory() {
		history.length = historyIndex + 1;
		history.push($state.snapshot(effects));
		historyIndex = history.length - 1;
	}

	function generateMosh() {
		generateMoshFn(effects, getMoshOptions());
		pushHistory();
	}

	function mosh() {
		if (canRedo) {
			historyIndex++;
			effects = $state.snapshot(history[historyIndex]) as EffectInstance[];
		} else {
			generateMosh();
		}
	}

	function undo() {
		if (!canUndo) return;
		historyIndex--;
		effects = $state.snapshot(history[historyIndex]) as EffectInstance[];
	}

	function clearEffects() {
		clearEffectsFn(effects);
		pushHistory();
	}

	function reInput() {
		if (!canvasEl) return;
		canvasEl.toBlob((blob) => {
			if (!blob) return;
			const newFile = new File([blob], `openmosh-reinput-${Date.now()}.png`, {
				type: 'image/png',
			});
			effects.forEach((e) => (e.enabled = false));
			history = [$state.snapshot(effects)];
			historyIndex = 0;
			onfile(newFile);
		}, 'image/png');
	}

	const handleKeydown = createKeyboardHandler({
		save,
		mosh,
		undo,
		reInput,
		playSpan,
		pauseTrack,
		hasTrack: () => !!trackFile && !!audioEl,
		isPlaying: () => audioPlaying,
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
	let recordFormat: RecordFormat = $derived(format === 'gif' ? 'gif' : 'webm');
	let recordDuration = $state(5);
	let recordFps = $state(24);
	let recordWithAudio = $state(false);
	let recordSpanOnly = $state(false);
	let recording = $state(false);
	let recordProgress = $state(0);
	let recordFinalizing = $state(false);
	let recordAbort: AbortController | null = $state(null);

	let recordDurationEffective = $derived(
		isVideo && videoDuration > 0
			? videoSpanEnd - videoSpanStart
			: recordSpanOnly && trackFile && trackDuration > 0
				? spanEnd - spanStart
				: recordDuration,
	);
	let canIncludeAudio = $derived(
		!!trackFile && trackDuration > 0 && recordFormat === 'webm',
	);
	let canRenderSpan = $derived(
		!!recordWithAudio && !!trackFile && trackDuration > 0,
	);

	async function startRecording() {
		if (!canvasEl || !glRenderer || recording) return;
		showRecordSettings = false;
		recording = true;
		recordProgress = 0;
		recordFinalizing = false;
		const abort = new AbortController();
		recordAbort = abort;

		try {
			await executeRecording({
				format: recordFormat,
				fps: recordFps,
				recordDuration,
				recordSpanOnly,
				recordWithAudio,
				canvas: canvasEl,
				renderer: glRenderer,
				effects,
				trackFile,
				trackDuration,
				spanStart,
				spanEnd,
				isVideo,
				videoEl,
				videoDuration,
				videoSpanStart,
				videoSpanEnd,
				file,
				onProgress: (p) => { recordProgress = p; },
				onFinalizing: () => { recordFinalizing = true; },
				signal: abort.signal,
			});
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				// cancelled
			} else {
				console.error('Recording failed:', e);
				alert(
					e instanceof Error
						? e.message
						: 'Recording failed. Check the browser console for details.',
				);
			}
		} finally {
			recording = false;
			recordFinalizing = false;
			recordAbort = null;
			if (isVideo && videoEl) videoEl.play().catch(() => {});
			if (canvasEl && glRenderer) {
				glRenderer.render(effects, performance.now() / 1000);
			}
		}
	}

	function cancelRecording() {
		recordAbort?.abort();
	}
</script>

<svelte:window
	onkeydown={handleKeydown}
	onpointerdown={(e) => {
		audioContext?.resume();
		moshGroupRef?.handleClickOutside(e);
		recordGroupRef?.handleClickOutside(e);
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
		if (f && (f.type.startsWith('image/') || f.type.startsWith('video/')))
			onfile(f);
	}}
>
	<div class="main-area">
		<div class="top-bar">
			<div class="toolbar">
				<button class="back-btn" onclick={onBack} title="Load different file">
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
				<div class="format-group">
					<button
						class="format-btn"
						class:active={format === 'png'}
						onclick={() => (format = 'png')}
					>
						PNG
					</button>
					<button
						class="format-btn"
						class:active={format === 'jpg'}
						onclick={() => (format = 'jpg')}
					>
						JPG
					</button>
					<button
						class="format-btn"
						class:active={format === 'webm'}
						onclick={() => (format = 'webm')}
					>
						WebM
					</button>
					<button
						class="format-btn"
						class:active={format === 'gif'}
						onclick={() => (format = 'gif')}
					>
						GIF
					</button>
				</div>
			</div>
		</div>

		{#if isVideo}
			<video
				bind:this={videoEl}
				src={imageSrc}
				muted
				autoplay
				loop
				playsinline
				onloadedmetadata={() => {
					const dur = videoEl!.duration;
					videoDuration = dur;
					videoSpanStart = 0;
					videoSpanEnd = dur;
					recordDuration = Math.round(dur * 10) / 10;
					ensureVideoAudioGraph();
				}}
				ontimeupdate={() => {
					videoCurrentTime = videoEl?.currentTime ?? 0;
				}}
				onplay={() => (videoPlaying = true)}
				onpause={() => (videoPlaying = false)}
				onseeking={() => {
					audioContext?.resume();
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
			videoEl={isVideo ? videoEl : null}
			freezeAnimation={isImageFormat}
		/>

		<div class="action-bar">
			<MoshGroup
				bind:this={moshGroupRef}
				onMosh={mosh}
				onClear={clearEffects}
				onUndo={undo}
				{canUndo}
				bind:showSettings={showMoshSettings}
			>
				{#snippet settingsContent()}
					<div class="mosh-setting-row">
						<label for="mosh-min">Min effects</label>
						<input
							id="mosh-min"
							type="range"
							min="1"
							max="20"
							step="1"
							bind:value={moshMin}
							oninput={() => {
								if (moshMax < moshMin) moshMax = moshMin;
							}}
						/>
						<span class="mosh-setting-val">{moshMin}</span>
					</div>
					<div class="mosh-setting-row">
						<label for="mosh-max">Max effects</label>
						<input
							id="mosh-max"
							type="range"
							min="1"
							max="20"
							step="1"
							bind:value={moshMax}
							oninput={() => {
								if (moshMin > moshMax) moshMin = moshMax;
							}}
						/>
						<span class="mosh-setting-val">{moshMax}</span>
					</div>
					<div class="mosh-setting-row">
						<label for="mosh-shuffle">Shuffle order</label>
						<input
							id="mosh-shuffle"
							type="checkbox"
							bind:checked={randomizeOrder}
						/>
					</div>
					<div class="mosh-setting-row">
						<label for="mosh-audio-link">Random audio links</label>
						<input
							id="mosh-audio-link"
							type="checkbox"
							bind:checked={moshAudioLink}
						/>
					</div>
					{#if moshAudioLink}
					<div class="mosh-setting-row">
						<label for="mosh-audio-link-strength">Link strength</label>
						<input
							id="mosh-audio-link-strength"
							type="range"
							min="0"
							max="1"
							step="0.05"
							bind:value={moshAudioLinkStrength}
						/>
						<span class="mosh-setting-val">{Math.round(moshAudioLinkStrength * 100)}%</span>
					</div>
					{/if}
					<div class="mosh-setting-row">
						<label for="show-fps">Show FPS</label>
						<input id="show-fps" type="checkbox" bind:checked={showFps} />
					</div>
					<div class="settings-divider"></div>
					<div class="mosh-setting-row">
						<label for="resize-width">Width</label>
						<input
							id="resize-width"
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
					<div class="mosh-setting-row">
						<label for="resize-height">Height</label>
						<input
							id="resize-height"
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
					<div class="mosh-setting-row">
						<label for="resize-ratio">Maintain ratio</label>
						<input
							id="resize-ratio"
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
				{/snippet}
			</MoshGroup>
			{#if isImageFormat}
				<button class="action-btn save-btn" onclick={save}>
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
						<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
						<polyline points="7 10 12 15 17 10" />
						<line x1="12" y1="15" x2="12" y2="3" />
					</svg>
					SAVE
				</button>
			{/if}

			{#if isVideoFormat}
				<RecordGroup
					bind:this={recordGroupRef}
					{recording}
					{recordProgress}
					{recordFinalizing}
					bind:showSettings={showRecordSettings}
					onCancelRecording={cancelRecording}
				>
					{#snippet settingsContent()}
						{#if canIncludeAudio}
							<div class="mosh-setting-row">
								<label for="rec-with-audio">Include audio</label>
								<input
									id="rec-with-audio"
									type="checkbox"
									bind:checked={recordWithAudio}
								/>
							</div>
							{#if recordWithAudio && canRenderSpan}
								<div class="mosh-setting-row">
									<label for="rec-span-only">Render selected span</label>
									<input
										id="rec-span-only"
										type="checkbox"
										bind:checked={recordSpanOnly}
									/>
								</div>
							{/if}
						{/if}
						<div class="mosh-setting-row">
							<label for="rec-duration">Duration</label>
							{#if isVideo && videoDuration > 0}
								<span class="mosh-setting-val"
									>{recordDurationEffective.toFixed(1)}s (video span)</span
								>
							{:else if recordSpanOnly && trackFile && trackDuration > 0}
								<span class="mosh-setting-val"
									>{recordDurationEffective.toFixed(1)}s (span)</span
								>
							{:else}
								<input
									id="rec-duration"
									type="range"
									min="1"
									max="30"
									step="1"
									bind:value={recordDuration}
								/>
								<span class="mosh-setting-val">{recordDuration}s</span>
							{/if}
						</div>
						<div class="mosh-setting-row">
							<label for="rec-fps">FPS</label>
							<select id="rec-fps" bind:value={recordFps}>
								<option value={15}>15</option>
								<option value={24}>24</option>
								<option value={30}>30</option>
								<option value={60}>60</option>
								<option value={120}>120</option>
							</select>
							{#if recordFormat === 'gif' && recordFps > 15}
								<span class="rec-hint">capped to 15</span>
							{/if}
						</div>
						<button class="rec-start-btn" onclick={startRecording}>
							Start Recording
						</button>
					{/snippet}
				</RecordGroup>
			{/if}
		</div>
		{#if isVideo && videoDuration > 0}
			<div class="timeline-bar">
				<span class="timeline-label">VID</span>
				<button
					class="timeline-play-btn"
					onclick={videoPlaying ? pauseVideo : playVideo}
					title={videoPlaying ? 'Pause' : 'Play'}
				>
					{#if videoPlaying}
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
				<span class="timeline-time">{formatTime(videoCurrentTime)}</span>
				<div
					class="timeline-track-wrap"
					bind:this={videoTimelineTrackEl}
					role="slider"
					aria-label="Video timeline"
					aria-valuenow={videoCurrentTime}
					aria-valuemin={0}
					aria-valuemax={videoDuration}
					tabindex="0"
					onpointerdown={(e) => onVideoTimelinePointerDown(e, null)}
				>
					<div class="timeline-track">
						<div
							class="timeline-span"
							style="left: {(videoSpanStart / videoDuration) *
								100}%; width: {((videoSpanEnd - videoSpanStart) /
								videoDuration) *
								100}%"
						></div>
						<div
							class="timeline-playhead"
							style="left: {(videoCurrentTime / videoDuration) * 100}%"
							aria-hidden="true"
						></div>
						<button
							type="button"
							class="timeline-handle timeline-handle-start"
							style="left: {(videoSpanStart / videoDuration) * 100}%"
							title="Export span start"
							onpointerdown={(e) => {
								e.stopPropagation();
								onVideoTimelinePointerDown(e, 'start');
							}}
						></button>
						<button
							type="button"
							class="timeline-handle timeline-handle-end"
							style="left: {(videoSpanEnd / videoDuration) * 100}%"
							title="Export span end"
							onpointerdown={(e) => {
								e.stopPropagation();
								onVideoTimelinePointerDown(e, 'end');
							}}
						></button>
					</div>
				</div>
				<span class="timeline-time">{formatTime(videoSpanEnd)}</span>
				{#if analyserNode && !trackFile}
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
						title="Output volume: {Math.round(outputVolume * 100)}%"
					/>
				{/if}
			</div>
		{/if}
		{#if trackFile && trackDuration > 0}
			<div class="timeline-bar">
				<span class="timeline-label">AUD</span>
				<button
					class="timeline-play-btn"
					onclick={audioPlaying ? pauseTrack : playSpan}
					title={audioPlaying ? 'Pause' : 'Play span'}
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
							aria-hidden="true"
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
					title="Output volume: {Math.round(outputVolume * 100)}%"
				/>
				<button
					class="track-inline-btn"
					onclick={clearTrack}
					title="Remove track"
				>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>
			</div>
		{/if}
		<input
			bind:this={trackInput}
			type="file"
			accept="audio/*"
			onchange={onTrackInputChange}
			hidden
		/>
		{#if !trackFile}
			<div class="track-add-bar">
				<button class="track-add-btn" onclick={openTrackPicker}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M9 18V5l12-2v13" />
						<circle cx="6" cy="18" r="3" />
						<circle cx="18" cy="16" r="3" />
					</svg>
					Add audio track
				</button>
			</div>
		{/if}
	</div>
	<EffectsPanel
		bind:effects
		hasTrack={!!trackFile || (isVideo && !!analyserNode)}
		spectrumData={frequencyData && audioSampleRate > 0
			? {
					data: frequencyData as Uint8Array<ArrayBuffer>,
					sampleRate: audioSampleRate,
					binCount: audioFrequencyBinCount,
				}
			: null}
		onVolumeLinkChange={setVolumeLink}
	/>

	<RecordOverlay
		{recording}
		{recordProgress}
		{recordFinalizing}
		recordFormat={recordFormat}
		onCancel={cancelRecording}
	/>

	{#if dragging}
		<div class="drop-overlay">
			<span>Drop image to replace</span>
		</div>
	{/if}
</div>

<style>
	.editor {
		display: flex;
		height: 100%;
		width: 100%;
		overflow: hidden;
	}

	.main-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		position: relative;
		min-width: 0;
	}

	.top-bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: rgba(30, 30, 30, 0.85);
		border: 1px solid #333;
		border-radius: 6px;
		color: #aaa;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.back-btn:hover {
		color: #fff;
		border-color: #555;
	}

	.format-group {
		display: flex;
		background: rgba(30, 30, 30, 0.85);
		border: 1px solid #333;
		border-radius: 6px;
		overflow: hidden;
	}

	.format-btn {
		padding: 0.35rem 0.9rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		font-family: inherit;
		background: none;
		border: none;
		color: #777;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.format-btn:not(:last-child) {
		border-right: 1px solid #333;
	}

	.format-btn.active {
		color: #ddd;
		background: rgba(255, 255, 255, 0.06);
	}

	.format-btn:hover {
		color: #ccc;
	}

	.settings-divider {
		height: 1px;
		background: #333;
		margin: 0.15rem 0;
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

	/* Timeline */
	.timeline-label {
		font-size: 0.55rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		color: #555;
		min-width: 1.6rem;
		text-align: center;
		flex-shrink: 0;
	}

	.timeline-bar {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: rgba(18, 18, 18, 0.9);
		border-top: 1px solid #2a2a2a;
	}

	.timeline-play-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 1px solid #444;
		border-radius: 6px;
		background: rgba(30, 30, 30, 0.9);
		color: #aaa;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s,
			background 0.15s;
		flex-shrink: 0;
	}

	.timeline-play-btn:hover {
		color: #fff;
		border-color: #555;
		background: rgba(255, 255, 255, 0.06);
	}

	.timeline-time {
		font-size: 0.7rem;
		color: #666;
		min-width: 2.2rem;
		font-variant-numeric: tabular-nums;
	}

	.timeline-track-wrap {
		flex: 1;
		min-width: 0;
		cursor: pointer;
		outline: none;
	}

	.timeline-track-wrap:focus-visible {
		outline: 1px solid #555;
		outline-offset: 2px;
	}

	.timeline-track {
		position: relative;
		height: 20px;
		background: #222;
		border-radius: 4px;
		overflow: visible;
	}

	.timeline-span {
		position: absolute;
		top: 0;
		bottom: 0;
		background: rgba(255, 255, 255, 0.12);
		border-radius: 4px;
		pointer-events: none;
	}

	.timeline-playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: #888;
		margin-left: -1px;
		pointer-events: none;
	}

	.timeline-handle {
		position: absolute;
		top: 50%;
		width: 10px;
		height: 16px;
		margin: -8px 0 0 -5px;
		border: 1px solid #555;
		border-radius: 3px;
		background: #444;
		cursor: ew-resize;
		transition:
			background 0.15s,
			border-color 0.15s;
	}

	.timeline-handle:hover {
		background: #555;
		border-color: #666;
	}

	.timeline-handle:focus-visible {
		outline: 1px solid #888;
		outline-offset: 1px;
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
		transition: color 0.15s, border-color 0.15s;
	}

	.track-add-btn:hover {
		color: #aaa;
		border-color: #555;
	}

	.volume-slider {
		width: 60px;
		height: 4px;
		appearance: none;
		background: #333;
		border-radius: 2px;
		cursor: pointer;
		flex-shrink: 0;
	}
	.volume-slider::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
	}
	.volume-slider::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #aaa;
		border: none;
		cursor: pointer;
	}
	.volume-slider:hover::-webkit-slider-thumb {
		background: #fff;
	}
	.volume-slider:hover::-moz-range-thumb {
		background: #fff;
	}

	.track-inline-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: 4px;
		background: none;
		color: #555;
		cursor: pointer;
		flex-shrink: 0;
		transition: color 0.15s, background 0.15s;
	}

	.track-inline-btn:hover {
		color: #ccc;
		background: rgba(255, 255, 255, 0.06);
	}

	/* Action bar */
	.action-bar {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
		padding: 1rem;
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

	.mosh-setting-row label {
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

	.rec-hint {
		font-size: 0.6rem;
		color: #886;
		white-space: nowrap;
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
</style>
