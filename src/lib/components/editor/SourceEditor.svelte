<script lang="ts">
	import {
		Crop,
		Eraser,
		Pause,
		Pipette,
		Play,
		Redo2,
		RotateCcw,
		Undo2,
		X,
	} from 'lucide-svelte';
	import { onMount, untrack } from 'svelte';
	import { hexToVec3 } from '../../color';
	import { pushModalKeyboard } from '../../modal-keyboard';
	import { createSnapshotHistory } from '../../timeline/snapshot-history.svelte';
	import {
		DEFAULT_CHROMA_KEY,
		FULL_CROP,
		IDENTITY_MASK_TRANSFORM,
		isFullCrop,
		keyframeAt,
		MASK_MAX,
		putKeyframe,
		removeKeyframe,
		sampleSourceEdit,
		type AnimatedKey,
		type ChromaKey,
		type CropRect,
		type Keyframe,
		type MaskKey,
		type MaskTransform,
		type SourceEdit,
		type SourceEditAnim,
	} from '../../media';
	import {
		maskShift,
		maskToSdf,
		sdfCoverage,
		type MaskField,
	} from '../../media/mask-sdf';
	import type { SequenceSource } from '../../editor/sequence-sources.svelte';
	import ColorPicker from '../ui/ColorPicker.svelte';
	import RangeSlider from '../ui/RangeSlider.svelte';
	import SourceKeyframes, {
		type KeyTrackView,
	} from './SourceKeyframes.svelte';

	interface Props {
		/** The media being edited. The edit belongs to it, not to any layer. */
		source: SequenceSource;
		edit: SourceEdit;
		onChange: (edit: SourceEdit) => void;
		onClose: () => void;
	}

	let { source, edit, onChange, onClose }: Props = $props();

	/** Long edge of the preview buffer. Independent of how big the preview is
	 * drawn — the buffer is what the JS key walks pixel by pixel on every played
	 * frame, so it stays well inside the frame budget while the picture on
	 * screen scales to whatever room the dialog has. */
	const PREVIEW_MAX = 640;

	// The keyboard is ours while the dialog is up: Space is the transport here,
	// and Ctrl+Z belongs to the media being edited rather than to the timeline
	// behind it. Without this both fire at once.
	onMount(() => pushModalKeyboard());

	/**
	 * Undo for the dialog's own edits. Every tool writes through `onChange`, so
	 * one stack of whole-edit snapshots covers an erase stroke, a crop drag and
	 * a slider sweep alike — and an erase stroke is the one thing in here that
	 * was previously un-take-back-able short of clearing the entire mask.
	 */
	const history = createSnapshotHistory<SourceEdit>();

	/** Snapshot the edit as it stands, before whatever is about to change it. */
	function beforeEdit(coalesceKey?: string) {
		history.push($state.snapshot(edit) as SourceEdit, coalesceKey);
	}

	function undo() {
		const prev = history.undo($state.snapshot(edit) as SourceEdit);
		if (prev) onChange(prev);
	}

	function redo() {
		const next = history.redo($state.snapshot(edit) as SourceEdit);
		if (next) onChange(next);
	}

	/** Which tool the preview's pointer belongs to. Only one can own a drag. */
	type Tool = 'key' | 'crop' | 'erase';
	let tool = $state<Tool>('key');

	const TOOLS: { value: Tool; label: string; hint: string }[] = [
		{ value: 'key', label: 'Key', hint: 'Click the preview to pick the colour to remove' },
		{
			value: 'crop',
			label: 'Crop',
			hint: 'Drag a rectangle to keep. Drag an edge or corner to resize it, inside it to move it',
		},
		{
			value: 'erase',
			label: 'Erase',
			hint: 'Paint over what should go; Alt paints it back. With the Erase track on, each key holds the shape painted at it — and Shift-drag or Shape X/Y moves that shape',
		},
	];

	/** Brush width as a share of the preview's long edge. */
	const BRUSH_DEFAULT = 0.12;
	let brush = $state(BRUSH_DEFAULT);
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
	 * The edit as it stands under the playhead. Everything on screen reads from
	 * here rather than from the stored edit: with a track running, the crop
	 * rectangle, the key's numbers and the mask's position are all functions of
	 * where in the clip we are, and the panel has to agree with the picture.
	 */
	let live = $derived(sampleSourceEdit(edit, currentTime));
	let key = $derived(live.chromaKey);
	let crop = $derived(live.crop ?? FULL_CROP);
	let maskXform = $derived(live.maskTransform ?? IDENTITY_MASK_TRANSFORM);

	/**
	 * The current frame, unkeyed, at preview size. Everything reads from here:
	 * the keyed preview is drawn from it, and the eyedropper samples it — off
	 * the keyed canvas the dropper would keep landing on cut-out pixels.
	 */
	let raw: HTMLCanvasElement | null = null;
	let rawCtx: CanvasRenderingContext2D | null = null;
	/** The buffer's size, mirrored into state for the fit below. */
	let rawW = $state(0);
	let rawH = $state(0);
	/** Where frames come from. An image draws once; a video every frame. */
	let media: HTMLImageElement | HTMLVideoElement | null = null;

	// ── Keyframe tracks ──────────────────────────────────────────────────────
	// A track is on when it holds at least one key. Off, the panel's value is
	// the whole clip's; on, every change writes a key under the playhead, which
	// is how a property that varies gets edited without a separate mode.
	//
	// Only videos have anywhere to put a key: an image is one instant, and its
	// edit is the same at every point in it.
	type TrackId = 'crop' | 'key' | 'mask';

	let anim = $derived(edit.anim);
	let cropKeys = $derived(anim?.crop);
	let keyKeys = $derived(anim?.key);
	let maskKeys = $derived(anim?.mask);
	let animatable = $derived(duration > 0);

	let trackViews = $derived<KeyTrackView[]>([
		{
			id: 'crop',
			label: 'Crop',
			on: !!cropKeys?.length,
			keys: cropKeys?.map((k) => k.t) ?? [],
		},
		{
			id: 'key',
			label: 'Key',
			on: !!keyKeys?.length,
			keys: keyKeys?.map((k) => k.t) ?? [],
			blocked: key.enabled ? null : 'Switch the key on before animating it',
		},
		{
			id: 'mask',
			label: 'Erase',
			on: !!maskKeys?.length,
			keys: maskKeys?.map((k) => k.t) ?? [],
			blocked: live.mask
				? null
				: 'Erase something first — a key holds the shape you painted and where it sits',
		},
	]);

	function trackOn(id: TrackId): boolean {
		return !!edit.anim?.[id]?.length;
	}

	/** The stored edit with one track replaced. An empty track is dropped. */
	function withTrack(base: SourceEdit, id: TrackId, keys: Keyframe<unknown>[]): SourceEdit {
		const next: SourceEditAnim = { ...base.anim };
		if (keys.length === 0) delete next[id];
		else (next as Record<string, unknown>)[id] = keys;
		const empty = !next.crop?.length && !next.key?.length && !next.mask?.length;
		const out = { ...base, anim: empty ? undefined : next };
		if (empty) delete out.anim;
		return out;
	}

	/** The animated part of the key: what it is on/off is not a keyable thing. */
	function animatedKey(k: ChromaKey): AnimatedKey {
		return {
			color: { ...k.color },
			threshold: k.threshold,
			smoothing: k.smoothing,
			lumaRange: k.lumaRange,
		};
	}

	/** The value each track would write for the moment on screen. */
	function valueNow(id: TrackId): CropRect | AnimatedKey | MaskKey {
		if (id === 'crop') return { ...crop };
		if (id === 'key') return animatedKey(key);
		// The shape goes into the key with its position: a key that held only
		// where the mask sits would lose the painting the moment a later key
		// carried one of its own.
		return { ...maskXform, mask: live.mask };
	}

	function addKey(id: TrackId, base: SourceEdit = edit, value = valueNow(id)) {
		const keys = putKeyframe(
			(base.anim?.[id] ?? []) as Keyframe<unknown>[],
			keyTime(),
			value,
		);
		onChange(withTrack(base, id, keys));
	}

	function removeKey(id: TrackId) {
		const keys = removeKeyframe(
			(edit.anim?.[id] ?? []) as Keyframe<unknown>[],
			currentTime,
		);
		// Dropping the last key leaves the value it held as the static one, so
		// switching a track off never changes the picture under the playhead.
		onChange(withTrack(keys.length === 0 ? flatten(id) : edit, id, keys));
	}

	/**
	 * The edit with this track's value under the playhead written back as the
	 * static one. What "stop animating" has to mean: the frame on screen is the
	 * one being looked at, so it is the one to keep.
	 */
	function flatten(id: TrackId): SourceEdit {
		if (id === 'crop') return { ...edit, crop: { ...crop } };
		if (id === 'key') return { ...edit, chromaKey: { ...key } };
		// The shape under the playhead becomes the static one, so switching the
		// track off keeps the picture on screen. Its offset is not kept: a mask
		// has no static offset — it is painted where it is.
		return { ...edit, mask: live.mask };
	}

	function toggleTrack(id: TrackId) {
		beforeEdit();
		if (trackOn(id)) onChange(withTrack(flatten(id), id, []));
		else addKey(id);
	}

	function setKey<K extends keyof ChromaKey>(
		prop: K,
		value: ChromaKey[K],
		coalesceKey?: string,
	) {
		beforeEdit(coalesceKey);
		const chromaKey = { ...key, [prop]: value };
		const next = { ...edit, chromaKey };
		// `enabled` is the one part that is never keyed, so it alone writes
		// straight through to the stored edit.
		if (trackOn('key') && prop !== 'enabled') {
			addKey('key', next, animatedKey(chromaKey));
		} else {
			onChange(next);
		}
	}

	/** Picking a colour switches the key on: nobody reaches for the dropper to
	 * leave it off, and the preview would show nothing otherwise. */
	function setColor(r: number, g: number, b: number, coalesceKey?: string) {
		beforeEdit(coalesceKey);
		const chromaKey = { ...key, enabled: true, color: { r, g, b } };
		const next = { ...edit, chromaKey };
		if (trackOn('key')) addKey('key', next, animatedKey(chromaKey));
		else onChange(next);
	}

	/**
	 * Where the mask sits under the playhead. Always a key: the mask has no
	 * static offset — it is painted where it is — so having moved it at all is
	 * what starts the track. One key holds it there for the whole clip until a
	 * second one gives it somewhere to go.
	 */
	function setMaskTransform(xf: MaskTransform) {
		// Carrying the shape through: moving a mask must not drop the painting
		// the key it lands on was holding.
		addKey('mask', edit, { ...xf, mask: live.mask });
	}

	// ── Loading ──────────────────────────────────────────────────────────────
	$effect(() => {
		const src = source;
		let cancelled = false;
		loadError = null;
		ready = false;
		// Another source's edits are not this one's to step back through.
		history.reset();
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
		rawW = raw.width;
		rawH = raw.height;
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

	// ── Stage fit ────────────────────────────────────────────────────────────
	// The picture is sized in JS rather than by max-width/max-height: the crop
	// overlay is positioned against the canvas's box, so that box has to be the
	// letterboxed picture exactly and not a stretched parent with bars.
	let stageEl = $state<HTMLDivElement | undefined>(undefined);
	let stage = $state({ w: 0, h: 0 });

	$effect(() => {
		const el = stageEl;
		if (!el) return;
		const ro = new ResizeObserver(([entry]) => {
			stage = { w: entry.contentRect.width, h: entry.contentRect.height };
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	/** The buffer's aspect, fitted into the room the stage has. */
	let fitted = $derived.by(() => {
		if (!rawW || !rawH || stage.w <= 0 || stage.h <= 0) return null;
		const k = Math.min(stage.w / rawW, stage.h / rawH);
		return {
			w: Math.max(1, Math.floor(rawW * k)),
			h: Math.max(1, Math.floor(rawH * k)),
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
		// The shape under the playhead, not the stored one: scrubbing onto another
		// key has to bring that key's painting into the canvas being painted on.
		const url = live.mask ?? null;
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
		// Back through the mask's own transform: a moved mask is painted where
		// the brush appears to be, not where the file's pixels are.
		const u = unmoved(x / raw.width, y / raw.height);
		const sx = u.x * maskCanvas.width;
		const sy = u.y * maskCanvas.height;
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

	/** A point in source space, put back into the mask's own space. The same
	 * mapping the shader runs — see editedSource. */
	function unmoved(x: number, y: number): { x: number; y: number } {
		const s = Math.max(maskXform.scale, 0.0001);
		return {
			x: (x - maskXform.x - 0.5) / s + 0.5,
			y: (y - maskXform.y - 0.5) / s + 0.5,
		};
	}

	/** Write the working canvas back into the edit. */
	/**
	 * The stroke just painted, stored. With the track running it lands on the
	 * key under the playhead — repainting at a key is how the shape itself is
	 * animated, and the key already holds where that shape sits. With no track
	 * it is the source's one static mask, as it always was.
	 */
	function commitMask() {
		if (!maskCanvas) return;
		const url = maskCanvas.toDataURL('image/png');
		maskLoaded = url;
		if (trackOn('mask')) addKey('mask', edit, { ...maskXform, mask: url });
		else onChange({ ...edit, mask: url });
	}

	function clearMask() {
		beforeEdit();
		maskCanvas = null;
		maskCtx = null;
		maskLoaded = null;
		// The track goes with the mask: keys that move a shape which is no longer
		// painted have nothing left to move.
		onChange(withTrack({ ...edit, mask: null }, 'mask', []));
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
	/**
	 * Distance fields per painted shape, so the dialog can morph between two of
	 * them the way the shader does. Built once per shape and kept: the transform
	 * is O(pixels) and a scrub would otherwise pay for it every frame.
	 *
	 * Capped, because a field is a full RGBA buffer the size of the mask — half
	 * a megabyte each at 512² — and a keyed track can hold one per key. A morph
	 * needs two; the rest is slack for scrubbing back and forth over a few keys.
	 */
	const MAX_SDF_CACHE = 8;
	const sdfCache = new Map<
		string,
		{ field: MaskField; w: number; h: number } | 'pending'
	>();

	function ensureSdf(url: string) {
		const held = sdfCache.get(url);
		if (held) {
			// Freshen: Map keeps insertion order, so re-inserting moves this to the
			// young end and the next eviction takes something actually stale.
			sdfCache.delete(url);
			sdfCache.set(url, held);
			return held === 'pending' ? null : held;
		}
		while (sdfCache.size >= MAX_SDF_CACHE) {
			const oldest = sdfCache.keys().next();
			if (oldest.done) break;
			sdfCache.delete(oldest.value);
		}
		sdfCache.set(url, 'pending');
		const img = new Image();
		img.onload = () => {
			const w = img.naturalWidth;
			const h = img.naturalHeight;
			const c = document.createElement('canvas');
			c.width = w;
			c.height = h;
			const ctx = c.getContext('2d', { willReadFrequently: true });
			if (!ctx || w <= 0 || h <= 0) {
				sdfCache.delete(url);
				return;
			}
			ctx.drawImage(img, 0, 0);
			const px = ctx.getImageData(0, 0, w, h);
			sdfCache.set(url, { field: maskToSdf(px.data, w, h), w, h });
			// The morph was showing the shape it was leaving until this landed.
			if (ready && !playing) paint();
		};
		img.src = url;
		return null;
	}

	/**
	 * The two shapes mid-morph, resolved to one coverage canvas — the same
	 * boundary interpolation the shader does, so the dialog and the canvas
	 * behind it never disagree about what is erased.
	 *
	 * Null whenever nothing is being morphed, which puts the painted mask back
	 * on the fast path with its soft edge intact.
	 */
	let morphCanvas: HTMLCanvasElement | null = null;
	function morphedMask(): HTMLCanvasElement | null {
		const from = live.mask;
		const to = live.maskNext;
		const mix = live.maskMix ?? 0;
		if (!from || !to) return null;
		const a = ensureSdf(from);
		const b = ensureSdf(to);
		if (!a || !b || a.w !== b.w || a.h !== b.h) return null;
		const c = (morphCanvas ??= document.createElement('canvas'));
		if (c.width !== a.w || c.height !== a.h) {
			c.width = a.w;
			c.height = a.h;
		}
		const ctx = c.getContext('2d', { willReadFrequently: true });
		if (!ctx) return null;
		// The same alignment the shader does: both shapes slid onto the middle
		// they are travelling through, so their boundaries have an in-between.
		const shift = maskShift(a.field.centre, b.field.centre);
		const dxA = Math.round(-shift.x * mix * a.w);
		const dyA = Math.round(-shift.y * mix * a.h);
		const dxB = Math.round(shift.x * (1 - mix) * b.w);
		const dyB = Math.round(shift.y * (1 - mix) * b.h);
		const out = ctx.createImageData(a.w, a.h);
		// Off the edge reads as kept, which is what CLAMP_TO_EDGE gives the
		// shader: the field saturates positive outside a painted shape.
		const enc = (
			f: MaskField,
			w: number,
			h: number,
			x: number,
			y: number,
		): number => {
			const cx = Math.min(Math.max(x, 0), w - 1);
			const cy = Math.min(Math.max(y, 0), h - 1);
			return f.data[(cy * w + cx) * 4 + 3] / 255;
		};
		for (let y = 0; y < a.h; y++) {
			for (let x = 0; x < a.w; x++) {
				const ea = enc(a.field, a.w, a.h, x + dxA, y + dyA);
				const eb = enc(b.field, b.w, b.h, x + dxB, y + dyB);
				const i = (y * a.w + x) * 4;
				// The same floor the shader applies: what both shapes erase stays
				// erased, or a mask painted on over the clip blinks out midway.
				const erasedInBoth = Math.min(
					255 - a.field.data[i],
					255 - b.field.data[i],
				);
				const v = Math.min(
					Math.round(sdfCoverage(ea + (eb - ea) * mix) * 255),
					255 - erasedInBoth,
				);
				out.data[i] = v;
				out.data[i + 1] = v;
				out.data[i + 2] = v;
				out.data[i + 3] = 255;
			}
		}
		ctx.putImageData(out, 0, 0);
		return c;
	}

	/** Freeze the morphed shape into the canvas strokes are painted on. */
	function bakeMorph() {
		const morphed = morphedMask();
		const ctx = ensureMask();
		if (!morphed || !ctx || !maskCanvas) return;
		ctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
		ctx.drawImage(morphed, 0, 0, maskCanvas.width, maskCanvas.height);
	}

	let maskScratch: HTMLCanvasElement | null = null;
	function maskPixels(): Uint8ClampedArray | null {
		const shape = morphedMask() ?? maskCanvas;
		if (!shape || !raw) return null;
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
		const w = maskScratch.width;
		const h = maskScratch.height;
		// White first: everything the moved mask has slid off is kept, the same
		// rule the shader follows outside the mask's own square.
		sc.fillStyle = '#fff';
		sc.fillRect(0, 0, w, h);
		const dw = w * maskXform.scale;
		const dh = h * maskXform.scale;
		sc.drawImage(
			shape,
			maskXform.x * w + (w - dw) / 2,
			maskXform.y * h + (h - dh) / 2,
			dw,
			dh,
		);
		return sc.getImageData(0, 0, w, h).data;
	}

	// The saved mask, into the working canvas. Runs on open, whenever the edit
	// gains or loses one from outside (Clear, or the dialog's Reset), and
	// whenever the playhead crosses onto a key holding a different shape.
	$effect(() => {
		void live.mask;
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
			maskXform,
			// A morph moves on with the playhead even when nothing else does:
			// two keys can hold the same position and different shapes.
			live.maskNext,
			live.maskMix,
			crop,
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

	/**
	 * Where a key written mid-gesture lands. Pinned when a drag starts, because
	 * the playhead moves under a drag made while the clip is playing — and a
	 * crop dragged across two seconds of video would otherwise leave a key on
	 * every frame it crossed instead of one where the gesture began.
	 */
	let gestureTime: number | null = null;

	function keyTime(): number {
		return gestureTime ?? currentTime;
	}

	/** Which sides of the rectangle a resize drag is holding. */
	type Edges = { l: boolean; r: boolean; t: boolean; b: boolean };

	type Drag =
		| { kind: 'erase' }
		| { kind: 'crop-new'; ax: number; ay: number }
		| { kind: 'crop-move'; dx: number; dy: number }
		| { kind: 'crop-resize'; edges: Edges; from: CropRect }
		| { kind: 'mask-move'; ax: number; ay: number; from: MaskTransform };
	let drag: Drag | null = null;

	/** Narrowest the rectangle may get, matching the clamp in `setCrop`. */
	const MIN_CROP = 0.01;

	/**
	 * How close to an edge counts as grabbing it, in normalized units. Taken
	 * from the drawn size so the target is the same handful of pixels whatever
	 * the dialog has been resized to, and capped at a third of the rectangle so
	 * a small crop keeps a middle that can still be moved.
	 */
	function grabTolerance(): { x: number; y: number } {
		const rect = canvasEl?.getBoundingClientRect();
		const px = 10;
		return {
			x: Math.min(rect?.width ? px / rect.width : 0.02, crop.w / 3),
			y: Math.min(rect?.height ? px / rect.height : 0.02, crop.h / 3),
		};
	}

	/** The edges under the pointer, or null if it isn't near any of them. */
	function edgesAt(n: { x: number; y: number }): Edges | null {
		if (isFullCrop(crop)) return null;
		const t = grabTolerance();
		// Outside the rectangle by more than the grab distance is a new
		// rectangle, not a resize of this one.
		if (
			n.x < crop.x - t.x ||
			n.x > crop.x + crop.w + t.x ||
			n.y < crop.y - t.y ||
			n.y > crop.y + crop.h + t.y
		) {
			return null;
		}
		const edges: Edges = {
			l: Math.abs(n.x - crop.x) <= t.x,
			r: Math.abs(n.x - (crop.x + crop.w)) <= t.x,
			t: Math.abs(n.y - crop.y) <= t.y,
			b: Math.abs(n.y - (crop.y + crop.h)) <= t.y,
		};
		return edges.l || edges.r || edges.t || edges.b ? edges : null;
	}

	function insideCrop(n: { x: number; y: number }): boolean {
		return (
			!isFullCrop(crop) &&
			n.x > crop.x &&
			n.x < crop.x + crop.w &&
			n.y > crop.y &&
			n.y < crop.y + crop.h
		);
	}

	function cursorFor(edges: Edges | null): string {
		if (!edges) return '';
		if ((edges.l && edges.t) || (edges.r && edges.b)) return 'nwse-resize';
		if ((edges.r && edges.t) || (edges.l && edges.b)) return 'nesw-resize';
		if (edges.l || edges.r) return 'ew-resize';
		return 'ns-resize';
	}

	/** What the crop tool's pointer is over, so the cursor can say so. */
	let cropCursor = $state('');

	function onPreviewDown(e: PointerEvent) {
		if (e.button !== 0) return;
		const p = atEvent(e);
		if (!p) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		gestureTime = currentTime;

		if (tool === 'key') {
			pickAt(p.x, p.y);
			return;
		}
		if (tool === 'erase') {
			// One entry per stroke, taken before the first dab: undo steps back a
			// whole stroke, which is the unit the hand thinks in.
			beforeEdit();
			// Shift drags the erased shape around instead of painting a new one —
			// which is how the mask follows a pan without being repainted, and the
			// only gesture that writes a key on the erase track.
			if (e.shiftKey && edit.mask && raw) {
				drag = {
					kind: 'mask-move',
					ax: p.x / raw.width,
					ay: p.y / raw.height,
					from: { ...maskXform },
				};
				return;
			}
			// Mid-morph the working canvas holds the shape being left, while the
			// screen shows the blend of it and the next one. Painting on the
			// former would throw the blend away and land a key that reverts to an
			// older shape — so the stroke starts from what is actually on screen.
			bakeMorph();
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
		// On an edge, the drag resizes; inside the rectangle it moves it;
		// anywhere else starts a new one. Drawing a fresh rectangle is the common
		// gesture, so it stays the one that needs no handle to find.
		const edges = edgesAt(n);
		const inside = insideCrop(n);
		// Once for the gesture, before it starts: setCrop runs on every move, and
		// an entry per move would make undo a frame-by-frame rewind.
		beforeEdit();
		if (edges) {
			drag = { kind: 'crop-resize', edges, from: { ...crop } };
			return;
		}
		drag = inside
			? { kind: 'crop-move', dx: n.x - crop.x, dy: n.y - crop.y }
			: { kind: 'crop-new', ax: n.x, ay: n.y };
		if (!inside) setCrop({ x: n.x, y: n.y, w: MIN_CROP, h: MIN_CROP });
	}

	function onPreviewMove(e: PointerEvent) {
		if (!drag) {
			// Nothing is being dragged, so the only job is to say what a press
			// here would do.
			if (tool === 'crop') {
				const n = normAt(e);
				const edges = n && edgesAt(n);
				cropCursor = edges
					? cursorFor(edges)
					: n && insideCrop(n)
						? 'move'
						: '';
			}
			return;
		}
		if (drag.kind === 'mask-move') {
			const p = atEvent(e);
			if (!p || !raw) return;
			setMaskTransform({
				x: drag.from.x + (p.x / raw.width - drag.ax),
				y: drag.from.y + (p.y / raw.height - drag.ay),
				scale: drag.from.scale,
			});
			paint();
			return;
		}
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
		if (drag.kind === 'crop-resize') {
			const { edges, from } = drag;
			// The held edges follow the pointer, the opposite ones stay where the
			// gesture found them — read from the rectangle as it was at the start,
			// not as it stands, so a fast drag can't drift the anchor.
			let x0 = from.x;
			let y0 = from.y;
			let x1 = from.x + from.w;
			let y1 = from.y + from.h;
			// An edge stops at the opposite one rather than crossing it: a
			// rectangle turned inside out is never what the hand meant.
			if (edges.l) x0 = Math.min(n.x, x1 - MIN_CROP);
			if (edges.r) x1 = Math.max(n.x, x0 + MIN_CROP);
			if (edges.t) y0 = Math.min(n.y, y1 - MIN_CROP);
			if (edges.b) y1 = Math.max(n.y, y0 + MIN_CROP);
			setCrop({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
			return;
		}
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
		gestureTime = null;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}

	function setCrop(next: CropRect) {
		const crop = {
			x: Math.min(Math.max(next.x, 0), 1),
			y: Math.min(Math.max(next.y, 0), 1),
			w: Math.min(Math.max(next.w, 0.01), 1 - Math.min(Math.max(next.x, 0), 1)),
			h: Math.min(Math.max(next.h, 0.01), 1 - Math.min(Math.max(next.y, 0), 1)),
		};
		// The static rectangle is kept up to date even while a track owns the
		// picture, so switching the track off lands on what was last drawn.
		const withCrop = { ...edit, crop };
		if (trackOn('crop')) addKey('crop', withCrop, crop);
		else onChange(withCrop);
	}

	/**
	 * Resize the crop about its own centre. Anchoring at the top-left instead
	 * would let the rectangle run off the frame, where the clamp in `setCrop`
	 * pins the slider and it stops answering the drag.
	 */
	function setCropSize(dim: 'w' | 'h', v: number) {
		beforeEdit(`crop-${dim}`);
		const axis = dim === 'w' ? 'x' : 'y';
		const mid = crop[axis] + crop[dim] / 2;
		setCrop({
			...crop,
			[dim]: v,
			[axis]: Math.min(Math.max(mid - v / 2, 0), 1 - v),
		});
	}

	/**
	 * Whether a tool has been touched at all. Its Reset is dead until it has:
	 * a button that always looks pressable, on a tool that is already at its
	 * default, is the thing that made "Whole frame" and "Clear" read as two
	 * unrelated commands rather than as one idea.
	 */
	let dirty = $derived({
		key:
			key.enabled ||
			trackOn('key') ||
			key.threshold !== DEFAULT_CHROMA_KEY.threshold ||
			key.smoothing !== DEFAULT_CHROMA_KEY.smoothing ||
			key.lumaRange !== DEFAULT_CHROMA_KEY.lumaRange,
		crop: !isFullCrop(crop) || trackOn('crop'),
		erase: !!edit.mask || !!live.mask || trackOn('mask'),
	});

	/**
	 * Put one tool back where it started, its track included — the same thing
	 * the footer's Reset does to all three, so the two agree.
	 */
	function resetTool(t: Tool) {
		if (t === 'erase') {
			clearMask();
			return;
		}
		beforeEdit();
		if (t === 'crop') {
			onChange(withTrack({ ...edit, crop: { ...FULL_CROP } }, 'crop', []));
		} else {
			const chromaKey = {
				...DEFAULT_CHROMA_KEY,
				color: { ...DEFAULT_CHROMA_KEY.color },
			};
			onChange(withTrack({ ...edit, chromaKey }, 'key', []));
		}
	}

	function toHex({ r, g, b }: ChromaKey['color']): string {
		const h = (v: number) =>
			Math.round(Math.min(1, Math.max(0, v)) * 255)
				.toString(16)
				.padStart(2, '0');
		return `#${h(r)}${h(g)}${h(b)}`;
	}

	function setHex(hex: string) {
		// The picker fires as it is dragged, so the whole sweep is one entry.
		// An unparseable hex — half-typed in the field — falls back to the colour
		// already keyed rather than snapping the picture to black.
		const [r, g, b] = hexToVec3(hex, toHex(key.color));
		setColor(r, g, b, 'key-color');
	}

	/** Put every tool back: the button sits under all three, not just the key. */
	function reset() {
		beforeEdit();
		maskCanvas = null;
		maskCtx = null;
		maskLoaded = null;
		onChange({
			chromaKey: {
				...DEFAULT_CHROMA_KEY,
				color: { ...DEFAULT_CHROMA_KEY.color },
				enabled: key.enabled,
			},
			crop: { ...FULL_CROP },
			mask: null,
			// Every track goes with it: Reset sits under all three tools, and a
			// crop track left behind would keep moving a rectangle that no longer
			// crops anything.
		});
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onClose();
			return;
		}
		const mod = e.ctrlKey || e.metaKey;
		const k = e.key.toLowerCase();
		if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) {
			e.preventDefault();
			redo();
			return;
		}
		if (mod && k === 'z') {
			e.preventDefault();
			undo();
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

		<div class="dialog-body">
			<div class="stage">
				<div class="preview" bind:this={stageEl}>
					{#if loadError}
						<p class="warn">{loadError}</p>
					{:else if !ready}
						<p class="warn">Reading media…</p>
					{:else}
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<div
							class="canvas-wrap"
							style:width={fitted ? `${fitted.w}px` : undefined}
							style:height={fitted ? `${fitted.h}px` : undefined}
						>
							<canvas
								bind:this={canvasEl}
								class="tool-{tool}"
								style:cursor={tool === 'crop' && cropCursor
									? cropCursor
									: undefined}
								onpointerdown={onPreviewDown}
								onpointermove={onPreviewMove}
								onpointerup={onPreviewUp}
								onpointercancel={onPreviewUp}
								aria-label="Media preview"
							></canvas>
							{#if !isFullCrop(crop)}
								{@const idle = tool !== 'crop'}
								<!-- Shown under every tool, not just Crop: what is cropped away is
								     gone whichever tool is in hand, and hiding it meant erasing and
								     keying against a frame that wasn't the one being kept.

								     Four panels rather than one outlined box: the dimming has to
								     land outside the rectangle, and a border alone reads as a
								     selection instead of as what is being thrown away. -->
								<div
									class="crop-shade"
									class:idle
									style="left:0; top:0; right:0; height:{crop.y * 100}%"
								></div>
								<div
									class="crop-shade"
									class:idle
									style="left:0; top:{(crop.y + crop.h) * 100}%; right:0; bottom:0"
								></div>
								<div
									class="crop-shade"
									class:idle
									style="left:0; top:{crop.y * 100}%; width:{crop.x * 100}%; height:{crop.h * 100}%"
								></div>
								<div
									class="crop-shade"
									class:idle
									style="left:{(crop.x + crop.w) * 100}%; top:{crop.y * 100}%; right:0; height:{crop.h * 100}%"
								></div>
								<div
									class="crop-box"
									class:idle
									style="left:{crop.x * 100}%; top:{crop.y * 100}%; width:{crop.w * 100}%; height:{crop.h * 100}%"
								>
									<!-- Corners only. The sides are draggable too, but marking all
									     eight puts more furniture on a small rectangle than it can
									     hold; the cursor is what says an edge is live. Decoration
									     alone — the canvas under them hit-tests the edges, so they
									     take no pointer events of their own. -->
									{#if !idle}
										<span class="crop-grip tl"></span>
										<span class="crop-grip tr"></span>
										<span class="crop-grip bl"></span>
										<span class="crop-grip br"></span>
									{/if}
								</div>
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

					<!-- Videos only: an image is one instant, and there is nowhere in it
					     for a second key to go. -->
					<SourceKeyframes
						tracks={trackViews}
						{duration}
						{currentTime}
						onSeek={seekTo}
						onToggle={(id) => toggleTrack(id as TrackId)}
						onAdd={(id) => {
							beforeEdit();
							addKey(id as TrackId);
						}}
						onRemove={(id) => {
							beforeEdit();
							removeKey(id as TrackId);
						}}
					/>
				{/if}
			</div>

			<div class="side">
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

				<!-- Every tool opens the same way: what it does, then its Reset in the
				     one place, then its rows. Reset lives here rather than among the
				     rows because it undoes the whole tool, not the row it sits in. -->
				<div class="tool-head">
					<p class="tool-hint">{TOOLS.find((t) => t.value === tool)?.hint}</p>
					<button
						class="icon-btn small"
						disabled={!dirty[tool]}
						onclick={() => resetTool(tool)}
						title="Reset {TOOLS.find((t) => t.value === tool)?.label}"
						aria-label="Reset {TOOLS.find((t) => t.value === tool)?.label}"
					>
						<RotateCcw size={12} />
					</button>
				</div>

				<!-- Rows are label / control / readout throughout, and double-clicking
				     one puts that control back — the same row as everywhere else in
				     the app. -->
				<div class="rows">
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
							<label for="ck-color">Colour</label>
							<ColorPicker
								id="ck-color"
								value={toHex(key.color)}
								defaultValue={toHex(DEFAULT_CHROMA_KEY.color)}
								onChange={setHex}
							/>
						</div>

						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="row"
							title="Double-click to reset"
							ondblclick={() =>
								setKey('threshold', DEFAULT_CHROMA_KEY.threshold)}
						>
							<label for="ck-thr">Threshold</label>
							<RangeSlider
								id="ck-thr"
								value={key.threshold}
								min={0.01}
								max={1}
								step={0.005}
								disabled={!key.enabled}
								oninput={(v) => setKey('threshold', v, 'key-threshold')}
							/>
							<span class="val">{Math.round(key.threshold * 100)}%</span>
						</div>

						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="row"
							title="How far a pixel's brightness may differ from the key colour's. Wide cuts every shade of it, shadows and hot spots included; narrow matches one exact shade, which is what an unsaturated background needs. Double-click to reset."
							ondblclick={() =>
								setKey('lumaRange', DEFAULT_CHROMA_KEY.lumaRange)}
						>
							<label for="ck-luma">Brightness range</label>
							<RangeSlider
								id="ck-luma"
								value={key.lumaRange}
								min={0.01}
								max={1}
								step={0.005}
								disabled={!key.enabled}
								oninput={(v) => setKey('lumaRange', v, 'key-luma')}
							/>
							<span class="val">{Math.round(key.lumaRange * 100)}%</span>
						</div>

						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="row"
							title="Double-click to reset"
							ondblclick={() =>
								setKey('smoothing', DEFAULT_CHROMA_KEY.smoothing)}
						>
							<label for="ck-smooth">Smoothing</label>
							<RangeSlider
								id="ck-smooth"
								value={key.smoothing}
								min={0}
								max={0.5}
								step={0.005}
								disabled={!key.enabled}
								oninput={(v) => setKey('smoothing', v, 'key-smoothing')}
							/>
							<span class="val">{Math.round(key.smoothing * 100)}%</span>
						</div>
					{:else if tool === 'crop'}
						<div class="row">
							<label for="cr-w">Width</label>
							<RangeSlider
								id="cr-w"
								value={crop.w}
								min={0.01}
								max={1}
								step={0.005}
								oninput={(v) => setCropSize('w', v)}
							/>
							<span class="val">{Math.round(crop.w * 100)}%</span>
						</div>

						<div class="row">
							<label for="cr-h">Height</label>
							<RangeSlider
								id="cr-h"
								value={crop.h}
								min={0.01}
								max={1}
								step={0.005}
								oninput={(v) => setCropSize('h', v)}
							/>
							<span class="val">{Math.round(crop.h * 100)}%</span>
						</div>
					{:else}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="row"
							title="Double-click to reset"
							ondblclick={() => (brush = BRUSH_DEFAULT)}
						>
							<label for="er-brush">Brush</label>
							<RangeSlider
								id="er-brush"
								value={brush}
								min={0.02}
								max={0.5}
								step={0.01}
								oninput={(v) => (brush = v)}
							/>
							<span class="val">{Math.round(brush * 100)}%</span>
						</div>

						<div class="row">
							<label for="er-restore">Paint back</label>
							<input
								id="er-restore"
								type="checkbox"
								checked={restoring}
								onchange={(e) => (restoring = e.currentTarget.checked)}
							/>
						</div>

						{#if edit.mask && animatable}
							<!-- Position as sliders, not only as Shift+drag on the preview.
							     The drag is the quicker gesture but it is invisible, and
							     without a visible way to move the shape the keyframe track
							     could only ever be filled with identical keys — which looks
							     exactly like the animation being broken. -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="row"
								title="Where the erased shape sits, against where it was painted. Keyed, so the shape follows its subject across the clip. Double-click to reset."
								ondblclick={() => {
									beforeEdit();
									setMaskTransform({ ...maskXform, x: 0 });
								}}
							>
								<label for="er-x">Shape X</label>
								<RangeSlider
									id="er-x"
									value={maskXform.x}
									min={-1}
									max={1}
									step={0.005}
									oninput={(v) => {
										beforeEdit('mask-x');
										setMaskTransform({ ...maskXform, x: v });
									}}
								/>
								<span class="val">{Math.round(maskXform.x * 100)}%</span>
							</div>

							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="row"
								title="Where the erased shape sits, against where it was painted. Keyed, so the shape follows its subject across the clip. Double-click to reset."
								ondblclick={() => {
									beforeEdit();
									setMaskTransform({ ...maskXform, y: 0 });
								}}
							>
								<label for="er-y">Shape Y</label>
								<RangeSlider
									id="er-y"
									value={maskXform.y}
									min={-1}
									max={1}
									step={0.005}
									oninput={(v) => {
										beforeEdit('mask-y');
										setMaskTransform({ ...maskXform, y: v });
									}}
								/>
								<span class="val">{Math.round(maskXform.y * 100)}%</span>
							</div>

							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="row"
								title="How big the erased shape is drawn, against how it was painted. Keyed like its position, so a shape can grow as its subject comes closer. Double-click to reset."
								ondblclick={() => {
									beforeEdit();
									setMaskTransform({ ...maskXform, scale: 1 });
								}}
							>
								<label for="er-scale">Shape size</label>
								<RangeSlider
									id="er-scale"
									value={maskXform.scale}
									min={0.2}
									max={3}
									step={0.01}
									oninput={(v) => {
										beforeEdit('mask-scale');
										setMaskTransform({ ...maskXform, scale: v });
									}}
								/>
								<span class="val">{Math.round(maskXform.scale * 100)}%</span>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		</div>

		<div class="dialog-foot">
			<button
				class="icon-btn"
				disabled={!history.canUndo}
				onclick={undo}
				title="Undo (Ctrl+Z)"
				aria-label="Undo"
			>
				<Undo2 size={13} />
			</button>
			<button
				class="icon-btn"
				disabled={!history.canRedo}
				onclick={redo}
				title="Redo (Ctrl+Shift+Z)"
				aria-label="Redo"
			>
				<Redo2 size={13} />
			</button>
			<span class="foot-gap"></span>
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
		display: block;
		line-height: 0;
		max-width: 100%;
		max-height: 100%;
	}

	.canvas-wrap canvas {
		display: block;
		width: 100%;
		height: 100%;
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

	/* Under another tool the rectangle is not being edited, so it stops looking
	   like a handle: the discarded margin goes flatter and the outline drops to
	   a hairline rather than the live dashes. */
	.crop-shade.idle {
		background: rgba(0, 0, 0, 0.75);
	}

	.crop-box {
		position: absolute;
		border: 1px dashed var(--live);
		pointer-events: none;
	}

	.crop-box.idle {
		border: 1px solid rgba(255, 255, 255, 0.25);
	}

	.crop-grip {
		position: absolute;
		width: 7px;
		height: 7px;
		background: var(--live);
		border-radius: 1px;
	}

	/* Pulled half off the corner so the square is centred on it. */
	.crop-grip.tl {
		left: -4px;
		top: -4px;
	}

	.crop-grip.tr {
		right: -4px;
		top: -4px;
	}

	.crop-grip.bl {
		left: -4px;
		bottom: -4px;
	}

	.crop-grip.br {
		right: -4px;
		bottom: -4px;
	}

	/* The app's segmented control, as ButtonGroup draws it — one bordered group
	   rather than three separate buttons. Not ButtonGroup itself only because
	   these segments carry an icon, which it doesn't take. */
	.tool-bar {
		display: flex;
		flex-shrink: 0;
		background: var(--glass);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		overflow: hidden;
	}

	.tool-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		width: 100%;
		padding: 0.35rem 0.4rem;
		border: none;
		border-right: 1px solid var(--line);
		background: none;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.tool-btn:last-child {
		border-right: none;
	}

	.tool-btn:hover {
		color: var(--text-2);
	}

	.tool-btn.active {
		background: rgba(255, 255, 255, 0.07);
		color: var(--text);
	}

	.tool-head {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
	}

	.tool-hint {
		flex: 1;
		margin: 0;
		font-size: 0.68rem;
		line-height: 1.35;
		color: var(--text-4);
	}

	.icon-btn.small {
		width: 1.4rem;
		height: 1.4rem;
		flex-shrink: 0;
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
		/* Big on purpose: cropping and erasing are aiming tasks, and the old
		   420px column left the picture smaller than the controls under it. */
		width: min(1080px, calc(100vw - 3rem));
		height: min(720px, calc(100vh - 3rem));
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

	/* The picture and its transport on the left, every control on the right, so
	   the preview keeps the room instead of splitting it with a stack of rows. */
	.dialog-body {
		display: flex;
		flex: 1;
		gap: 1rem;
		min-height: 0;
	}

	.stage {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
	}

	.side {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		gap: 0.6rem;
		width: 17rem;
		overflow-y: auto;
	}

	/* Checkerboard, so a cut-out reads as transparent rather than as black. */
	.preview {
		display: flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		min-height: 0;
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
		cursor: crosshair;
	}

	/* Below this the two columns won't both hold their width, so they stack and
	   the dialog goes back to being a scrolling sheet. */
	@media (max-width: 720px) {
		.edit-dialog {
			height: auto;
			max-height: calc(100vh - 3rem);
			overflow-y: auto;
		}

		.dialog-body {
			flex-direction: column;
		}

		.side {
			width: auto;
			overflow: visible;
		}

		.preview {
			min-height: 14rem;
		}
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
		flex-shrink: 0;
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
		min-width: 6.5rem;
		font-size: 0.7rem;
		color: var(--text-2);
		/* The row's double-click resets the control; without this it also
		   selects the label text. */
		user-select: none;
	}

	.row input[type='checkbox'] {
		accent-color: #888;
	}

	.val {
		min-width: 2.6rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		text-align: right;
		color: var(--text-3);
	}

	.dialog-foot {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.2rem;
	}

	/* Undo and redo sit at the left, away from Reset: they are the way back from
	   it, and one misaimed click apart is too close. */
	.foot-gap {
		flex: 1;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.6rem;
		height: 1.6rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-2);
		cursor: pointer;
	}

	.icon-btn:hover:not(:disabled) {
		background: rgba(255, 255, 255, 0.09);
		color: var(--text);
	}

	.icon-btn:disabled {
		color: var(--text-4);
		cursor: default;
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
