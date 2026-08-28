<script lang="ts">
	import { Pause, Play, X } from 'lucide-svelte';
	import {
		DEFAULT_CHROMA_KEY,
		type ChromaKey,
		type SourceEdit,
	} from '../../media';
	import type { SequenceSource } from '../../editor/sequence-sources.svelte';
	import RangeSlider from '../ui/RangeSlider.svelte';

	interface Props {
		/** The media being edited. The edit belongs to it, not to any layer. */
		source: SequenceSource;
		edit: SourceEdit;
		onChange: (edit: SourceEdit) => void;
		onClose: () => void;
	}

	let { source, edit, onChange, onClose }: Props = $props();

	/** Long edge of the preview. Small enough that keying every pixel in JS on
	 * every played frame stays well inside the frame budget. */
	const PREVIEW_MAX = 360;

	let key = $derived(edit.chromaKey);
	let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);
	let loadError = $state<string | null>(null);
	/** True once the media is decoded and its first frame is on the canvas. */
	let ready = $state(false);

	// Video transport. A duration of 0 covers both "still an image" and "not
	// loaded yet", which are the same thing as far as the controls care.
	let duration = $state(0);
	let currentTime = $state(0);
	let playing = $state(false);

	/**
	 * The current frame, unkeyed, at preview size. Everything reads from here:
	 * the keyed preview is drawn from it, and the eyedropper samples it — off
	 * the keyed canvas the dropper would keep landing on cut-out pixels.
	 */
	let raw: HTMLCanvasElement | null = null;
	let rawCtx: CanvasRenderingContext2D | null = null;
	/** Where frames come from. An image draws once; a video every frame. */
	let media: HTMLImageElement | HTMLVideoElement | null = null;

	function setKey<K extends keyof ChromaKey>(prop: K, value: ChromaKey[K]) {
		onChange({ ...edit, chromaKey: { ...key, [prop]: value } });
	}

	/** Picking a colour switches the key on: nobody reaches for the dropper to
	 * leave it off, and the preview would show nothing otherwise. */
	function setColor(r: number, g: number, b: number) {
		onChange({
			...edit,
			chromaKey: { ...key, enabled: true, color: { r, g, b } },
		});
	}

	// ── Loading ──────────────────────────────────────────────────────────────
	$effect(() => {
		const src = source;
		let cancelled = false;
		loadError = null;
		ready = false;
		load(src)
			.then(() => {
				if (cancelled) return;
				ready = true;
				grabFrame();
				paint();
			})
			.catch(() => {
				if (!cancelled) loadError = 'Could not read this media.';
			});
		return () => {
			cancelled = true;
			playing = false;
			if (media && 'pause' in media) media.pause();
			media = null;
		};
	});

	async function load(src: SequenceSource): Promise<void> {
		const el =
			src.kind === 'video'
				? await videoElement(src.objectUrl)
				: await imageElement(src.objectUrl);
		const w = 'videoWidth' in el ? el.videoWidth : el.naturalWidth;
		const h = 'videoHeight' in el ? el.videoHeight : el.naturalHeight;
		if (!w || !h) throw new Error('no dimensions');
		media = el;
		duration =
			'duration' in el && Number.isFinite(el.duration) ? el.duration : 0;
		currentTime = 'currentTime' in el ? el.currentTime : 0;
		const k = Math.min(PREVIEW_MAX / w, PREVIEW_MAX / h, 1);
		raw = document.createElement('canvas');
		raw.width = Math.max(1, Math.round(w * k));
		raw.height = Math.max(1, Math.round(h * k));
		rawCtx = raw.getContext('2d', { willReadFrequently: true });
	}

	function imageElement(url: string): Promise<HTMLImageElement> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('decode failed'));
			img.src = url;
		});
	}

	function videoElement(url: string): Promise<HTMLVideoElement> {
		return new Promise((resolve, reject) => {
			const v = document.createElement('video');
			// Silent by design: this is a colour-picking dialog, and the editor's
			// own preview may well be playing behind it.
			v.muted = true;
			v.playsInline = true;
			v.preload = 'auto';
			v.onerror = () => reject(new Error('decode failed'));
			// Repaints a scrub while paused; during playback the loop owns the
			// frame and this just lands on top of the same picture.
			v.onseeked = () => {
				grabFrame();
				paint();
			};
			v.onended = () => (playing = false);
			v.onloadeddata = () => {
				// Not frame 0: some encodes open on a black or faded lead-in, which
				// keys to nothing useful.
				v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
				resolve(v);
			};
			v.src = url;
		});
	}

	// ── Playback ─────────────────────────────────────────────────────────────
	$effect(() => {
		if (!playing || !ready) return;
		const v = media;
		if (!v || !('play' in v)) return;
		void v.play().catch(() => (playing = false));
		let raf = requestAnimationFrame(function tick() {
			currentTime = v.currentTime;
			grabFrame();
			paint();
			raf = requestAnimationFrame(tick);
		});
		return () => {
			cancelAnimationFrame(raf);
			v.pause();
		};
	});

	function seekTo(t: number) {
		const v = media;
		if (!v || !('currentTime' in v)) return;
		currentTime = t;
		v.currentTime = t;
	}

	function formatTime(t: number): string {
		const s = Math.max(0, Math.floor(t));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}

	// ── Drawing ──────────────────────────────────────────────────────────────
	/** Copy whatever the media is showing right now into the raw buffer. */
	function grabFrame() {
		if (!media || !raw || !rawCtx) return;
		rawCtx.drawImage(media, 0, 0, raw.width, raw.height);
	}

	// The same key test the placement shader runs, in JS. Two copies of one
	// rule, so keep them in step — see LAYER_TRANSFORM_FRAG.
	function chroma(r: number, g: number, b: number): [number, number] {
		return [
			-0.169 * r - 0.331 * g + 0.5 * b,
			0.5 * r - 0.419 * g - 0.081 * b,
		];
	}

	function luma(r: number, g: number, b: number): number {
		return 0.299 * r + 0.587 * g + 0.114 * b;
	}

	/** Raw buffer → visible canvas, with the key applied. */
	function paint() {
		const canvas = canvasEl;
		if (!canvas || !raw || !rawCtx) return;
		if (canvas.width !== raw.width) canvas.width = raw.width;
		if (canvas.height !== raw.height) canvas.height = raw.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		if (!key.enabled || key.threshold <= 0) {
			ctx.drawImage(raw, 0, 0);
			return;
		}
		const img = rawCtx.getImageData(0, 0, raw.width, raw.height);
		const px = img.data;
		const [kx, ky] = chroma(key.color.r, key.color.g, key.color.b);
		const kl = luma(key.color.r, key.color.g, key.color.b);
		const lo = key.threshold;
		const hi = lo + Math.max(key.smoothing, 0.0001);
		// Brightness rescaled onto the chroma threshold — the cylinder the shader
		// keys against.
		const lumaScale = lo / Math.max(key.lumaRange, 0.0001);
		for (let i = 0; i < px.length; i += 4) {
			const r = px[i] / 255;
			const g = px[i + 1] / 255;
			const b = px[i + 2] / 255;
			const [cx, cy] = chroma(r, g, b);
			const dx = cx - kx;
			const dy = cy - ky;
			const d = Math.max(
				Math.sqrt(dx * dx + dy * dy),
				Math.abs(luma(r, g, b) - kl) * lumaScale,
			);
			const t = Math.min(1, Math.max(0, (d - lo) / (hi - lo)));
			px[i + 3] *= t * t * (3 - 2 * t);
		}
		ctx.putImageData(img, 0, 0);
	}

	// Repaint when a knob moves. Playback repaints every frame on its own, so
	// this only has to cover a paused preview.
	$effect(() => {
		// Read every knob, so any of them moving re-runs this.
		void [
			key.enabled,
			key.color,
			key.threshold,
			key.smoothing,
			key.lumaRange,
		];
		if (ready && !playing) paint();
	});

	function pickAt(e: MouseEvent) {
		const canvas = canvasEl;
		if (!canvas || !raw || !rawCtx) return;
		const rect = canvas.getBoundingClientRect();
		const x = Math.floor(((e.clientX - rect.left) / rect.width) * raw.width);
		const y = Math.floor(((e.clientY - rect.top) / rect.height) * raw.height);
		const [r, g, b] = rawCtx.getImageData(x, y, 1, 1).data;
		setColor(r / 255, g / 255, b / 255);
	}

	function toHex({ r, g, b }: ChromaKey['color']): string {
		const h = (v: number) =>
			Math.round(Math.min(1, Math.max(0, v)) * 255)
				.toString(16)
				.padStart(2, '0');
		return `#${h(r)}${h(g)}${h(b)}`;
	}

	function onHexInput(e: Event) {
		const hex = (e.currentTarget as HTMLInputElement).value;
		const n = parseInt(hex.slice(1), 16);
		setColor(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
	}

	function reset() {
		onChange({
			...edit,
			chromaKey: {
				...DEFAULT_CHROMA_KEY,
				color: { ...DEFAULT_CHROMA_KEY.color },
				enabled: key.enabled,
			},
		});
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
			return;
		}
		// Space is the transport here as it is everywhere else — except while a
		// control has focus, where it means "press this".
		if (e.key === ' ' && duration > 0) {
			if ((e.target as HTMLElement | null)?.closest('button, input')) return;
			e.preventDefault();
			playing = !playing;
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="edit-overlay" onclick={onClose}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="edit-dialog" onclick={(e) => e.stopPropagation()}>
		<div class="dialog-head">
			<h3>
				Edit media
				<span class="dialog-src">{source.name}</span>
			</h3>
			<button
				class="close-btn"
				onclick={onClose}
				title="Close (Esc)"
				aria-label="Close"
			>
				<X size={14} />
			</button>
		</div>

		<div class="preview">
			{#if loadError}
				<p class="warn">{loadError}</p>
			{:else if !ready}
				<p class="warn">Reading media…</p>
			{:else}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<canvas bind:this={canvasEl} onclick={pickAt} aria-label="Media preview"
				></canvas>
			{/if}
		</div>

		{#if duration > 0}
			<!-- Videos get a transport: the background to key out is rarely the
			     same colour all the way through, so the whole clip has to be
			     watchable with the key live on it. -->
			<div class="transport">
				<button
					class="play-btn"
					onclick={() => (playing = !playing)}
					disabled={!ready}
					title={playing ? 'Pause (Space)' : 'Play (Space)'}
					aria-label={playing ? 'Pause' : 'Play'}
				>
					{#if playing}<Pause size={12} />{:else}<Play size={12} />{/if}
				</button>
				<RangeSlider
					value={Math.min(currentTime, duration)}
					min={0}
					max={duration}
					step={0.01}
					disabled={!ready}
					oninput={seekTo}
				/>
				<span class="val">{formatTime(currentTime)}</span>
			</div>
		{/if}

		<div class="rows">
			<div class="row">
				<label for="ck-on">Remove background</label>
				<input
					id="ck-on"
					type="checkbox"
					checked={key.enabled}
					onchange={(e) => setKey('enabled', e.currentTarget.checked)}
				/>
			</div>

			<div class="row">
				<label for="ck-color">Key colour</label>
				<div class="color-cell">
					<input
						id="ck-color"
						type="color"
						value={toHex(key.color)}
						oninput={onHexInput}
					/>
					<span class="hint">or click the preview to pick it</span>
				</div>
			</div>

			<div class="row">
				<label for="ck-thr">Threshold</label>
				<RangeSlider
					id="ck-thr"
					value={key.threshold}
					min={0.01}
					max={1}
					step={0.005}
					disabled={!key.enabled}
					oninput={(v) => setKey('threshold', v)}
				/>
				<span class="val">{Math.round(key.threshold * 100)}</span>
			</div>

			<div
				class="row"
				title="How far a pixel's brightness may differ from the key colour's. Wide cuts every shade of it, shadows and hot spots included; narrow matches one exact shade, which is what an unsaturated background needs."
			>
				<label for="ck-luma">Brightness range</label>
				<RangeSlider
					id="ck-luma"
					value={key.lumaRange}
					min={0.01}
					max={1}
					step={0.005}
					disabled={!key.enabled}
					oninput={(v) => setKey('lumaRange', v)}
				/>
				<span class="val">{Math.round(key.lumaRange * 100)}</span>
			</div>

			<div class="row">
				<label for="ck-smooth">Smoothing</label>
				<RangeSlider
					id="ck-smooth"
					value={key.smoothing}
					min={0}
					max={0.5}
					step={0.005}
					disabled={!key.enabled}
					oninput={(v) => setKey('smoothing', v)}
				/>
				<span class="val">{Math.round(key.smoothing * 100)}</span>
			</div>
		</div>

		<div class="dialog-foot">
			<button class="ghost-btn" onclick={reset}>Reset</button>
			<button class="ghost-btn" onclick={onClose}>Done</button>
		</div>
	</div>
</div>
<style>
	.edit-overlay {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.edit-dialog {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 420px;
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 3rem);
		overflow: auto;
		padding: 1.1rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
	}

	.dialog-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.dialog-head h3 {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text);
	}

	.dialog-src {
		margin-left: 0.4rem;
		font-size: 0.62rem;
		letter-spacing: 0;
		text-transform: none;
		color: var(--text-3);
	}

	.close-btn {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem;
		border: none;
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}

	.close-btn:hover {
		color: var(--text);
	}

	/* Checkerboard, so a cut-out reads as transparent rather than as black. */
	.preview {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 7rem;
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		overflow: hidden;
		background-color: var(--sunken);
		background-image:
			linear-gradient(45deg, rgba(255, 255, 255, 0.05) 25%, transparent 25%),
			linear-gradient(-45deg, rgba(255, 255, 255, 0.05) 25%, transparent 25%),
			linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.05) 75%),
			linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.05) 75%);
		background-size: 12px 12px;
		background-position:
			0 0,
			0 6px,
			6px -6px,
			-6px 0;
	}

	.preview canvas {
		display: block;
		max-width: 100%;
		height: auto;
		cursor: crosshair;
	}

	.warn {
		margin: 0;
		padding: 1rem;
		font-size: 0.7rem;
		color: var(--text-3);
	}

	.transport {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: -0.35rem;
	}

	.play-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.5rem;
		height: 1.5rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-2);
		cursor: pointer;
	}

	.play-btn:hover {
		background: rgba(255, 255, 255, 0.09);
		color: var(--text);
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	/* Flex, not grid: RangeSlider's input is `flex: 1; width: 0`, which collapses
	   to nothing in a grid cell. */
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.row label {
		flex-shrink: 0;
		min-width: 7.5rem;
		font-size: 0.7rem;
		color: var(--text-2);
	}

	.val {
		min-width: 2.2rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		text-align: right;
		color: var(--text-3);
	}

	.color-cell {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.5rem;
	}

	.color-cell input[type='color'] {
		width: 2.2rem;
		height: 1.3rem;
		padding: 0;
		background: none;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		cursor: pointer;
	}

	.hint {
		font-size: 0.62rem;
		color: var(--text-3);
	}

	.dialog-foot {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.2rem;
	}

	.ghost-btn {
		padding: 0.35rem 0.8rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-2);
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-2);
		cursor: pointer;
		transition:
			background var(--t-fast),
			color var(--t-fast);
	}

	.ghost-btn:hover {
		background: rgba(255, 255, 255, 0.09);
		color: var(--text);
	}
</style>
