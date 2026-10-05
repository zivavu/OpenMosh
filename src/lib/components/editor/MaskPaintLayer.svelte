<script lang="ts">
	import { onMount } from "svelte";
	import { maskPaint, peekArea } from "../../effects/mask-paint.svelte";
	import { softDab } from "../../brush/soft-dab";
	import type { GlRenderer } from "../../gl/renderer";
	import type { MediaLane } from "../../media";
	import { MASK_MAX } from "../../media/source-edit";
	import {
		boxUv,
		captureToolKeys,
		createParamSession,
		followBox,
		measureMaskBox,
		type MaskBox,
	} from "./mask-tools";
	import MaskToolBar from "./MaskToolBar.svelte";

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

	let box = $state<MaskBox | null>(null);

	// Followed every frame: the layer can move under it, and the preview resize.
	onMount(() =>
		followBox(
			() => measureMaskBox(renderer, canvas, area, lane, target.laneId),
			(next) => (box = next),
		),
	);

	let paint = $state<HTMLCanvasElement>(null!);
	let session = createParamSession("", () => {});
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
			const t = target;
			session = createParamSession(t.current(), (url, history) => {
				renderer.preloadBrush(url);
				t.commit(url, history);
			});
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
			load(session.value);
		}
	});

	// Undo buttons and Clear change the saved painting under the canvas; follow them.
	$effect(() => {
		const now = target.current();
		if (!ctx || now === session.value) return;
		session.adopt(now);
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
		renderer.setLiveBrush(target.instanceId, paint, session.value);
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
		const { u, v } = boxUv(box, e.clientX - ar.left, e.clientY - ar.top);
		return { x: u * paint.width, y: v * paint.height };
	}

	let last: { x: number; y: number } | null = null;
	let erasing = false;
	let cursor = $state<{ x: number; y: number } | null>(null);

	function strokeTo(p: { x: number; y: number }) {
		if (!ctx) return;
		const r = (maskPaint.size * Math.max(paint.width, paint.height)) / 2;
		const core = 1 - maskPaint.softness;
		// Dabs half a radius apart: close enough for a line, loose enough to stay soft.
		const from = last ?? p;
		const steps = Math.max(
			1,
			Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / Math.max(1, r / 2)),
		);
		for (let i = last ? 1 : 0; i <= steps; i++) {
			const t = i / steps;
			const x = from.x + (p.x - from.x) * t;
			softDab(ctx, x, from.y + (p.y - from.y) * t, r, !erasing, core);
		}
		last = p;
		peekArea(target.instanceId);
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
		session.save(paint.toDataURL("image/png"));
		show();
	}

	function step(url: string | null) {
		if (url === null) return;
		peekArea(target.instanceId);
		load(url);
	}

	onMount(() =>
		captureToolKeys({
			close: () => (maskPaint.target = null),
			undo: () => step(session.undo()),
			redo: () => step(session.redo()),
		}),
	);

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
	<MaskToolBar
		message={box
			? "Paint where the effects should show. Hold Alt to paint them out."
			: "Select this clip's layer to paint on it."}
	/>
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
</style>
