<script lang="ts">
	import { Minimize } from "lucide-svelte";
	import type { Snippet } from "svelte";
	import type { EffectInstance } from "../../effects";
	import { ANIMATED_EFFECTS } from "../../gl/effect-shaders";
	import { fitPreviewSize, measureDisplaySize } from "../../gl/preview-size";
	import {
		GlRenderer,
		highlightKey,
		type HighlightTarget,
		type LayerHighlight,
		type PostChainLayer,
		type SourceFit,
	} from "../../gl/renderer";
	import { untrack } from "svelte";
	import {
		layerHitBoxes,
		pickTopLayer,
		type LayerPick,
		type MediaRect,
	} from "../../editor/layer-pick";
	import {
		clampMove,
		rotateFromHandle,
		scaleFromHandle,
	} from "../../editor/layer-drag";
	import { frameLooksDead } from "../../editor/frame-check";
	import { onFontsChanged } from "../../text-overlay";
	import { overlayTextBox } from "../../text-overlay/draw";
	import {
		preloadTextTimelineFonts,
		resolveTextLayersAt,
		type ResolvedTextLayer,
		type TextChainSource,
		type TextTimeline,
	} from "../../text";
	import {
		resolveMediaLayersAt,
		type MediaChainSource,
		type MediaLane,
		type MediaStyle,
		type MediaTimeline,
		type ResolvedMediaLayer,
		type SourceEdit,
	} from "../../media";
	import type { VideoPreviewPlayer } from "../../video-preview/preview-player.svelte";

	/** Shared, so the default prop doesn't mint an array per render. */
	const EMPTY_POST: PostChainLayer[] = [];
	const EMPTY_MEDIA: ResolvedMediaLayer[] = [];
	const EMPTY_SOURCE_EDITS: Record<string, SourceEdit> = {};
	const EMPTY_SOURCE_DURATIONS: Record<string, number> = {};

	interface Props {
		imageSrc: string;
		effects: EffectInstance[];
		canvasWidth?: number;
		canvasHeight?: number;
		canvasEl?: HTMLCanvasElement | null;
		glRenderer?: GlRenderer | null;
		naturalWidth?: number;
		naturalHeight?: number;
		fps?: number;
		showFps?: boolean;
		videoEl?: HTMLVideoElement | null;
		/** WebCodecs preview player; takes precedence over videoEl as frame source. */
		frameSource?: VideoPreviewPlayer | null;
		freezeAnimation?: boolean;
		/** Stops all preview rendering; interleaved renders corrupt per-effect feedback history. */
		suspended?: boolean;
		/** True when a parent drives `renderer.render()` itself; keeps this component's rAF off. */
		externallyDriven?: boolean;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: GlRenderer | null;
		/** Sequence fx lanes, stacked over the base so a fading lane mixes against its own input. */
		postLayers?: PostChainLayer[];
		/** Changes whenever a layer's late upload lands, retriggering a paused redraw. */
		sourceKey?: string | null;
		/** Two-way: set it to enter/leave fullscreen; it follows Esc and browser exits. */
		fullscreen?: boolean;
		sourceFit?: SourceFit;
		/** Per-source edits, keyed by source id. Sparse: only edited media. */
		sourceEdits?: Record<string, SourceEdit>;
		/** How long each source's media runs, so a keyed edit is sampled at the wrapped instant. */
		sourceDurations?: Record<string, number>;
		/** Optional text lanes composited into the chain at their insertion points. */
		textTimeline?: TextTimeline | null;
		/** Optional media lanes, composited the same way. */
		mediaTimeline?: MediaTimeline | null;
		/** Lane whose clip is selected: outlined over the preview. */
		selectedMediaLane?: MediaLane | null;
		/** Outlined too, while it is on screen. */
		selectedTextClipId?: string | null;
		/** Lane being soloed: drawn by itself on black, with every other layer left out. */
		soloMediaLaneId?: string | null;
		/** Uploads each visible media layer's frame before the chain runs. */
		mediaDriver?: ((layers: ResolvedMediaLayer[]) => void) | null;
		/** Chain per media clip and time: an auto clip's roll for the tick. */
		mediaChains?: MediaChainSource | null;
		/** The same, per text clip. */
		textChains?: TextChainSource | null;
		/** Sequence mode: the frame's size, with no media of its own; the base stays black. */
		baseSize?: { width: number; height: number } | null;
		/** Master-timeline seconds the text clips are looked up at. */
		textTime?: number;
		/** Song tempo for beat-synced effects. 0 = unknown, they run free. */
		bpm?: number;
		/** Keep the animation loop running even when nothing else needs it. */
		forceAnimation?: boolean;
		/** Drawn over the whole preview box when the canvas holds nothing worth looking at. */
		overlay?: Snippet;
		/** Clicking the preview picks the top layer at that point, or the base past every layer. */
		onPickLayer?: ((pick: LayerPick | null) => void) | null;
		/** Dragging a media layer or a selected handle moves its placement live. */
		onLayerStyleChange?: ((laneId: string, style: MediaStyle) => void) | null;
		/** Called once per drag gesture, so the editor can push one undo entry for it. */
		onLayerDragStart?: ((laneId: string) => void) | null;
		/** Dragging a text layer moves the anchor of the clip on screen, live. */
		onTextMove?: ((clipId: string, x: number, y: number) => void) | null;
		onTextDragStart?: ((clipId: string) => void) | null;
		/** Live FFT bins for the audio-bars effect; the AnalyserNode mutates one array in place. */
		spectrum?: Uint8Array | null;
	}

	let {
		imageSrc,
		effects,
		canvasWidth = undefined,
		canvasHeight = undefined,
		canvasEl = $bindable(null),
		glRenderer = $bindable(null),
		naturalWidth = $bindable(undefined),
		naturalHeight = $bindable(undefined),
		fps = $bindable(0),
		showFps = false,
		videoEl = null,
		frameSource = null,
		freezeAnimation = false,
		suspended = false,
		externallyDriven = false,
		warmCanvas = null,
		warmRenderer = null,
		postLayers = EMPTY_POST,
		sourceKey = null,
		spectrum = null,
		sourceFit = "contain",
		sourceEdits = EMPTY_SOURCE_EDITS,
		sourceDurations = EMPTY_SOURCE_DURATIONS,
		fullscreen = $bindable(false),
		textTimeline = null,
		mediaTimeline = null,
		selectedMediaLane = null,
		selectedTextClipId = null,
		soloMediaLaneId = null,
		mediaDriver = null,
		mediaChains = null,
		textChains = null,
		baseSize = null,
		textTime = 0,
		bpm = 0,
		forceAnimation = false,
		overlay = undefined,
		onPickLayer = null,
		onLayerStyleChange = null,
		onLayerDragStart = null,
		onTextMove = null,
		onTextDragStart = null,
	}: Props = $props();

	let frameTimes: number[] = [];
	let lastFpsUpdate = 0;

	/** Only called while the overlay is on: hidden, the sampling was invisible reactive churn. */
	function trackFps(now: number) {
		frameTimes.push(now);
		if (now - lastFpsUpdate >= 400) {
			lastFpsUpdate = now;
			frameTimes = frameTimes.filter((t) => t > now - 1000);
			fps = frameTimes.length;
		}
	}

	let previewArea = $state<HTMLDivElement>(null!);
	let canvas = $state<HTMLCanvasElement>(null!);
	let renderer: GlRenderer | null = $state(null);

	// DOM rather than a GL pass: anything drawn into the canvas would be in the export too.
	let outline = $state<{
		kind: "media" | "text";
		left: number;
		top: number;
		w: number;
		h: number;
		rot: number;
		/** The whole frame, which the highlight trace spans. */
		frame: { left: number; top: number; w: number; h: number };
	} | null>(null);

	/** Longest side the highlight is traced at; the readback grows with its area. */
	const HIGHLIGHT_MAX_SIDE = 1280;
	let highlightCanvas = $state<HTMLCanvasElement>(null!);
	/** Key of the trace on the highlight canvas; shown only while it is the selection's. */
	let highlightShown = $state<string | null>(null);
	let highlightPoll = 0;
	/** Lit by a new selection until the first mosh; the outline box stays. */
	let highlightLit = $state(false);

	function selectedHighlight(): HighlightTarget | null {
		if (selectedMediaLane)
			return { kind: "media", laneId: selectedMediaLane.id };
		if (selectedTextClipId) return { kind: "text", clipId: selectedTextClipId };
		return null;
	}

	const selectedHighlightKey = $derived.by(() => {
		const target = selectedHighlight();
		return target ? highlightKey(target) : null;
	});

	$effect(() => {
		highlightLit = !!selectedHighlightKey;
	});

	/** Out of the way, so the mosh can be seen. */
	export function dismissHighlight() {
		highlightLit = false;
	}

	/** Traced at the frame's on-screen size, so the shader's widths are CSS pixels. */
	function requestHighlight() {
		const target = highlightLit ? selectedHighlight() : null;
		const fit = target ? frameFit() : null;
		if (!target || !fit || !renderer || !canvasEl) return;
		const w = canvasEl.width * fit.s;
		const h = canvasEl.height * fit.s;
		const k = Math.min(1, HIGHLIGHT_MAX_SIDE / Math.max(w, h, 1));
		renderer.traceHighlight(
			target,
			Math.max(1, Math.round(w * k)),
			Math.max(1, Math.round(h * k)),
		);
	}

	/** Collects the trace a render started, polling each frame until the GPU is done. */
	function pollHighlight() {
		cancelAnimationFrame(highlightPoll);
		highlightPoll = 0;
		const r = renderer;
		if (!r) return;
		const done = r.takeHighlight();
		if (done) paintHighlight(done);
		if (r.highlightPending)
			highlightPoll = requestAnimationFrame(pollHighlight);
	}

	function paintHighlight({ key, image }: LayerHighlight) {
		const cv = highlightCanvas;
		if (!cv || !image) {
			highlightShown = null;
			return;
		}
		if (cv.width !== image.width) cv.width = image.width;
		if (cv.height !== image.height) cv.height = image.height;
		cv.getContext("2d")?.putImageData(image, 0, 0);
		highlightShown = key;
	}

	$effect(() => () => cancelAnimationFrame(highlightPoll));

	/** Where the rendered frame sits in client space and what it was scaled by. */
	function frameFit(): { left: number; top: number; s: number } | null {
		const cv = canvasEl;
		if (!cv || cv.width <= 0 || cv.height <= 0) return null;
		const cr = cv.getBoundingClientRect();
		const s = Math.min(cr.width / cv.width, cr.height / cv.height);
		if (!Number.isFinite(s) || s <= 0) return null;
		return {
			left: cr.left + (cr.width - cv.width * s) / 2,
			top: cr.top + (cr.height - cv.height * s) / 2,
			s,
		};
	}

	/** The selected text clip's box as last drawn, in the font the beat gave it. */
	function selectedTextRect(): MediaRect | null {
		const id = selectedTextClipId;
		const layer = id ? pickable.text.find((l) => l.clipId === id) : null;
		if (!layer || !canvasEl) return null;
		const box = overlayTextBox(
			canvasEl.width,
			canvasEl.height,
			layer.text,
			layer.style,
		);
		return box && { ...box, rot: 0 };
	}

	function updateOutline() {
		const lane = selectedMediaLane;
		const mediaRect =
			lane && renderer ? renderer.mediaLayerRect(lane.id, lane.style) : null;
		const rect = mediaRect ?? selectedTextRect();
		const fit = rect ? frameFit() : null;
		if (!rect || !fit || !previewArea) {
			if (outline) outline = null;
			return;
		}
		const ar = previewArea.getBoundingClientRect();
		const next = {
			kind: mediaRect ? ("media" as const) : ("text" as const),
			left: fit.left - ar.left + rect.x * fit.s,
			top: fit.top - ar.top + rect.y * fit.s,
			w: rect.w * fit.s,
			h: rect.h * fit.s,
			rot: rect.rot,
			frame: {
				left: fit.left - ar.left,
				top: fit.top - ar.top,
				w: canvasEl!.width * fit.s,
				h: canvasEl!.height * fit.s,
			},
		};
		// Compared before assigning: a fresh object each frame would re-render the outline.
		if (
			outline &&
			outline.kind === next.kind &&
			Math.abs(outline.left - next.left) < 0.5 &&
			Math.abs(outline.top - next.top) < 0.5 &&
			Math.abs(outline.w - next.w) < 0.5 &&
			Math.abs(outline.h - next.h) < 0.5 &&
			outline.rot === next.rot &&
			Math.abs(outline.frame.left - next.frame.left) < 0.5 &&
			Math.abs(outline.frame.top - next.frame.top) < 0.5 &&
			Math.abs(outline.frame.w - next.frame.w) < 0.5 &&
			Math.abs(outline.frame.h - next.frame.h) < 0.5
		) {
			return;
		}
		outline = next;
	}

	// Selecting a lane or editing its placement need not redraw anything.
	$effect(() => {
		const st = selectedMediaLane?.style;
		void [
			selectedMediaLane?.id,
			selectedTextClipId,
			st?.x,
			st?.y,
			st?.scale,
			st?.scaleX,
			st?.scaleY,
			st?.rotation,
			st?.fit,
			canvasWidth,
			canvasHeight,
			fullscreen,
		];
		// Untracked: a tracked read of what this writes would re-enter the effect.
		untrack(updateOutline);
	});

	$effect(() => {
		const area = previewArea;
		if (!area) return;
		const ro = new ResizeObserver(() => updateOutline());
		ro.observe(area);
		return () => ro.disconnect();
	});

	// Written by the draw loop, read only when a click arrives.
	let pickable: { media: ResolvedMediaLayer[]; text: ResolvedTextLayer[] } = {
		media: EMPTY_MEDIA,
		text: [],
	};

	/** Hand the layer under the pointer to the editor; pointerdown, left button only. */
	function pickLayerAt(e: PointerEvent) {
		// A press on the preview takes focus off whatever control had it.
		const active = document.activeElement;
		if (active instanceof HTMLElement && !previewArea?.contains(active)) {
			active.blur();
		}
		if (!onPickLayer || e.button !== 0) return;
		// The empty box around the frame lets go of the selection.
		if (e.target === previewArea) {
			onPickLayer(null);
			return;
		}
		// Anything else in the preview box is its own control.
		if (!renderer || !canvasEl || e.target !== canvasEl) return;
		// Claim the press: otherwise the browser reads the drag as a text selection sweep.
		e.preventDefault();
		window.getSelection()?.removeAllRanges();
		const p = framePoint(e);
		// Fullscreen letterboxes the frame, so a click can land on the canvas off the picture.
		if (!p) {
			onPickLayer(null);
			return;
		}
		const hit = hitAt(p.x, p.y);
		if (hit) {
			onPickLayer({ kind: hit.kind, laneId: hit.laneId });
			// Selecting and moving are one gesture: the press that picked a layer keeps hold of it.
			if (hit.kind === "media") startMove(e, hit.laneId, p);
			else startTextMove(e, hit.laneId, p);
			return;
		}
		// Past every layer is the image they sit over, except under solo, which is bare black.
		onPickLayer(soloMediaLaneId ? null : { kind: "base" });
	}

	/** The pointer in output pixels, or null when it is off the picture. */
	function framePoint(e: PointerEvent): { x: number; y: number } | null {
		const fit = frameFit();
		if (!fit || !canvasEl) return null;
		const x = (e.clientX - fit.left) / fit.s;
		const y = (e.clientY - fit.top) / fit.s;
		if (x < 0 || y < 0 || x >= canvasEl.width || y >= canvasEl.height) {
			return null;
		}
		return { x, y };
	}

	function hitAt(x: number, y: number) {
		if (!renderer || !canvasEl) return null;
		return pickTopLayer(
			layerHitBoxes(
				pickable.media,
				pickable.text,
				canvasEl.width,
				canvasEl.height,
				(layer) => renderer!.mediaLayerRect(layer.key, layer.style),
			),
			x,
			y,
			selectedLayer(),
		);
	}

	/** The layer the outline marks; a press on it keeps it even under another. */
	function selectedLayer(): { kind: "media" | "text"; laneId: string } | null {
		if (selectedMediaLane)
			return { kind: "media", laneId: selectedMediaLane.id };
		const id = selectedTextClipId;
		const text = id ? pickable.text.find((l) => l.clipId === id) : null;
		return text ? { kind: "text", laneId: text.laneId } : null;
	}

	// Both gestures work in output pixels, converting to normalized units when writing.
	type LayerDrag = {
		laneId: string;
		from: MediaStyle;
		/** True once the first change has been reported, and history pushed. */
		moved: boolean;
	} & (
		| {
				kind: "move";
				x0: number;
				y0: number;
				/** Half-extents of the box's axis-aligned bounds at the press. */
				hw: number;
				hh: number;
		  }
		| {
				kind: "scale";
				/** Which handle: -1/0/1 per axis, corners on both. */
				hx: -1 | 0 | 1;
				hy: -1 | 0 | 1;
				/** Box centre, rotation and the handle's offset in the box's own frame, at the press. */
				cx: number;
				cy: number;
				rot: number;
				c0x: number;
				c0y: number;
		  }
		| {
				kind: "rotate";
				/** Box centre, and the pointer's angle around it, at the press. */
				cx: number;
				cy: number;
				a0: number;
		  }
	);
	let drag: LayerDrag | null = null;
	/** Set on the preview box while the pointer is over something draggable. */
	let hoverCursor = $state("");

	/** Client pixels of slack before a press turns into a move. */
	const MOVE_SLOP = 3;

	function laneStyle(laneId: string): MediaStyle | null {
		const lane = mediaTimeline?.lanes.find((l) => l.id === laneId);
		return lane ? { ...lane.style } : null;
	}

	function startMove(
		e: PointerEvent,
		laneId: string,
		p: { x: number; y: number },
	) {
		if (!onLayerStyleChange || !renderer) return;
		const from = laneStyle(laneId);
		if (!from) return;
		const rect = renderer.mediaLayerRect(laneId, from);
		if (!rect) return;
		const cos = Math.abs(Math.cos(rect.rot));
		const sin = Math.abs(Math.sin(rect.rot));
		drag = {
			kind: "move",
			laneId,
			from,
			moved: false,
			x0: p.x,
			y0: p.y,
			hw: (rect.w * cos + rect.h * sin) / 2,
			hh: (rect.w * sin + rect.h * cos) / 2,
		};
		previewArea.setPointerCapture(e.pointerId);
	}

	/** A text clip's anchor being dragged, from where the press found it. */
	let textDrag: {
		clipId: string;
		from: { x: number; y: number };
		x0: number;
		y0: number;
		moved: boolean;
	} | null = null;

	function startTextMove(
		e: PointerEvent,
		laneId: string,
		p: { x: number; y: number },
	) {
		if (!onTextMove) return;
		const layer = pickable.text.find((l) => l.laneId === laneId);
		if (!layer) return;
		textDrag = {
			clipId: layer.clipId,
			from: { x: layer.style.x, y: layer.style.y },
			x0: p.x,
			y0: p.y,
			moved: false,
		};
		previewArea.setPointerCapture(e.pointerId);
	}

	function textDragMove(e: PointerEvent) {
		const td = textDrag;
		const fit = frameFit();
		if (!td || !fit || !canvasEl) return;
		let dx = (e.clientX - fit.left) / fit.s - td.x0;
		let dy = (e.clientY - fit.top) / fit.s - td.y0;
		if (!td.moved && Math.hypot(dx, dy) * fit.s < MOVE_SLOP) return;
		if (e.shiftKey) {
			if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
			else dx = 0;
		}
		if (!td.moved) {
			td.moved = true;
			onTextDragStart?.(td.clipId);
		}
		// The anchor stays on the frame, where the panel's sliders can still reach it.
		const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
		onTextMove?.(
			td.clipId,
			clamp01(td.from.x + dx / canvasEl.width),
			clamp01(td.from.y + dy / canvasEl.height),
		);
	}

	function startScale(e: PointerEvent, hx: -1 | 0 | 1, hy: -1 | 0 | 1) {
		const lane = selectedMediaLane;
		if (!onLayerStyleChange || !lane || !renderer || e.button !== 0) return;
		const rect = renderer.mediaLayerRect(lane.id, lane.style);
		if (!rect) return;
		e.stopPropagation();
		drag = {
			kind: "scale",
			laneId: lane.id,
			from: { ...lane.style },
			moved: false,
			hx,
			hy,
			cx: rect.x + rect.w / 2,
			cy: rect.y + rect.h / 2,
			rot: rect.rot,
			c0x: (hx * rect.w) / 2,
			c0y: (hy * rect.h) / 2,
		};
		previewArea.setPointerCapture(e.pointerId);
	}

	function startRotate(e: PointerEvent) {
		const lane = selectedMediaLane;
		const fit = frameFit();
		if (!onLayerStyleChange || !lane || !renderer || !fit || e.button !== 0)
			return;
		const rect = renderer.mediaLayerRect(lane.id, lane.style);
		if (!rect) return;
		e.stopPropagation();
		const cx = rect.x + rect.w / 2;
		const cy = rect.y + rect.h / 2;
		const px = (e.clientX - fit.left) / fit.s;
		const py = (e.clientY - fit.top) / fit.s;
		drag = {
			kind: "rotate",
			laneId: lane.id,
			from: { ...lane.style },
			moved: false,
			cx,
			cy,
			a0: Math.atan2(py - cy, px - cx),
		};
		hoverCursor = "grabbing";
		previewArea.setPointerCapture(e.pointerId);
	}

	function resetRotation() {
		const lane = selectedMediaLane;
		if (!onLayerStyleChange || !lane || lane.style.rotation === 0) return;
		onLayerDragStart?.(lane.id);
		onLayerStyleChange(lane.id, { ...lane.style, rotation: 0 });
	}

	function dragMove(e: PointerEvent) {
		if (textDrag) {
			textDragMove(e);
			return;
		}
		if (!drag) {
			updateHoverCursor(e);
			return;
		}
		const fit = frameFit();
		if (!fit || !canvasEl) return;
		const px = (e.clientX - fit.left) / fit.s;
		const py = (e.clientY - fit.top) / fit.s;
		const fw = canvasEl.width;
		const fh = canvasEl.height;
		const { from } = drag;
		let next: MediaStyle;
		if (drag.kind === "move") {
			let dx = px - drag.x0;
			let dy = py - drag.y0;
			if (!drag.moved && Math.hypot(dx, dy) * fit.s < MOVE_SLOP) return;
			// Shift holds the drag to whichever axis it has gone further along.
			if (e.shiftKey) {
				if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
				else dx = 0;
			}
			// Held to the frame: a layer dragged clean off could only be got back from the panel.
			next = { ...from, ...clampMove(from, dx, dy, drag.hw, drag.hh, fw, fh) };
		} else if (drag.kind === "rotate") {
			const rotation = rotateFromHandle(from, drag, px, py, e.shiftKey);
			if (!drag.moved && rotation === from.rotation) return;
			next = { ...from, rotation };
		} else {
			next = scaleFromHandle(from, drag, px, py, fw, fh, e.altKey);
		}
		if (!drag.moved) {
			drag.moved = true;
			onLayerDragStart?.(drag.laneId);
		}
		onLayerStyleChange?.(drag.laneId, next);
	}

	function endDrag(e: PointerEvent) {
		if (!drag && !textDrag) return;
		drag = null;
		textDrag = null;
		if (previewArea.hasPointerCapture(e.pointerId)) {
			previewArea.releasePointerCapture(e.pointerId);
		}
	}

	/** A move cursor over any layer a press would drag. */
	function updateHoverCursor(e: PointerEvent) {
		let cursor = "";
		if ((onLayerStyleChange || onTextMove) && e.target === canvasEl) {
			const p = framePoint(e);
			const hit = p && hitAt(p.x, p.y);
			const draggable =
				hit?.kind === "media" ? !!onLayerStyleChange : !!onTextMove;
			if (hit && draggable) cursor = "move";
		}
		if (cursor !== hoverCursor) hoverCursor = cursor;
	}

	/** The eight handles, corners first so they sit over the sides' ends. */
	const HANDLES: { hx: -1 | 0 | 1; hy: -1 | 0 | 1; cursor: string }[] = [
		{ hx: -1, hy: -1, cursor: "nwse-resize" },
		{ hx: 1, hy: -1, cursor: "nesw-resize" },
		{ hx: 1, hy: 1, cursor: "nwse-resize" },
		{ hx: -1, hy: 1, cursor: "nesw-resize" },
		{ hx: 0, hy: -1, cursor: "ns-resize" },
		{ hx: 1, hy: 0, cursor: "ew-resize" },
		{ hx: 0, hy: 1, cursor: "ns-resize" },
		{ hx: -1, hy: 0, cursor: "ew-resize" },
	];
	let imageReady = $state(false);
	let error: string | null = $state(null);

	// Displayed preview size in device pixels; the renderer fits the output aspect into it.
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
		// Debounced: each renderer resize reallocates every FBO.
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

	const renderSize = $derived(
		fitPreviewSize(canvasWidth, canvasHeight, displayW, displayH),
	);

	// The preview area goes fullscreen, so the ResizeObserver picks up the new box.
	$effect(() => {
		const el = previewArea;
		if (!el) return;
		const onChange = () => {
			fullscreen = document.fullscreenElement === el;
		};
		document.addEventListener("fullscreenchange", onChange);
		return () => document.removeEventListener("fullscreenchange", onChange);
	});

	$effect(() => {
		const el = previewArea;
		if (!el) return;
		const isFs = document.fullscreenElement === el;
		if (fullscreen === isFs) return;
		if (fullscreen) {
			// iOS Safari has no element fullscreen, and a non-user-initiated request is rejected.
			const req = el.requestFullscreen?.();
			if (req) req.catch(() => (fullscreen = false));
			else fullscreen = false;
		} else if (document.fullscreenElement === el) {
			void document.exitFullscreen?.();
		}
	});

	// The exit hint fades on its own; re-shown on each entry.
	let showFsHint = $state(false);
	$effect(() => {
		if (!fullscreen) {
			showFsHint = false;
			return;
		}
		showFsHint = true;
		const timer = setTimeout(() => (showFsHint = false), 2200);
		return () => clearTimeout(timer);
	});

	const videoPlaying = $derived(!!videoEl && !videoEl.paused);
	const hasAnimatedEffects = $derived(
		effects.some((e) => e.enabled && ANIMATED_EFFECTS.has(e.defId)),
	);
	/** A media clip's own chain can animate with nothing else on screen moving. */
	const hasAnimatedLayers = $derived(
		(!!mediaTimeline?.enabled &&
			resolveMediaLayersAt(
				mediaTimeline,
				textTime,
				sourceEdits,
				mediaChains ?? undefined,
			).some((l) =>
				l.effects.some((e) => e.enabled && ANIMATED_EFFECTS.has(e.defId)),
			)) ||
			(!!textTimeline?.enabled &&
				resolveTextLayersAt(
					textTimeline,
					textTime,
					textChains ?? undefined,
				).some((l) =>
					l.effects.some((e) => e.enabled && ANIMATED_EFFECTS.has(e.defId)),
				)),
	);
	const needsAnimation = $derived(
		!externallyDriven &&
			!freezeAnimation &&
			(!!frameSource ||
				videoPlaying ||
				forceAnimation ||
				hasAnimatedLayers ||
				hasAnimatedEffects),
	);

	function drawFrame(now: number) {
		// Before anything renders: the bars have to see this frame's audio.
		renderer!.setSpectrum(spectrum, now);
		const beat = bpm > 0 ? (textTime * bpm) / 60 : null;
		renderer!.setBeat(beat, bpm / 60);
		const solo = soloMediaLaneId;
		const layers =
			textTimeline && !solo
				? resolveTextLayersAt(
						textTimeline,
						textTime,
						textChains ?? undefined,
						beat,
					)
				: [];
		const media = mediaTimeline
			? resolveMediaLayersAt(
					mediaTimeline,
					textTime,
					sourceEdits,
					mediaChains ?? undefined,
				)
			: EMPTY_MEDIA;
		// Every lane is still driven, not just the soloed one, or leaving solo would stall.
		if (media.length > 0) mediaDriver?.(media);
		const shown = solo ? media.filter((l) => l.laneId === solo) : media;
		// What a click can land on is what the frame actually drew.
		pickable = { media: shown, text: layers };
		renderer!.setBlankSource(!!solo);
		// The render hands over the source chain plus the layers, not the flat `effects`.
		const stacked = postLayers.reduce((n, l) => n + l.effects.length, 0);
		const base =
			stacked > 0 ? effects.slice(0, effects.length - stacked) : effects;
		requestHighlight();
		// Solo drops the image chain and the fx lanes along with the source.
		renderer!.render(
			solo ? [] : base,
			now,
			layers,
			solo ? [] : postLayers,
			shown,
		);
		// Every draw path ends here, so the outline follows any change.
		updateOutline();
		pollHighlight();
	}

	$effect(() => {
		try {
			let r: GlRenderer;
			let activeCanvas: HTMLCanvasElement;

			if (warmCanvas && warmRenderer) {
				// Styled by class, not inline: an inline rule would outrank the :fullscreen overrides.
				warmCanvas.style.cssText = "";
				warmCanvas.className = "preview-canvas";
				// The markup below carries this; the warmed-up canvas was built in App.
				warmCanvas.setAttribute("aria-label", "Effect preview canvas");
				previewArea.appendChild(warmCanvas);
				warmRenderer.adoptCanvas(warmCanvas);
				r = warmRenderer;
				activeCanvas = warmCanvas;
			} else {
				r = new GlRenderer(canvas);
				activeCanvas = canvas;
			}

			renderer = r;
			canvasEl = activeCanvas;
			glRenderer = r;

			// Mutable ref so cleanup destroys whichever renderer is live.
			const current = { renderer: r };

			/** A canvas this component made to recover onto; Svelte owns the other. */
			let spareCanvas: HTMLCanvasElement | null = null;
			let rebuildTimer: ReturnType<typeof setTimeout> | undefined;

			const attach = (el: HTMLCanvasElement) => {
				el.addEventListener("webglcontextlost", onContextLost);
				el.addEventListener("webglcontextrestored", onContextRestored);
			};
			const detach = (el: HTMLCanvasElement) => {
				el.removeEventListener("webglcontextlost", onContextLost);
				el.removeEventListener("webglcontextrestored", onContextRestored);
			};
			const adopt = (el: HTMLCanvasElement, next: GlRenderer) => {
				current.renderer = next;
				activeCanvas = el;
				renderer = next;
				canvasEl = el;
				glRenderer = next;
				error = null;
			};

			/** Rebuild onto a brand-new element; a lost context never hands out another. */
			const rebuildOnFreshCanvas = () => {
				const old = activeCanvas;
				const fresh = document.createElement("canvas");
				fresh.className = "preview-canvas";
				fresh.setAttribute("aria-label", "Effect preview canvas");
				let next: GlRenderer;
				try {
					previewArea.appendChild(fresh);
					next = new GlRenderer(fresh);
				} catch {
					fresh.remove();
					error =
						"Lost the WebGL context and could not rebuild it. Reload the page.";
					return;
				}
				// Hidden rather than removed: Svelte owns the original element and removes it on teardown.
				old.style.display = "none";
				detach(old);
				attach(fresh);
				try {
					current.renderer.destroy();
				} catch {
					// The context is already gone; there is nothing left to release.
				}
				spareCanvas?.remove();
				spareCanvas = fresh;
				adopt(fresh, next);
			};

			const onContextLost = (ev: Event) => {
				// preventDefault() is required for automatic restoration, or webglcontextrestored never fires.
				ev.preventDefault();
				error = "Lost the WebGL context. Rebuilding…";
				clearTimeout(rebuildTimer);
				rebuildTimer = setTimeout(rebuildOnFreshCanvas, 1200);
			};
			const onContextRestored = () => {
				clearTimeout(rebuildTimer);
				try {
					adopt(activeCanvas, new GlRenderer(activeCanvas));
				} catch {
					rebuildOnFreshCanvas();
				}
			};
			attach(activeCanvas);

			return () => {
				clearTimeout(rebuildTimer);
				detach(activeCanvas);
				spareCanvas?.remove();
				current.renderer.destroy();
				renderer = null;
				canvasEl = null;
				glRenderer = null;
				if (warmCanvas && warmCanvas.parentNode === previewArea) {
					previewArea.removeChild(warmCanvas);
				}
			};
		} catch (e) {
			error = e instanceof Error ? e.message : "Failed to initialize WebGL2";
		}
	});

	// A blank base at a stated size: the sequence editor's, whose media comes through the drivers.
	$effect(() => {
		if (!renderer || !baseSize) return;
		renderer.initBlankSource(baseSize.width, baseSize.height);
		naturalWidth = baseSize.width;
		naturalHeight = baseSize.height;
		imageReady = true;
	});

	$effect(() => {
		if (!renderer || videoEl || frameSource || baseSize) return;
		imageReady = false;
		const img = new Image();
		let cancelled = false;
		img.onload = () => {
			if (cancelled) return;
			renderer!.loadImage(img);
			naturalWidth = img.naturalWidth;
			naturalHeight = img.naturalHeight;
			imageReady = true;
		};
		img.src = imageSrc;
		return () => {
			cancelled = true;
		};
	});

	// WebCodecs preview: dimensions are known upfront, no element to wait on
	$effect(() => {
		if (!renderer || !frameSource) return;
		// The texture is sized to the frames that will land in it, smaller than the media.
		renderer.initVideoSource(frameSource.frameWidth, frameSource.frameHeight);
		naturalWidth = frameSource.width;
		naturalHeight = frameSource.height;
		imageReady = true;
	});

	$effect(() => {
		if (!renderer || !videoEl || frameSource) return;
		imageReady = false;
		const video = videoEl;
		let ready = false;

		function onReady() {
			if (ready) return;
			ready = true;
			renderer!.loadVideo(video);
			naturalWidth = video.videoWidth;
			naturalHeight = video.videoHeight;
			imageReady = true;
			renderer!.updateSourceFrame(video);
			drawFrame(0);
		}

		// Wait for a decoded frame with known dimensions; Firefox can report videoWidth 0.
		const isReady = () => video.readyState >= 2 && video.videoWidth > 0;

		// A paused video still needs a redraw after a seek.
		const onTimeUpdate = () => {
			if (!ready || needsAnimation) return;
			renderer!.updateSourceFrame(video);
			drawFrame(0);
		};

		if (isReady()) {
			onReady();
			video.addEventListener("timeupdate", onTimeUpdate);
			return () => video.removeEventListener("timeupdate", onTimeUpdate);
		}
		const events = ["loadeddata", "canplay", "resize", "timeupdate"];
		const tryReady = () => {
			if (!isReady()) return;
			for (const ev of events) video.removeEventListener(ev, tryReady);
			onReady();
		};
		for (const ev of events) video.addEventListener(ev, tryReady);
		video.addEventListener("timeupdate", onTimeUpdate);
		return () => {
			for (const ev of events) video.removeEventListener(ev, tryReady);
			video.removeEventListener("timeupdate", onTimeUpdate);
		};
	});

	// Resize the renderer when the preview box changes; otherwise a static redraw here.
	$effect(() => {
		if (suspended || !renderer || !imageReady || !renderSize) return;
		renderer.resize(renderSize.width, renderSize.height);
		if (!externallyDriven && !needsAnimation) drawFrame(0);
	});

	// Applied here rather than by the parent so a change also repaints a paused canvas.
	$effect(() => {
		renderer?.setSourceFit(sourceFit);
	});

	// Pushed rather than carried on each frame's layers: an edit belongs to the media.
	$effect(() => {
		renderer?.setSourceEdits(new Map(Object.entries(sourceEdits)));
	});

	$effect(() => {
		renderer?.setSourceDurations(new Map(Object.entries(sourceDurations)));
	});

	// An erase mask is decoded from a data URL, so it lands a frame or two after the edit.
	/** Draw what the editor holds right now and judge it; false whenever it can't tell. */
	export function frameLooksDeadNow(): boolean {
		if (!renderer || suspended || externallyDriven || !imageReady) return false;
		drawFrame(performance.now() / 1000);
		const sample = renderer.sampleFrame();
		return !!sample && frameLooksDead(sample.pixels, sample.w, sample.h);
	}

	$effect(() => {
		const r = renderer;
		if (!r) return;
		r.onMaskReady = () => {
			if (!suspended && !externallyDriven) drawFrame(0);
		};
		return () => {
			if (r.onMaskReady) r.onMaskReady = null;
		};
	});

	// Beat-cycled fonts turn up mid-play; fetched ahead so none first draws as a fallback.
	$effect(() => {
		void preloadTextTimelineFonts(textTimeline);
	});

	// Static redraw driver: re-renders when the animation loop is not running.
	$effect(() => {
		if (suspended || !renderer || !imageReady || !renderSize) return;
		if (externallyDriven || needsAnimation) return;
		for (const e of effects) {
			e.enabled;
			for (const k of Object.keys(e.values)) e.values[k];
		}
		sourceFit;
		sourceEdits;
		// A caption font that lands after the frame was drawn changes its glyphs.
		fontTick;
		// Text edits and scrubbing both change which clip is on screen.
		readTextTimeline();
		readMediaTimeline();
		textTime;
		// The highlight is traced by a render.
		selectedHighlightKey;
		highlightLit;
		// A late layer upload landing while paused is what gets that frame onto the
		// canvas.
		sourceKey;
		drawFrame(0);
	});

	let fontTick = $state(0);
	$effect(() => onFontsChanged(() => fontTick++));

	/** Touch every field a media lane draws from, so a paused canvas redraws on an edit. */
	function readMediaTimeline() {
		if (!mediaTimeline?.enabled) return;
		for (const l of mediaTimeline.lanes) {
			l.enabled;
			l.underEffects;
			l.z;
			l.sourceId;
			const style = l.style as unknown as Record<string, unknown>;
			for (const k of Object.keys(style)) style[k];
			for (const c of l.clips) {
				c.start;
				c.end;
				c.sourceStart;
				c.sourceId;
				c.mode;
				c.seed;
				c.intervalSec;
				for (const e of c.effects) {
					e.enabled;
					for (const k of Object.keys(e.values)) e.values[k];
				}
			}
		}
	}

	/** Touch every text field so a paused canvas redraws on any text edit. */
	function readTextTimeline() {
		if (!textTimeline?.enabled) return;
		for (const l of textTimeline.lanes) {
			l.enabled;
			l.underEffects;
			l.z;
			const style = l.style as unknown as Record<string, unknown>;
			for (const k of Object.keys(style)) style[k];
			for (const c of l.clips) {
				c.start;
				c.end;
				c.text;
				c.fadeInSec;
				c.fadeOutSec;
				c.mode;
				c.seed;
				c.intervalSec;
				for (const e of c.effects) {
					e.enabled;
					for (const k of Object.keys(e.values)) e.values[k];
				}
			}
		}
	}

	$effect(() => {
		if (suspended || !renderer || !imageReady) return;
		if (!needsAnimation) return;

		let rafId: number;
		let lastVideoTime = -1;
		const loop = () => {
			const nowMs = performance.now();
			if (frameSource) {
				const frame = frameSource.takeFrame();
				if (frame) {
					renderer!.updateSourceFrame(frame);
					frame.close();
				}
			} else if (videoEl) {
				const t = videoEl.currentTime;
				if (t !== lastVideoTime) {
					renderer!.updateSourceFrame(videoEl);
					lastVideoTime = t;
				}
			}
			drawFrame(nowMs / 1000);
			if (showFps) trackFps(nowMs);
			rafId = requestAnimationFrame(loop);
		};
		rafId = requestAnimationFrame(loop);

		return () => cancelAnimationFrame(rafId);
	});
