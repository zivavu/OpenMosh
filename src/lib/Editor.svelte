<script lang="ts">
	import EffectsPanel from './EffectsPanel.svelte';
	import GlCanvas from './GlCanvas.svelte';
	import {
		EFFECT_DEFINITIONS,
		FREQ_PRESETS,
		createEffectInstance,
		getDefinition,
		type EffectInstance,
		type VolumeLink,
	} from './effects';
	import type { GlRenderer } from './gl/renderer';
	import { downloadBlob, recordVideo, type RecordFormat } from './recorder';

	interface Props {
		file: File;
		onBack: () => void;
		onfile: (f: File) => void;
	}

	let { file, onBack, onfile }: Props = $props();
	let dragging = $state(false);

	let isVideo = $derived(file.type.startsWith('video/'));
	let videoEl = $state<HTMLVideoElement | null>(null);

	let format: 'png' | 'jpg' = $state('png');
	let imageSrc = $derived(URL.createObjectURL(file));
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let glRenderer: GlRenderer | null = $state(null);
	let effects: EffectInstance[] = $state(
		EFFECT_DEFINITIONS.map(createEffectInstance),
	);

	let moshMin = $state(7);
	let moshMax = $state(14);
	let randomizeOrder = $state(true);
	let showMoshSettings = $state(false);
	let moshAudioLink = $state(true);
	let showFps = $state(false);
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

	function setResizeWidth(w: number) {
		const val = Math.max(1, Math.round(w));
		resizeWidth = val;
		if (maintainRatio && aspectRatio > 0) {
			resizeHeight = Math.max(1, Math.round(val / aspectRatio));
		}
	}

	function setResizeHeight(h: number) {
		const val = Math.max(1, Math.round(h));
		resizeHeight = val;
		if (maintainRatio && aspectRatio > 0) {
			resizeWidth = Math.max(1, Math.round(val * aspectRatio));
		}
	}

	function resetResize() {
		if (naturalWidth != null && naturalHeight != null) {
			resizeWidth = naturalWidth;
			resizeHeight = naturalHeight;
		}
	}

	function onTrackInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file && file.type.startsWith('audio/')) {
			disposeAudioGraph();
			trackFile = file;
		}
		input.value = '';
	}

	function openTrackPicker() {
		trackInput?.click();
	}

	function clearTrack() {
		disposeAudioGraph();
		trackFile = null;
		if (isVideo && videoEl) ensureVideoAudioGraph();
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

	function formatTime(sec: number): string {
		if (!Number.isFinite(sec) || sec < 0) return '0:00';
		const m = Math.floor(sec / 60);
		const s = Math.floor(sec % 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function ensureAudioGraph() {
		if (!audioEl || audioContext) return;
		const ctx = new AudioContext();
		const source = ctx.createMediaElementSource(audioEl);
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 2048;
		source.connect(analyser);
		analyser.connect(ctx.destination);
		audioContext = ctx;
		mediaSource = source;
		analyserNode = analyser;
		frequencyData = new Uint8Array(analyser.frequencyBinCount);
		audioSampleRate = ctx.sampleRate;
		audioFrequencyBinCount = analyser.frequencyBinCount;
	}

	function ensureVideoAudioGraph() {
		if (!videoEl || audioContext || trackFile) return;
		videoEl.muted = false;
		const ctx = new AudioContext();
		const source = ctx.createMediaElementSource(videoEl);
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 2048;
		source.connect(analyser);
		analyser.connect(ctx.destination);
		audioContext = ctx;
		mediaSource = source;
		analyserNode = analyser;
		frequencyData = new Uint8Array(analyser.frequencyBinCount);
		audioSampleRate = ctx.sampleRate;
		audioFrequencyBinCount = analyser.frequencyBinCount;
		ctx.resume().catch(() => {});
	}

	function disposeAudioGraph() {
		mediaSource = null;
		analyserNode = null;
		frequencyData = null;
		audioSampleRate = 0;
		audioFrequencyBinCount = 0;
		if (audioContext) {
			audioContext.close();
			audioContext = null;
		}
		volumeLevel = 0;
	}

	function getLevelFromFrequencyRange(
		freqData: Uint8Array,
		sampleRate: number,
		fftSize: number,
		freqMin: number,
		freqMax: number,
	): number {
		const binCount = freqData.length;
		const minBin = Math.max(0, Math.floor((freqMin / sampleRate) * fftSize));
		const maxBin = Math.min(
			binCount - 1,
			Math.ceil((freqMax / sampleRate) * fftSize),
		);
		if (minBin > maxBin) return 0;
		let sum = 0;
		for (let i = minBin; i <= maxBin; i++) sum += freqData[i];
		const count = maxBin - minBin + 1;
		return Math.min(1, sum / count / 255);
	}

	function applyRandomAudioLinks() {
		if (!trackFile || !audioContext) {
			for (const effect of effects) {
				if (effect.volumeLinks) delete effect.volumeLinks;
			}
			return;
		}

		const nyquist = audioSampleRate > 0 ? audioSampleRate / 2 : 22050;

		for (const effect of effects) {
			const def = getDefinition(effect.defId);
			if (!def) continue;

			if (!effect.enabled) {
				if (effect.volumeLinks) delete effect.volumeLinks;
				continue;
			}

			const links: Record<string, VolumeLink> = {};

			for (const param of def.params) {
				if (param.type !== 'range') continue;

				if (Math.random() > 0.8) continue;

				const pMin = param.min;
				const pMax = param.max;
				const span = pMax - pMin;
				const t1 = Math.random();
				const t2 = Math.random();
				let vMin = pMin + Math.min(t1, t2) * span;
				let vMax = pMin + Math.max(t1, t2) * span;

				if (param.step > 0) {
					const snap = (v: number) =>
						Math.round((v - pMin) / param.step) * param.step + pMin;
					vMin = snap(vMin);
					vMax = snap(vMax);
					if (vMax <= vMin) vMax = Math.min(pMax, vMin + param.step);
				}

				let freqMin: number | undefined;
				let freqMax: number | undefined;

				const mode = Math.random();
				if (mode < 0.2 || !frequencyData || audioSampleRate <= 0) {
					// Full spectrum
				} else if (mode < 0.4) {
					freqMin = FREQ_PRESETS.low.min;
					freqMax = FREQ_PRESETS.low.max;
				} else if (mode < 0.7) {
					freqMin = FREQ_PRESETS.mid.min;
					freqMax = FREQ_PRESETS.mid.max;
				} else if (mode < 0.9) {
					freqMin = FREQ_PRESETS.high.min;
					freqMax = FREQ_PRESETS.high.max;
				} else {
					// Custom random band
					const f1 = 20 + Math.random() * (nyquist - 20);
					const f2 = 20 + Math.random() * (nyquist - 20);
					freqMin = Math.min(f1, f2);
					freqMax = Math.max(f1, f2);
				}

				const link: VolumeLink = { min: vMin, max: vMax };
				if (freqMin != null && freqMax != null) {
					link.freqMin = freqMin;
					link.freqMax = freqMax;
				}

				links[param.key] = link;
			}

			if (Object.keys(links).length > 0) {
				effect.volumeLinks = links;
			} else if (effect.volumeLinks) {
				delete effect.volumeLinks;
			}
		}
	}

	$effect(() => {
		const analyser = analyserNode;
		if (!analyser) return;
		const timeData = new Uint8Array(analyser.fftSize);
		const freqDataRef = frequencyData;
		const sampleRate = audioSampleRate;
		const binCount = audioFrequencyBinCount;
		const fftSize = analyser.fftSize;
		let rafId: number;
		function tick() {
			if (!analyser) return;
			analyser.getByteTimeDomainData(timeData);
			let sum = 0;
			for (let i = 0; i < timeData.length; i++) {
				const n = (timeData[i] - 128) / 128;
				sum += n * n;
			}
			volumeLevel = Math.min(1, Math.sqrt(sum / timeData.length));
			if (freqDataRef)
				analyser.getByteFrequencyData(freqDataRef as Uint8Array<ArrayBuffer>);
			for (const effect of effects) {
				const links = effect.volumeLinks;
				if (!links) continue;
				const def = getDefinition(effect.defId);
				if (!def) continue;
				for (const param of def.params) {
					if (param.type !== 'range') continue;
					const link = links[param.key];
					if (!link) continue;
					const level =
						link.freqMin != null &&
						link.freqMax != null &&
						freqDataRef &&
						sampleRate > 0
							? getLevelFromFrequencyRange(
									freqDataRef,
									sampleRate,
									fftSize,
									link.freqMin,
									link.freqMax,
								)
							: volumeLevel;
					const { min: pMin, max: pMax, step } = param;
					let value = link.min + level * (link.max - link.min);
					value = Math.max(pMin, Math.min(pMax, value));
					if (step > 0) {
						value = Math.round((value - pMin) / step) * step + pMin;
						value = Math.max(pMin, Math.min(pMax, value));
					}
					effect.values[param.key] = value;
				}
			}
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
	let moshGroupEl: HTMLDivElement;

	function handleClickOutside(e: MouseEvent) {
		if (
			showMoshSettings &&
			moshGroupEl &&
			!moshGroupEl.contains(e.target as Node)
		) {
			showMoshSettings = false;
		}
	}

	function pushHistory() {
		history.length = historyIndex + 1;
		history.push($state.snapshot(effects));
		historyIndex = history.length - 1;
	}

	function generateMosh() {
		const moshable = effects.filter((e) => !e.locked);
		const clampedMin = Math.min(moshMin, moshable.length);
		const clampedMax = Math.min(moshMax, moshable.length);
		const target =
			clampedMin + Math.floor(Math.random() * (clampedMax - clampedMin + 1));

		const indices = moshable.map((_, i) => i);
		for (let i = indices.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[indices[i], indices[j]] = [indices[j], indices[i]];
		}
		const enabledSet = new Set(indices.slice(0, target));

		moshable.forEach((effect, i) => {
			effect.enabled = enabledSet.has(i);
			if (!effect.enabled) return;
			const def = EFFECT_DEFINITIONS.find((d) => d.id === effect.defId);
			if (!def) return;
			for (const param of def.params) {
				if (param.type === 'range') {
					const lo = param.moshMin ?? param.min;
					const hi = param.moshMax ?? param.max;
					const range = hi - lo;
					const bias = 0.15 + Math.random() * 0.55;
					effect.values[param.key] =
						Math.round((lo + bias * range) / param.step) * param.step;
				} else if (param.type === 'select') {
					const options = param.options;
					effect.values[param.key] =
						options[Math.floor(Math.random() * options.length)].value;
				}
			}
		});

		if (randomizeOrder) {
			const moshableIndices = effects
				.map((e, i) => (e.locked ? -1 : i))
				.filter((i) => i !== -1);
			const shuffled = [...moshableIndices];
			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
			}
			const snapshot = effects.map((e) => $state.snapshot(e));
			for (let k = 0; k < moshableIndices.length; k++) {
				effects[moshableIndices[k]] = snapshot[shuffled[k]];
			}
		}

		if (moshAudioLink) {
			applyRandomAudioLinks();
		} else {
			for (const effect of effects) {
				if (effect.volumeLinks) delete effect.volumeLinks;
			}
		}

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
		for (const effect of effects) {
			effect.enabled = false;
			const def = EFFECT_DEFINITIONS.find((d) => d.id === effect.defId);
			if (!def) continue;
			for (const param of def.params) {
				effect.values[param.key] = param.defaultValue;
			}
		}
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

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			save();
			return;
		}

		const el = e.target as HTMLElement;
		if (
			el.tagName === 'INPUT' ||
			el.tagName === 'TEXTAREA' ||
			el.tagName === 'SELECT' ||
			el.isContentEditable
		)
			return;

		if (e.key === ' ') {
			if (trackFile && audioEl) {
				e.preventDefault();
				if (audioPlaying) pauseTrack();
				else playSpan();
			}
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			mosh();
		} else if (
			e.key === 'ArrowLeft' ||
			(e.key === 'z' && (e.ctrlKey || e.metaKey))
		) {
			e.preventDefault();
			undo();
		} else if (
			e.key.toLowerCase() === 'v' &&
			!e.ctrlKey &&
			!e.metaKey &&
			!e.altKey
		) {
			e.preventDefault();
			reInput();
		}
	}

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
	let recordFormat: RecordFormat = $state('mp4');
	let recordDuration = $state(5);
	let recordFps = $state(24);
	let recordWithAudio = $state(false);
	let recordSpanOnly = $state(false);
	let recording = $state(false);
	let recordProgress = $state(0);
	let recordFinalizing = $state(false);
	let recordAbort: AbortController | null = $state(null);
	let recordGroupEl: HTMLDivElement;

	let recordDurationEffective = $derived(
		recordSpanOnly && trackFile && trackDuration > 0
			? spanEnd - spanStart
			: recordDuration,
	);
	let canIncludeAudio = $derived(
		!!trackFile &&
			trackDuration > 0 &&
			(recordFormat === 'mp4' || recordFormat === 'webm'),
	);
	let canRenderSpan = $derived(
		!!recordWithAudio && !!trackFile && trackDuration > 0,
	);

	function handleRecordClickOutside(e: MouseEvent) {
		if (
			showRecordSettings &&
			recordGroupEl &&
			!recordGroupEl.contains(e.target as Node)
		) {
			showRecordSettings = false;
		}
	}

	async function startRecording() {
		if (!canvasEl || !glRenderer || recording) return;
		showRecordSettings = false;
		recording = true;
		recordProgress = 0;
		recordFinalizing = false;
		const abort = new AbortController();
		recordAbort = abort;

		const duration =
			recordSpanOnly && trackFile && trackDuration > 0
				? spanEnd - spanStart
				: recordDuration;
		const useAudio =
			(recordWithAudio || recordFormat === 'gif') &&
			trackFile &&
			trackDuration > 0;
		const audioStart = recordSpanOnly ? spanStart : 0;
		const audioEnd = recordSpanOnly
			? spanEnd
			: Math.min(recordDuration, trackDuration);

		if (isVideo && videoEl) videoEl.pause();
		try {
			const blob = await recordVideo({
				format: recordFormat,
				duration,
				fps: recordFormat === 'gif' ? Math.min(recordFps, 15) : recordFps,
				canvas: canvasEl,
				renderer: glRenderer,
				effects: $state.snapshot(effects) as EffectInstance[],
				onProgress: (p) => {
					recordProgress = p;
				},
				onFinalizing: () => {
					recordFinalizing = true;
				},
				signal: abort.signal,
				...(useAudio &&
					trackFile && {
						audioFile: trackFile,
						audioStart,
						audioEnd,
					}),
				...(isVideo && videoEl && { sourceVideo: videoEl }),
			});
			downloadBlob(blob, recordFormat);
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
		handleClickOutside(e);
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
		if (f && (f.type.startsWith('image/') || f.type.startsWith('video/'))) onfile(f);
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
				</div>
				<div class="track-group">
					<input
						bind:this={trackInput}
						type="file"
						accept="audio/*"
						onchange={onTrackInputChange}
						hidden
					/>
					{#if trackFile}
						<span class="track-name" title={trackFile.name}>
							{trackFile.name.length > 20
								? trackFile.name.slice(0, 17) + '…'
								: trackFile.name}
						</span>
						<button
							class="track-clear-btn"
							onclick={clearTrack}
							title="Clear track"
						>
							<svg
								width="12"
								height="12"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<line x1="18" y1="6" x2="6" y2="18" />
								<line x1="6" y1="6" x2="18" y2="18" />
							</svg>
						</button>
						<button
							class="track-load-btn"
							onclick={openTrackPicker}
							title="Replace track"
						>
							Replace
						</button>
					{:else}
						<button
							class="track-load-btn"
							onclick={openTrackPicker}
							title="Load track"
						>
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
								<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
								<polyline points="17 8 12 3 7 8" />
								<line x1="12" y1="3" x2="12" y2="15" />
							</svg>
							Load track
						</button>
					{/if}
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
				onloadedmetadata={() => { recordDuration = Math.round(videoEl!.duration * 10) / 10; ensureVideoAudioGraph(); }}
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
			{showFps}
			videoEl={isVideo ? videoEl : null}
		/>

		<div class="action-bar">
			<div class="mosh-group" bind:this={moshGroupEl}>
				<button
					class="settings-btn"
					class:active={showMoshSettings}
					onclick={() => (showMoshSettings = !showMoshSettings)}
					title="Mosh settings"
				>
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
						<circle cx="12" cy="12" r="3" />
						<path
							d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
						/>
					</svg>
				</button>
				<button
					class="settings-btn"
					onclick={clearEffects}
					title="Clear all effects"
				>
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
						<path d="M18 6L6 18" />
						<path d="M6 6l12 12" />
					</svg>
				</button>
				<button
					class="settings-btn"
					onclick={undo}
					disabled={!canUndo}
					title="Undo (← / Ctrl+Z)"
				>
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
						<polyline points="1 4 1 10 7 10" />
						<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
					</svg>
				</button>
				<button class="action-btn mosh-btn" onclick={mosh}>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
					</svg>
					MOSH
				</button>

				{#if showMoshSettings}
					<div class="mosh-settings">
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
					</div>
				{/if}
			</div>
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

			<div class="record-group" bind:this={recordGroupEl}>
				<button
					class="action-btn record-btn"
					onclick={() => (showRecordSettings = !showRecordSettings)}
					disabled={recording}
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
						<circle cx="12" cy="12" r="10" />
						<circle cx="12" cy="12" r="4" fill="currentColor" />
					</svg>
					RECORD
				</button>

				{#if showRecordSettings}
					<div class="record-settings">
						<div class="mosh-setting-row">
							<label for="rec-format">Format</label>
							<select id="rec-format" bind:value={recordFormat}>
								<option value="mp4">MP4</option>
								<option value="webm">WebM</option>
								<option value="gif">GIF</option>
							</select>
						</div>
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
							{#if recordSpanOnly && trackFile && trackDuration > 0}
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
					</div>
				{/if}
			</div>
		</div>

		{#if trackFile && trackDuration > 0}
			<div class="timeline-bar">
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

	{#if recording}
		<div class="record-overlay">
			<div class="record-modal">
				<p class="record-title">
					{recordFinalizing
						? 'Creating file…'
						: `Recording ${recordFormat.toUpperCase()}...`}
				</p>
				<div class="progress-track" class:finalizing={recordFinalizing}>
					<div
						class="progress-fill"
						style="width: {Math.round(recordProgress * 100)}%"
					></div>
				</div>
				<p class="record-pct">{Math.round(recordProgress * 100)}%</p>
				<button class="rec-cancel-btn" onclick={cancelRecording}>Cancel</button>
			</div>
		</div>
	{/if}

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

	.track-group {
		display: flex;
		align-items: stretch;
		gap: 0;
		background: rgba(30, 30, 30, 0.85);
		border: 1px solid #333;
		border-radius: 6px;
		overflow: hidden;
	}

	.track-name {
		font-size: 0.7rem;
		color: #aaa;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: flex;
		align-items: center;
		padding: 0 0.5rem;
	}

	.track-load-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.75rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		font-family: inherit;
		background: none;
		border: none;
		border-radius: 0;
		color: #777;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
		flex-shrink: 0;
	}

	.track-load-btn:hover {
		color: #ccc;
		background: rgba(255, 255, 255, 0.06);
	}

	.track-clear-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		min-width: 28px;
		border: none;
		border-radius: 0;
		background: none;
		color: #666;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
		flex-shrink: 0;
	}

	.track-clear-btn:hover {
		color: #ccc;
		background: rgba(255, 255, 255, 0.06);
	}

	/* Timeline */
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

	.mosh-btn:hover {
		border-color: #a89050;
		color: #f0d878;
	}

	.mosh-group {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.settings-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: none;
		border: 1.5px solid #444;
		color: #888;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.settings-btn:hover,
	.settings-btn.active {
		border-color: #777;
		color: #ccc;
	}

	.settings-btn:disabled {
		opacity: 0.3;
		cursor: default;
		pointer-events: none;
	}

	.mosh-settings {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 50%;
		transform: translateX(-50%);
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 210px;
		z-index: 20;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
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

	/* Record button & settings */
	.record-group {
		position: relative;
		display: flex;
		align-items: center;
	}

	.record-btn:hover {
		border-color: #c05050;
		color: #ff8888;
	}

	.record-settings {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		right: 0;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 230px;
		z-index: 20;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
	}

	.record-settings select {
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

	.record-settings select:focus {
		border-color: #555;
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

	/* Recording overlay */
	.record-overlay {
		position: absolute;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.record-modal {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 3rem;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
	}

	.record-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #ddd;
		letter-spacing: 0.04em;
	}

	.progress-track {
		width: 200px;
		height: 4px;
		background: #333;
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: #c05050;
		border-radius: 2px;
		transition: width 0.15s;
	}

	.progress-track.finalizing .progress-fill {
		animation: record-finalize-pulse 1.2s ease-in-out infinite;
	}

	@keyframes record-finalize-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.65;
		}
	}

	.record-pct {
		font-size: 0.75rem;
		color: #999;
		font-variant-numeric: tabular-nums;
	}

	.rec-cancel-btn {
		padding: 0.35rem 1.2rem;
		border: 1px solid #444;
		border-radius: 6px;
		background: none;
		color: #999;
		font-size: 0.7rem;
		font-family: inherit;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.rec-cancel-btn:hover {
		color: #ddd;
		border-color: #666;
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
