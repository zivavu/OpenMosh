<script lang="ts">
	import { onMount } from "svelte";
	import { maskPaint, peekArea } from "../../effects/mask-paint.svelte";
	import {
		DEFAULT_KEY_SOFTNESS,
		KEY_RANGE_MAX,
		MAX_COLOR_KEYS,
	} from "../../color-key";
	import {
		parseKeys,
		serializeKeys,
		type ColorKey,
	} from "../../effects/mask-keys";
	import type { GlRenderer } from "../../gl/renderer";
	import type { MediaLane } from "../../media";
	import {
		boxUv,
		captureToolKeys,
		createParamSession,
		followBox,
		measureMaskBox,
		uvPoint,
		type MaskBox,
	} from "./mask-tools";
	import MaskToolBar from "./MaskToolBar.svelte";

	interface Props {
		renderer: GlRenderer;
		canvas: HTMLCanvasElement;
		area: HTMLDivElement;
		/** The selected media lane; a Mask on its clip picks over its box. */
		lane: MediaLane | null;
		/** Draw a frame now, for when no animation loop will. */
		redraw: () => void;
	}

	let { renderer, canvas, area, lane, redraw }: Props = $props();

	// Held from mount: the layer outlives the target while it fades out.
	const target = maskPaint.target!;
	const keys = $derived(parseKeys(target.current()));

	let box = $state<MaskBox | null>(null);
	onMount(() =>
		followBox(
			() => measureMaskBox(renderer, canvas, area, lane, target.laneId),
			(next) => (box = next),
		),
	);

	let session = createParamSession("", () => {});
	let sessionFor = "";
	$effect(() => {
		const t = target;
		if (sessionFor === t.instanceId) return;
		sessionFor = t.instanceId;
		session = createParamSession(t.current(), (v, history) =>
			t.commit(v, history),
		);
	});
	$effect(() => {
		const now = target.current();
		if (now !== session.value) session.adopt(now);
	});

	/** How far a drag reaches for the widest range, as a share of the box's short side. */
	const FULL_DRAG = 0.35;
	/** Range a click without a drag picks. */
	const CLICK_RANGE = 0.08;
	/** How close a press must land to a marker to move it, in pixels. */
	const GRAB = 8;
	/** And to the selected marker's ring to change its range. */
	const RING_GRAB = 10;

	type Drag = {
		/** Range: sized from (x0, y0). Move: the dot follows the pointer. */
		mode: "range" | "move";
		/** Null until the picked colour comes back. */
		index: number | null;
		x0: number;
		y0: number;
		range: number;
		/** Past the first tick of the drag: later ticks extend its undo step. */
		moved: boolean;
	};
	let drag: Drag | null = null;
	/** Bumped as a drag moves, so the ring follows it. */
	let dragTick = $state(0);
	/** The pointer is over the selected colour's ring. */
	let overRing = $state(false);

	function areaPoint(e: PointerEvent) {
		const ar = area.getBoundingClientRect();
		return { x: e.clientX - ar.left, y: e.clientY - ar.top };
	}

	function write(next: ColorKey[], extend: boolean) {
		session.save(serializeKeys(next), extend);
		peekArea(target.instanceId);
		redraw();
	}

	function step(changed: string | null) {
		if (changed === null) return;
		peekArea(target.instanceId);
		redraw();
	}

	function onDown(e: PointerEvent) {
		e.stopPropagation();
		if (e.button !== 0 || !box) return;
		e.preventDefault();
		const p = areaPoint(e);
		const b = box;
		const near = markerAt(p);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		overRing = false;
		if (near >= 0) {
			maskPaint.keyIndex = near;
			drag = {
				mode: "move",
				index: near,
				x0: p.x,
				y0: p.y,
				range: 0,
				moved: false,
			};
			return;
		}
		const sel = keys[maskPaint.keyIndex];
		const r = ring;
		if (sel && r && onRing(p)) {
			drag = {
				mode: "range",
				index: maskPaint.keyIndex,
				x0: r.x,
				y0: r.y,
				range: sel.range,
				moved: false,
			};
			return;
		}
		const { u, v } = boxUv(b, p.x, p.y);
		if (u < 0 || u > 1 || v < 0 || v > 1) return;
		if (keys.length >= MAX_COLOR_KEYS) return;
		const pending: Drag = {
			mode: "range",
			index: null,
			x0: p.x,
			y0: p.y,
			range: CLICK_RANGE,
			moved: false,
		};
		drag = pending;
		renderer.pickMaskColor(target.instanceId, u, v, (color) => {
			const next = [
				...keys,
				{
					color,
					x: u,
					y: v,
					range: pending.range,
					softness: DEFAULT_KEY_SOFTNESS,
					touching: false,
					on: true,
				},
			];
			write(next, false);
			maskPaint.keyIndex = next.length - 1;
			// Ticks from here on extend the step the pick just made.
			pending.index = next.length - 1;
			pending.moved = true;
			focus(pending.index);
		});
		redraw();
	}

	function onRing(p: { x: number; y: number }): boolean {
		return (
			!!ring &&
			Math.abs(Math.hypot(p.x - ring.x, p.y - ring.y) - ring.r) <= RING_GRAB
		);
	}

	/** The dot under a point in preview-area pixels, or -1. */
	function markerAt(p: { x: number; y: number }): number {
		const b = box;
		if (!b) return -1;
		return keys.findIndex((k) => {
			const m = uvPoint(b, k.x, k.y);
			return Math.hypot(m.x - p.x, m.y - p.y) <= GRAB;
		});
	}

	/** Narrow the tint to one colour, or widen it back with -1. */
	function focus(index: number) {
		const now = maskPaint.keyFocus;
		if (index < 0) {
			if (now?.instanceId === target.instanceId) maskPaint.keyFocus = null;
			return;
		}
		if (now?.instanceId === target.instanceId && now.index === index) return;
		maskPaint.keyFocus = { instanceId: target.instanceId, index };
	}
	onMount(() => () => focus(-1));

	function onMove(e: PointerEvent) {
		if (!box) return;
		const p = areaPoint(e);
		if (!drag) {
			const near = markerAt(p);
			focus(near);
			overRing = near < 0 && onRing(p);
			return;
		}
		const dist = Math.hypot(p.x - drag.x0, p.y - drag.y0);
		if (!drag.moved && dist < 4) return;
		if (drag.mode === "move") {
			moveTo(drag, p);
			return;
		}
		const range =
			KEY_RANGE_MAX * Math.min(1, dist / (FULL_DRAG * Math.min(box.w, box.h)));
		const extend = drag.moved;
		drag.range = range;
		drag.moved = true;
		dragTick++;
		if (drag.index === null) return;
		const index = drag.index;
		write(
			keys.map((k, i) => (i === index ? { ...k, range } : k)),
			extend,
		);
	}

	/** The dot to where the pointer is, kept inside the box. */
	function moveTo(d: Drag, p: { x: number; y: number }) {
		if (!box || d.index === null) return;
		const { u, v } = boxUv(box, p.x, p.y);
		const x = Math.min(1, Math.max(0, u));
		const y = Math.min(1, Math.max(0, v));
		const index = d.index;
		const extend = d.moved;
		d.moved = true;
		write(
			keys.map((k, i) => (i === index ? { ...k, x, y } : k)),
			extend,
		);
	}

	function onUp(e: PointerEvent) {
		const d = drag;
		drag = null;
		dragTick++;
		focus(markerAt(areaPoint(e)));
		// A moved dot takes the colour where it landed, in the same undo step.
		if (d?.mode !== "move" || !d.moved || d.index === null) return;
		const index = d.index;
		const k = keys[index];
		if (!k) return;
		renderer.pickMaskColor(target.instanceId, k.x, k.y, (color) => {
			const now = parseKeys(target.current());
			if (!now[index]) return;
			write(
				now.map((c, i) => (i === index ? { ...c, color } : c)),
				true,
			);
		});
		redraw();
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

	/** The range on screen: the drag's while sizing, else the selected colour's. */
	const ring = $derived.by(() => {
		void dragTick;
		if (!box) return null;
		const scale = (FULL_DRAG * Math.min(box.w, box.h)) / KEY_RANGE_MAX;
		if (drag?.mode === "range") {
			return { x: drag.x0, y: drag.y0, r: drag.range * scale };
		}
		const k = keys[maskPaint.keyIndex];
		if (!k) return null;
		const at = uvPoint(box, k.x, k.y);
		return { x: at.x, y: at.y, r: k.range * scale };
	});

	const markers = $derived(
		box ? keys.map((k) => ({ key: k, at: uvPoint(box!, k.x, k.y) })) : [],
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="key-catcher"
	class:over-ring={overRing}
	onpointerdown={onDown}
	onpointermove={onMove}
	onpointerup={onUp}
	onpointercancel={onUp}
	onpointerleave={() => {
		if (drag) return;
		focus(-1);
		overRing = false;
	}}
>
	{#each markers as m, i (i)}
		<span
			class="marker"
			class:selected={i === maskPaint.keyIndex}
			class:off={!m.key.on}
			style:left="{m.at.x}px"
			style:top="{m.at.y}px"
			style:background={m.key.color}
		></span>
	{/each}
	{#if ring && ring.r > 0}
		<span
			class="ring"
			style:left="{ring.x}px"
			style:top="{ring.y}px"
			style:width="{ring.r * 2}px"
			style:height="{ring.r * 2}px"
		></span>
	{/if}
	<MaskToolBar
		message={!box
			? "Select this clip's layer to pick colors on it."
			: keys.length >= MAX_COLOR_KEYS
				? "A Mask holds up to 8 colors. Drag a dot to move it, or the ring around it to change its range."
				: "Click a color to select it, dragging outward to set its range. Drag a dot to move it, or the ring around it to change its range."}
	/>
</div>

<style>
	.key-catcher {
		position: absolute;
		inset: 0;
		z-index: 8;
		cursor: crosshair;
		touch-action: none;
	}

	.key-catcher.over-ring {
		cursor: nwse-resize;
	}

	.marker {
		position: absolute;
		width: 12px;
		height: 12px;
		border: 2px solid #fff;
		border-radius: 50%;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
		transform: translate(-50%, -50%);
		cursor: grab;
	}

	/* Off: hollow, so the colour's place still shows. */
	.marker.off {
		background: transparent !important;
		border-style: dashed;
		opacity: 0.7;
	}

	.marker.selected {
		width: 16px;
		height: 16px;
		border-color: var(--live);
	}

	.ring {
		position: absolute;
		border: 1px dashed rgba(255, 255, 255, 0.85);
		border-radius: 50%;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}
</style>
