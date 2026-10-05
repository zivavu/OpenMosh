<script lang="ts">
	import { onMount } from "svelte";
	import { maskPaint } from "../../effects/mask-paint.svelte";
	import {
		DEFAULT_KEY_SOFTNESS,
		KEY_RANGE_MAX,
		MAX_COLOR_KEYS,
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

	const target = $derived(maskPaint.target!);
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
	/** How close a press must land to a marker to take hold of it, in pixels. */
	const GRAB = 12;

	type Drag = {
		/** Null until the picked colour comes back. */
		index: number | null;
		x0: number;
		y0: number;
		range: number;
		/** Past the first tick of the drag: later ticks extend its undo step. */
		moved: boolean;
	};
	let drag: Drag | null = null;
	/** The drag's reach on screen, drawn as a ring so the range has something to point at. */
	let ring = $state<{ x: number; y: number; r: number } | null>(null);

	function areaPoint(e: PointerEvent) {
		const ar = area.getBoundingClientRect();
		return { x: e.clientX - ar.left, y: e.clientY - ar.top };
	}

	function write(next: ColorKey[], extend: boolean) {
		session.save(serializeKeys(next), extend);
		redraw();
	}

	function onDown(e: PointerEvent) {
		e.stopPropagation();
		if (e.button !== 0 || !box) return;
		e.preventDefault();
		const p = areaPoint(e);
		const b = box;
		const near = keys.findIndex((k) => {
			const m = uvPoint(b, k.x, k.y);
			return Math.hypot(m.x - p.x, m.y - p.y) <= GRAB;
		});
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		if (near >= 0) {
			maskPaint.keyIndex = near;
			const m = uvPoint(b, keys[near].x, keys[near].y);
			drag = {
				index: near,
				x0: m.x,
				y0: m.y,
				range: keys[near].range,
				moved: false,
			};
			showRing();
			return;
		}
		const { u, v } = boxUv(b, p.x, p.y);
		if (u < 0 || u > 1 || v < 0 || v > 1) return;
		if (keys.length >= MAX_COLOR_KEYS) return;
		const pending: Drag = {
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
				},
			];
			write(next, false);
			maskPaint.keyIndex = next.length - 1;
			// Ticks from here on extend the step the pick just made.
			pending.index = next.length - 1;
			pending.moved = true;
		});
		redraw();
	}

	function onMove(e: PointerEvent) {
		if (!drag || !box) return;
		const p = areaPoint(e);
		const dist = Math.hypot(p.x - drag.x0, p.y - drag.y0);
		if (!drag.moved && dist < 4) return;
		const range =
			KEY_RANGE_MAX * Math.min(1, dist / (FULL_DRAG * Math.min(box.w, box.h)));
		const extend = drag.moved;
		drag.range = range;
		drag.moved = true;
		showRing();
		if (drag.index === null) return;
		const index = drag.index;
		write(
			keys.map((k, i) => (i === index ? { ...k, range } : k)),
			extend,
		);
	}

	function showRing() {
		if (!drag || !box) return;
		const r = (drag.range / KEY_RANGE_MAX) * FULL_DRAG * Math.min(box.w, box.h);
		ring = { x: drag.x0, y: drag.y0, r };
	}

	function onUp() {
		drag = null;
		ring = null;
	}

	onMount(() =>
		captureToolKeys({
			close: () => (maskPaint.target = null),
			undo: () => session.undo() !== null && redraw(),
			redo: () => session.redo() !== null && redraw(),
		}),
	);

	$effect(() => {
		if (!target.alive()) maskPaint.target = null;
	});

	const markers = $derived(
		box ? keys.map((k) => ({ key: k, at: uvPoint(box!, k.x, k.y) })) : [],
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="key-catcher"
	onpointerdown={onDown}
	onpointermove={onMove}
	onpointerup={onUp}
	onpointercancel={onUp}
>
	{#each markers as m, i (i)}
		<span
			class="marker"
			class:selected={i === maskPaint.keyIndex}
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
				? "A Mask holds up to 8 colors. Drag a dot to change its range."
				: "Click a color to select it. Drag outward to widen the range, or drag a dot to change one."}
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
