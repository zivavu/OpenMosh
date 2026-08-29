<script lang="ts">
	import { Crop, Eraser, Pause, Pipette, Play, X } from 'lucide-svelte';
	import {
		DEFAULT_CHROMA_KEY,
		FULL_CROP,
		isFullCrop,
		MASK_MAX,
		type ChromaKey,
		type CropRect,
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
	let crop = $derived(edit.crop ?? FULL_CROP);

	/** Which tool the preview's pointer belongs to. Only one can own a drag. */
	type Tool = 'key' | 'crop' | 'erase';
	let tool = $state<Tool>('key');

	const TOOLS: { value: Tool; label: string; hint: string }[] = [
		{ value: 'key', label: 'Key', hint: 'Click the preview to pick the colour to remove' },
		{ value: 'crop', label: 'Crop', hint: 'Drag a rectangle to keep; drag inside it to move it' },
		{ value: 'erase', label: 'Erase', hint: 'Paint over what should go. Hold Alt to paint it back' },
	];

	/** Brush width as a share of the preview's long edge. */
	let brush = $state(0.12);
	/** Alt, or the toggle: paint coverage back instead of taking it away. */
	let restoring = $state(false);
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

	// ── Erase mask ───────────────────────────────────────────────────────────
	// Kept as a canvas while the dialog is open and written back to the edit as
	// a PNG data URL on pointerup, so a stroke costs one re-encode rather than
	// one per pointermove.
	let maskCanvas: HTMLCanvasElement | null = null;
	let maskCtx: CanvasRenderingContext2D | null = null;
	/** The data URL the canvas was last built from, so an edit made elsewhere
	 * (Reset, or reopening on another source) reloads it and our own writes
	 * don't. */
	let maskLoaded: string | null = null;

	function ensureMask(): CanvasRenderingContext2D | null {
		if (maskCtx) return maskCtx;
		const w = raw?.width ?? 0;
		const h = raw?.height ?? 0;
		if (w <= 0 || h <= 0) return null;
		const k = Math.min(MASK_MAX / Math.max(w, h), 1);
		maskCanvas = document.createElement('canvas');
		maskCanvas.width = Math.max(1, Math.round(w * k));
		maskCanvas.height = Math.max(1, Math.round(h * k));
		maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
		if (!maskCtx) return null;
		// White is "keep": the shader multiplies coverage by the red channel, so
		// an untouched mask has to be opaque white rather than empty.
		maskCtx.fillStyle = '#fff';
		maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
		return maskCtx;
	}

	/** Pull the saved mask into the working canvas, or start a clean one. */
	function loadMask() {
		const url = edit.mask ?? null;
		if (url === maskLoaded) return;
		maskLoaded = url;
		maskCanvas = null;
		maskCtx = null;
		const ctx = ensureMask();
		if (!ctx || !url) {
			paint();
			return;
		}
		const img = new Image();
		img.onload = () => {
			// Another source may have been opened while this decoded.
			if (maskLoaded !== url || !maskCtx || !maskCanvas) return;
			maskCtx.drawImage(img, 0, 0, maskCanvas.width, maskCanvas.height);
			paint();
		};
		img.src = url;
	}

	/** Paint one dab, in raw-buffer pixels. Soft-edged, so strokes blend. */
	function dab(x: number, y: number) {
		const ctx = ensureMask();
		if (!ctx || !maskCanvas || !raw) return;
		const sx = (x / raw.width) * maskCanvas.width;
		const sy = (y / raw.height) * maskCanvas.height;
		const r =
			(brush * Math.max(maskCanvas.width, maskCanvas.height)) / 2;
		const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, Math.max(r, 1));
		const on = restoring;
		grad.addColorStop(0, on ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)');
		grad.addColorStop(0.6, on ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)');
		grad.addColorStop(1, on ? 'rgba(255,255,255,0)' : 'rgba(0,0,0,0)');
		ctx.fillStyle = grad;
		ctx.beginPath();
		ctx.arc(sx, sy, Math.max(r, 1), 0, Math.PI * 2);
		ctx.fill();
	}

	/** Write the working canvas back into the edit. */
	function commitMask() {
		if (!maskCanvas) return;
		const url = maskCanvas.toDataURL('image/png');
		maskLoaded = url;
		onChange({ ...edit, mask: url });
	}

	function clearMask() {
		maskCanvas = null;
		maskCtx = null;
		maskLoaded = null;
		onChange({ ...edit, mask: null });
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
		const keying = key.enabled && key.threshold > 0;
		const maskPx = maskPixels();
		if (!keying && !maskPx) {
			ctx.drawImage(raw, 0, 0);
			return;
		}
		const img = rawCtx.getImageData(0, 0, raw.width, raw.height);
		const px = img.data;
		// The mask alone: nothing to key, so skip the whole colour test.
		if (!keying) {
			for (let i = 0; i < px.length; i += 4) px[i + 3] *= maskPx![i] / 255;
			ctx.putImageData(img, 0, 0);
			return;
		}
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
			if (maskPx) px[i + 3] *= maskPx[i] / 255;
		}
		ctx.putImageData(img, 0, 0);
	}

	/**
	 * The mask at the raw buffer's size, so its coverage lines up pixel for
	 * pixel with the frame being keyed. Read from the red channel, exactly as
	 * the shader does: the mask is opaque black-on-white, so its own alpha says
	 * nothing.
	 */
	let maskScratch: HTMLCanvasElement | null = null;
	function maskPixels(): Uint8ClampedArray | null {
		if (!maskCanvas || !raw) return null;
		if (
			!maskScratch ||
			maskScratch.width !== raw.width ||
			maskScratch.height !== raw.height
		) {
			maskScratch = document.createElement('canvas');
			maskScratch.width = raw.width;
			maskScratch.height = raw.height;
		}
		const sc = maskScratch.getContext('2d', { willReadFrequently: true });
		if (!sc) return null;
		sc.clearRect(0, 0, maskScratch.width, maskScratch.height);
		sc.drawImage(maskCanvas, 0, 0, maskScratch.width, maskScratch.height);
		return sc.getImageData(0, 0, maskScratch.width, maskScratch.height).data;
	}

	// The saved mask, into the working canvas. Runs on open and whenever the edit
	// gains or loses one from outside (Clear, or the dialog's Reset).
	$effect(() => {
		void edit.mask;
		if (ready) loadMask();
	});

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
			edit.mask,
		];
		if (ready && !playing) paint();
	});

	function pickAt(x: number, y: number) {
		if (!rawCtx) return;
		const [r, g, b] = rawCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
		setColor(r / 255, g / 255, b / 255);
	}

	// ── Preview pointer ──────────────────────────────────────────────────────
	// One handler for all three tools: they share the canvas, and only the
	// selected one gets the drag.

	/** Pointer position in raw-buffer pixels. */
	function atEvent(e: PointerEvent): { x: number; y: number } | null {
		const canvas = canvasEl;
		if (!canvas || !raw) return null;
		const rect = canvas.getBoundingClientRect();
		return {
			x: ((e.clientX - rect.left) / rect.width) * raw.width,
			y: ((e.clientY - rect.top) / rect.height) * raw.height,
		};
	}

	/** Normalized, for the crop rectangle. */
	function normAt(e: PointerEvent): { x: number; y: number } | null {
		const p = atEvent(e);
		if (!p || !raw) return null;
		return {
			x: Math.min(Math.max(p.x / raw.width, 0), 1),
			y: Math.min(Math.max(p.y / raw.height, 0), 1),
		};
	}

	type Drag =
		| { kind: 'erase' }
		| { kind: 'crop-new'; ax: number; ay: number }
		| { kind: 'crop-move'; dx: number; dy: number };
	let drag: Drag | null = null;

	function onPreviewDown(e: PointerEvent) {
		if (e.button !== 0) return;
		const p = atEvent(e);
		if (!p) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

		if (tool === 'key') {
			pickAt(p.x, p.y);
			return;
		}
		if (tool === 'erase') {
			// Alt is the transient form of the Restore toggle, the way it is in
			// every paint program; the toggle stays where the user left it.
			const held = restoring;
			if (e.altKey) restoring = !restoring;
			drag = { kind: 'erase' };
			dab(p.x, p.y);
			paint();
			if (e.altKey) restoring = held;
			return;
		}
		const n = normAt(e);
		if (!n) return;
		// Inside the current rectangle, the drag moves it; anywhere else starts a
		// new one. Drawing a fresh rectangle is the common gesture, so it needs no
		// modifier and no handle to find.
		const inside =
			!isFullCrop(crop) &&
			n.x > crop.x &&
			n.x < crop.x + crop.w &&
			n.y > crop.y &&
			n.y < crop.y + crop.h;
		drag = inside
			? { kind: 'crop-move', dx: n.x - crop.x, dy: n.y - crop.y }
			: { kind: 'crop-new', ax: n.x, ay: n.y };
		if (!inside) setCrop({ x: n.x, y: n.y, w: 0.01, h: 0.01 });
	}

	function onPreviewMove(e: PointerEvent) {
		if (!drag) return;
		if (drag.kind === 'erase') {
			const p = atEvent(e);
			if (!p) return;
			const held = restoring;
			if (e.altKey) restoring = !restoring;
			dab(p.x, p.y);
			paint();
			if (e.altKey) restoring = held;
			return;
		}
		const n = normAt(e);
		if (!n) return;
		if (drag.kind === 'crop-new') {
			setCrop({
				x: Math.min(drag.ax, n.x),
				y: Math.min(drag.ay, n.y),
				w: Math.max(Math.abs(n.x - drag.ax), 0.01),
				h: Math.max(Math.abs(n.y - drag.ay), 0.01),
			});
			return;
		}
		setCrop({
			x: Math.min(Math.max(n.x - drag.dx, 0), 1 - crop.w),
			y: Math.min(Math.max(n.y - drag.dy, 0), 1 - crop.h),
			w: crop.w,
			h: crop.h,
		});
	}

	function onPreviewUp(e: PointerEvent) {
		if (drag?.kind === 'erase') commitMask();
		drag = null;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}

	function setCrop(next: CropRect) {
		onChange({
			...edit,
			crop: {
				x: Math.min(Math.max(next.x, 0), 1),
				y: Math.min(Math.max(next.y, 0), 1),
				w: Math.min(Math.max(next.w, 0.01), 1 - Math.min(Math.max(next.x, 0), 1)),
				h: Math.min(Math.max(next.h, 0.01), 1 - Math.min(Math.max(next.y, 0), 1)),
			},
		});
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

	/** Put every tool back: the button sits under all three, not just the key. */
	function reset() {
		maskCanvas = null;
		maskCtx = null;
		maskLoaded = null;
		onChange({
			...edit,
			chromaKey: {
				...DEFAULT_CHROMA_KEY,
				color: { ...DEFAULT_CHROMA_KEY.color },
				enabled: key.enabled,
			},
			crop: { ...FULL_CROP },
			mask: null,
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
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div class="canvas-wrap">
					<canvas
						bind:this={canvasEl}
						class="tool-{tool}"
						onpointerdown={onPreviewDown}
						onpointermove={onPreviewMove}
						onpointerup={onPreviewUp}
						onpointercancel={onPreviewUp}
						aria-label="Media preview"
					></canvas>
					{#if tool === 'crop' && !isFullCrop(crop)}
						<!-- Four panels rather than one outlined box: the dimming has to
						     land outside the rectangle, and a border alone reads as a
						     selection instead of as what is being thrown away. -->
						<div class="crop-shade" style="left:0; top:0; right:0; height:{crop.y * 100}%"></div>
						<div
							class="crop-shade"
							style="left:0; top:{(crop.y + crop.h) * 100}%; right:0; bottom:0"
						></div>
						<div
							class="crop-shade"
							style="left:0; top:{crop.y * 100}%; width:{crop.x * 100}%; height:{crop.h * 100}%"
						></div>
						<div
							class="crop-shade"
							style="left:{(crop.x + crop.w) * 100}%; top:{crop.y * 100}%; right:0; height:{crop.h * 100}%"
						></div>
						<div
							class="crop-box"
							style="left:{crop.x * 100}%; top:{crop.y * 100}%; width:{crop.w * 100}%; height:{crop.h * 100}%"
						></div>
					{/if}
				</div>
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

		<div class="tool-bar">
			{#each TOOLS as t (t.value)}
				<button
					class="tool-btn"
					class:active={tool === t.value}
					title={t.hint}
					onclick={() => (tool = t.value)}
				>
					{#if t.value === 'key'}<Pipette size={12} />
					{:else if t.value === 'crop'}<Crop size={12} />
					{:else}<Eraser size={12} />{/if}
					{t.label}
				</button>
			{/each}
		</div>
		<p class="tool-hint">{TOOLS.find((t) => t.value === tool)?.hint}</p>

		<div class="rows">
			{#if tool === 'crop'}
				<div class="row">
					<label for="crop-size">Kept</label>
					<span class="crop-read" id="crop-size">
						{Math.round(crop.w * 100)}% × {Math.round(crop.h * 100)}%
					</span>
					<button
						class="ghost-btn small"
						disabled={isFullCrop(crop)}
						onclick={() => onChange({ ...edit, crop: { ...FULL_CROP } })}
					>
						Whole frame
					</button>
				</div>
			{:else if tool === 'erase'}
				<div class="row">
					<label for="er-brush">Brush</label>
					<RangeSlider
						id="er-brush"
						value={brush}
						min={0.02}
						max={0.5}
						step={0.01}
						oninput={(v) => (brush = v)}
					/>
					<span class="val">{Math.round(brush * 100)}</span>
				</div>
				<div class="row">
					<label for="er-restore">Paint back</label>
					<input
						id="er-restore"
						type="checkbox"
						checked={restoring}
						onchange={(e) => (restoring = e.currentTarget.checked)}
					/>
					<button
						class="ghost-btn small"
						disabled={!edit.mask}
						onclick={clearMask}
					>
						Clear
					</button>
				</div>
			{/if}

			{#if tool === 'key'}
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
			{/if}
		</div>

		<div class="dialog-foot">
			<button class="ghost-btn" onclick={reset}>Reset</button>
			<button class="ghost-btn" onclick={onClose}>Done</button>
		</div>
	</div>
</div>
<style>
	/* The crop overlay is positioned against this, not against the preview box:
	   the canvas is letterboxed inside it and the rectangle has to track the
	   picture, not the padding. */
	.canvas-wrap {
		position: relative;
		display: inline-flex;
		line-height: 0;
	}

	.canvas-wrap canvas.tool-crop {
		cursor: crosshair;
	}

	.canvas-wrap canvas.tool-erase {
		cursor: cell;
	}

	.canvas-wrap canvas.tool-key {
		cursor: copy;
	}

	.crop-shade {
		position: absolute;
		background: rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.crop-box {
		position: absolute;
		border: 1px dashed var(--live);
		pointer-events: none;
	}

	.tool-bar {
		display: flex;
		gap: 0.25rem;
	}

	.tool-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex: 1;
		justify-content: center;
		padding: 0.3rem 0.4rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--ink);
		color: var(--text-3);
		font-family: inherit;
		font-size: 0.7rem;
		cursor: pointer;
	}

	.tool-btn:hover {
		color: var(--text);
	}

	.tool-btn.active {
		border-color: var(--live);
		color: var(--text);
	}

	.tool-hint {
		margin: 0;
		font-size: 0.68rem;
		color: var(--text-4);
	}

	.crop-read {
		flex: 1;
		font-size: 0.75rem;
		font-family: var(--font-mono);
		color: var(--text-2);
	}

	.ghost-btn.small {
		padding: 0.2rem 0.4rem;
		font-size: 0.68rem;
	}

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
