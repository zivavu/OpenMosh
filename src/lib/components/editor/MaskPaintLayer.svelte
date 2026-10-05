<script lang="ts">
	import { onMount } from "svelte";
	import { maskPaint } from "../../effects/mask-paint.svelte";
	import { isTextEntryTarget } from "../../editor/shortcut-target";
	import type { GlRenderer } from "../../gl/renderer";
	import type { MediaLane } from "../../media";
	import { MASK_MAX } from "../../media/source-edit";

	interface Props {
		renderer: GlRenderer;
		canvas: HTMLCanvasElement;
		area: HTMLDivElement;
		/** The selected media lane; a Mask on its clip paints over its box. */
		lane: MediaLane | null;
		/** Draw a frame now, for when no animation loop will. */
		redraw: () => void;
	}

	let { renderer, canvas, area, lane, redraw }: Props = $props();

	const target = $derived(maskPaint.target!);

	/** The painted box in preview-area pixels, turned by `rot` about its centre. */
	type Box = { left: number; top: number; w: number; h: number; rot: number };
	let box = $state<Box | null>(null);

	function measure(): Box | null {
		if (canvas.width <= 0 || canvas.height <= 0) return null;
		const cr = canvas.getBoundingClientRect();
		const ar = area.getBoundingClientRect();
		const s = Math.min(cr.width / canvas.width, cr.height / canvas.height);
		if (!Number.isFinite(s) || s <= 0) return null;
		const fx = cr.left - ar.left + (cr.width - canvas.width * s) / 2;
		const fy = cr.top - ar.top + (cr.height - canvas.height * s) / 2;
		if (target.laneId) {
			if (!lane || lane.id !== target.laneId) return null;
			const rect = renderer.mediaLayerRect(lane.id, lane.style);
			if (!rect) return null;
			// The clip's chain runs over its box grown by the bleed margin.
			const grow = 1 + 2 * Math.max(0, lane.style.bleed ?? 0);
			const w = rect.w * grow;
			const h = rect.h * grow;
			return {
				left: fx + (rect.x - (w - rect.w) / 2) * s,
				top: fy + (rect.y - (h - rect.h) / 2) * s,
				w: w * s,
				h: h * s,
				rot: rect.rot,
			};
		}
		return {
			left: fx,
			top: fy,
			w: canvas.width * s,
			h: canvas.height * s,
			rot: 0,
		};
	}

	function sameBox(a: Box | null, b: Box | null): boolean {
		if (!a || !b) return a === b;
		return (
			Math.abs(a.left - b.left) < 0.5 &&
			Math.abs(a.top - b.top) < 0.5 &&
			Math.abs(a.w - b.w) < 0.5 &&
			Math.abs(a.h - b.h) < 0.5 &&
			a.rot === b.rot
		);
	}

	// Followed every frame: the layer can move under it, and the preview resize.
	onMount(() => {
		let raf = 0;
		const tick = () => {
			const next = measure();
			if (!sameBox(box, next)) box = next;
			raf = requestAnimationFrame(tick);
		};
		tick();
		return () => cancelAnimationFrame(raf);
	});

	let paint = $state<HTMLCanvasElement>(null!);
	/** The painting the canvas holds as saved: where it started, then each stroke's commit. */
	let committed = "";
	let ctx: CanvasRenderingContext2D | null = null;
	/** Which target and shape the painting canvas was set up for. */
	let loadedFor = "";

	// The painting keeps the box's shape, so a round brush stays round on screen.
	$effect(() => {
		const b = box;
		if (!b || !paint) return;
		const key = `${target.instanceId}:${(b.w / b.h).toFixed(3)}`;
		if (key === loadedFor) return;
		const fresh = !loadedFor.startsWith(`${target.instanceId}:`);
		if (fresh) {
			committed = target.current();
			undoStack = [];
			redoStack = [];
			pushed = false;
		}
		const keep = fresh ? null : copyOf(paint);
		loadedFor = key;
		const k = MASK_MAX / Math.max(b.w, b.h);
		paint.width = Math.max(1, Math.round(b.w * k));
		paint.height = Math.max(1, Math.round(b.h * k));
		ctx = paint.getContext("2d");
		if (!ctx) return;
		if (keep) {
			ctx.drawImage(keep, 0, 0, paint.width, paint.height);
			show();
		} else {
			load(committed);
		}
	});

	// Undo, redo and Clear change the saved painting under the canvas; follow them.
	$effect(() => {
		const now = target.current();
		if (!ctx || now === committed) return;
		committed = now;
		load(now);
	});

	let loads = 0;
	/** Replace the canvas with a saved painting; "" is nothing painted. */
	function load(url: string) {
		const token = ++loads;
		ctx!.fillStyle = "#000";
		ctx!.fillRect(0, 0, paint.width, paint.height);
		if (!url) {
			show();
			return;
		}
		const img = new Image();
		img.onload = () => {
			if (token !== loads || !ctx) return;
			ctx.drawImage(img, 0, 0, paint.width, paint.height);
			show();
		};
		img.src = url;
	}

	function copyOf(src: HTMLCanvasElement): HTMLCanvasElement {
		const c = document.createElement("canvas");
		c.width = src.width;
		c.height = src.height;
		c.getContext("2d")?.drawImage(src, 0, 0);
		return c;
	}

	let pending = 0;
	/** Hand the painting to the renderer and get it on screen, once per frame. */
	function show() {
		renderer.setLiveBrush(target.instanceId, paint, committed);
		if (pending) return;
		pending = requestAnimationFrame(() => {
			pending = 0;
			redraw();
		});
	}

	onMount(() => () => {
		cancelAnimationFrame(pending);
		renderer.setLiveBrush("", null);
		redraw();
	});

	/** A client point in the painting's own pixels. */
	function local(e: PointerEvent): { x: number; y: number } | null {
		if (!box) return null;
		const ar = area.getBoundingClientRect();
		const dx = e.clientX - ar.left - (box.left + box.w / 2);
		const dy = e.clientY - ar.top - (box.top + box.h / 2);
		const c = Math.cos(box.rot);
		const s = Math.sin(box.rot);
		const u = (dx * c + dy * s) / box.w + 0.5;
		const v = (-dx * s + dy * c) / box.h + 0.5;
		return { x: u * paint.width, y: v * paint.height };
	}

	let last: { x: number; y: number } | null = null;
	let erasing = false;
	let cursor = $state<{ x: number; y: number } | null>(null);
	/** The painting before this stroke, and the stroke drawn hard on its own. Blurring
	 * the whole stroke at once keeps overlapping dabs from piling up into a hard line. */
	let before: HTMLCanvasElement | null = null;
	let stroke: HTMLCanvasElement | null = null;

	function radius(): number {
		return (maskPaint.size * Math.max(paint.width, paint.height)) / 2;
	}

	function beginStroke() {
		before = copyOf(paint);
		stroke = document.createElement("canvas");
		stroke.width = paint.width;
		stroke.height = paint.height;
	}

	function strokeTo(p: { x: number; y: number }) {
		const sctx = stroke?.getContext("2d");
		if (!ctx || !sctx || !before) return;
		const r = radius();
		// Softer brushes shrink their core and spread the rest into the blur.
		const core = r * (1 - 0.5 * maskPaint.softness);
		sctx.strokeStyle = sctx.fillStyle = erasing ? "#000" : "#fff";
		sctx.lineCap = "round";
		sctx.lineWidth = core * 2;
		sctx.beginPath();
		if (last) {
			sctx.moveTo(last.x, last.y);
			sctx.lineTo(p.x, p.y);
			sctx.stroke();
		} else {
			sctx.arc(p.x, p.y, core, 0, Math.PI * 2);
			sctx.fill();
		}
		last = p;
		ctx.drawImage(before, 0, 0);
		ctx.filter =
			maskPaint.softness > 0
				? `blur(${maskPaint.softness * r * 1.5}px)`
				: "none";
		ctx.drawImage(stroke!, 0, 0);
		ctx.filter = "none";
		show();
	}

	function onDown(e: PointerEvent) {
		e.stopPropagation();
		if (e.button !== 0) return;
		e.preventDefault();
		const p = local(e);
		if (!p) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		erasing = maskPaint.erase !== e.altKey;
		last = null;
		beginStroke();
		strokeTo(p);
	}

	function onMove(e: PointerEvent) {
		const ar = area.getBoundingClientRect();
		cursor = { x: e.clientX - ar.left, y: e.clientY - ar.top };
		if (!last) return;
		const p = local(e);
		if (p) strokeTo(p);
	}

	function onUp() {
		if (!last) return;
		last = null;
		before = stroke = null;
		undoStack.push(committed);
		redoStack = [];
		save(paint.toDataURL("image/png"));
	}

	/** Strokes undo one at a time while painting, and never past where it began. */
	let undoStack: string[] = [];
	let redoStack: string[] = [];
	/** The editor's history gets one entry for the whole session, made by its first save. */
	let pushed = false;

	function save(url: string) {
		renderer.preloadBrush(url);
		committed = url;
		target.commit(url, pushed ? "none" : "new");
		pushed = true;
		show();
	}

	function step(from: string[], to: string[]) {
		const url = from.pop();
		if (url === undefined) return;
		to.push(committed);
		save(url);
		load(url);
	}

	// Capture phase, ahead of the editor's own Ctrl+Z, which would reach past the session.
	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopImmediatePropagation();
				maskPaint.target = null;
				return;
			}
			const key = e.key.toLowerCase();
			if (!(e.ctrlKey || e.metaKey) || (key !== "z" && key !== "y")) return;
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			if (key === "y" || e.shiftKey) step(redoStack, undoStack);
			else step(undoStack, redoStack);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	});

	$effect(() => {
		if (!target.alive()) maskPaint.target = null;
	});

	const brushPx = $derived(box ? maskPaint.size * Math.max(box.w, box.h) : 0);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="paint-catcher"
	onpointerdown={onDown}
	onpointermove={onMove}
	onpointerup={onUp}
	onpointercancel={onUp}
	onpointerleave={() => (cursor = null)}