</script>

<!-- Selecting by pointer is a shortcut, not the only way in. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="preview-area"
	bind:this={previewArea}
	style:cursor={hoverCursor || null}
	onpointerdown={pickLayerAt}
	onpointermove={dragMove}
	onpointerup={endDrag}
	onpointercancel={endDrag}
	onpointerleave={() => !drag && !textDrag && hoverCursor && (hoverCursor = "")}
>
	{#if !warmCanvas}
		<canvas
			bind:this={canvas}
			class="preview-canvas"
			aria-label="Effect preview canvas"
		></canvas>
	{/if}
	<!-- Kept mounted so a trace can land on it while hidden. -->
	<canvas
		bind:this={highlightCanvas}
		class="layer-highlight"
		aria-hidden="true"
		style:display={outline &&
		!externallyDriven &&
		highlightLit &&
		highlightShown === selectedHighlightKey
			? null
			: "none"}
		style:left="{outline?.frame.left ?? 0}px"
		style:top="{outline?.frame.top ?? 0}px"
		style:width="{outline?.frame.w ?? 0}px"
		style:height="{outline?.frame.h ?? 0}px"
	></canvas>
	{#if outline}
		<!-- Sits under .canvas-overlay: when that is up there is nothing worth pointing at. -->
		<div
			class="layer-outline"
			style="left: {outline.left}px; top: {outline.top}px; width: {outline.w}px; height: {outline.h}px; transform: rotate({outline.rot}rad)"
		>
			<!-- Text is placed from its panel; only media scales on the canvas. -->
			{#if onLayerStyleChange && outline.kind === "media"}
				<!-- Children of the rotated box, so they turn with it. -->
				{#each HANDLES as h (h.hx * 3 + h.hy)}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="layer-handle"
						style="left: {(h.hx + 1) * 50}%; top: {(h.hy + 1) *
							50}%; cursor: {h.cursor}"
						onpointerdown={(e) => startScale(e, h.hx, h.hy)}
					></div>
				{/each}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="layer-rotate"
					title="Drag to rotate (Shift snaps to 15°). Double-click to reset."
					onpointerdown={startRotate}
					ondblclick={resetRotation}
				></div>
			{/if}
		</div>
	{/if}
	{#if overlay}
		<div class="canvas-overlay">{@render overlay()}</div>
	{/if}
	{#if error}
		<p class="error">{error}</p>
	{:else if showFps}
		<span class="fps-overlay">{fps} FPS</span>
	{/if}
	{#if fullscreen}
		<button
			class="fs-exit"
			title="Exit fullscreen (Esc)"
			onclick={() => (fullscreen = false)}
		>
			<Minimize size={16} />
		</button>
		{#if showFsHint}
			<span class="fs-hint">ESC TO EXIT · SPACE TO PLAY</span>
		{/if}
	{/if}
</div>

<style>
	.preview-area {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		background: var(--ink);
		user-select: none;
	}

	/* :global: the pre-warmed canvas is moved in via the DOM, so it never gets scoped. */
	.preview-area :global(.preview-canvas) {
		max-width: 100%;
		max-height: 100%;
		border-radius: 2px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
		/* Checkerboard under the frame: whatever the chain leaves clear reads as clear. */
		background:
			repeating-conic-gradient(
					rgba(255, 255, 255, 0.07) 0 25%,
					transparent 0 50%
				)
				0 0 / 16px 16px,
			var(--ink);
	}

	/* The selected layer's own edge, traced from its pixels. */
	.layer-highlight {
		position: absolute;
		z-index: 7;
		pointer-events: none;
	}

	/* Marks the selected layer's box while its clip panel is open; the box takes no pointer. */
	.layer-outline {
		position: absolute;
		z-index: 8;
		border: 1px dashed var(--live);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.55),
			inset 0 0 0 1px rgba(0, 0, 0, 0.55);
		pointer-events: none;
	}

	.layer-handle {
		position: absolute;
		width: 9px;
		height: 9px;
		margin: -5px 0 0 -5px;
		background: var(--live);
		border: 1px solid rgba(0, 0, 0, 0.7);
		box-sizing: border-box;
		pointer-events: auto;
		touch-action: none;
	}

	/* A knob on a stalk above the top edge; it turns with the box. */
	.layer-rotate {
		position: absolute;
		left: 50%;
		top: -22px;
		width: 11px;
		height: 11px;
		margin-left: -6px;
		border-radius: 50%;
		background: var(--live);
		border: 1px solid rgba(0, 0, 0, 0.7);
		box-sizing: border-box;
		cursor: grab;
		pointer-events: auto;
		touch-action: none;
	}

	.layer-rotate::before {
		content: "";
		position: absolute;
		left: 50%;
		top: 100%;
		width: 1px;
		height: 12px;
		margin-left: -0.5px;
		background: var(--live);
		pointer-events: none;
	}

	/* Opaque: whatever is still on the canvas underneath is stale. */
	.canvas-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--ink);
		z-index: 9;
	}

	.error {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 0 1.5rem;
		color: var(--rec);
		font-size: 0.9rem;
		background: rgba(0, 0, 0, 0.55);
		z-index: 10;
	}

	.preview-area:fullscreen {
		background: var(--sunken);
	}

	/* Scale up to fill the screen on whichever axis runs out first, letterboxing the other. */
	.preview-area:fullscreen :global(.preview-canvas) {
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
		object-fit: contain;
		border-radius: 0;
		box-shadow: none;
	}

	.fs-exit {
		position: absolute;
		top: 1rem;
		right: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		padding: 0;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.5);
		color: var(--text-2);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 0.1s,
			color 0.1s;
		z-index: 11;
	}

	/* Out of the way until the pointer moves: fullscreen is for seeing only the render. */
	.preview-area:hover .fs-exit,
	.fs-exit:focus-visible {
		opacity: 1;
	}

	.fs-exit:hover {
		color: var(--text);
		border-color: rgba(255, 255, 255, 0.3);
	}

	.fs-hint {
		position: absolute;
		bottom: 1.6rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.6);
		color: var(--text-2);
		font-size: 0.66rem;
		font-family: "Consolas", "Monaco", monospace;
		letter-spacing: 0.1em;
		pointer-events: none;
		z-index: 11;
		animation: fs-hint-fade 2.2s ease-out forwards;
	}

	@keyframes fs-hint-fade {
		0%,
		60% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	.fps-overlay {
		position: absolute;
		top: 1.8rem;
		left: 1.8rem;
		background: rgba(0, 0, 0, 0.65);
		color: var(--live);
		font-size: 0.72rem;
		font-weight: 600;
		font-family: "Consolas", "Monaco", monospace;
		font-variant-numeric: tabular-nums;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		pointer-events: none;
		user-select: none;
		z-index: 10;
		letter-spacing: 0.04em;
	}
</style>