>
	<canvas
		bind:this={paint}
		class="painting"
		style:display={box ? null : "none"}
		style:left="{box?.left ?? 0}px"
		style:top="{box?.top ?? 0}px"
		style:width="{box?.w ?? 0}px"
		style:height="{box?.h ?? 0}px"
		style:transform="rotate({box?.rot ?? 0}rad)"
	></canvas>
	{#if cursor && box}
		<div
			class="brush"
			style:left="{cursor.x}px"
			style:top="{cursor.y}px"
			style:width="{brushPx}px"
			style:height="{brushPx}px"
		></div>
	{/if}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="paint-bar" onpointerdown={(e) => e.stopPropagation()}>
		<span
			>{box
				? "Paint where the effects should show. Hold Alt to paint them out."
				: "Select this clip's layer to paint on it."}</span
		>
		<button type="button" onclick={() => (maskPaint.target = null)}>Done</button
		>
	</div>
</div>

<style>
	.paint-catcher {
		position: absolute;
		inset: 0;
		z-index: 8;
		cursor: none;
		touch-action: none;
	}

	/* Only the surface strokes land on: the renderer tints the area it makes. */
	.painting {
		position: absolute;
		visibility: hidden;
		pointer-events: none;
	}

	.brush {
		position: absolute;
		border: 1px solid rgba(255, 255, 255, 0.85);
		border-radius: 50%;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.paint-bar {
		position: absolute;
		top: 0.6rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.3rem 0.35rem 0.3rem 0.75rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.7);
		color: var(--text-2);
		font-size: 0.7rem;
		white-space: nowrap;
		cursor: default;
	}

	.paint-bar button {
		padding: 0.2rem 0.7rem;
		border: 1px solid var(--live-dim);
		border-radius: 999px;
		background: none;
		color: var(--live);
		font: inherit;
		cursor: pointer;
	}
</style>
