<script lang="ts">
	import { onMount } from "svelte";
	import { maskPaint } from "../../effects/mask-paint.svelte";
	import type { GlRenderer } from "../../gl/renderer";
	import type { MediaLane } from "../../media";
	import type { HandleFrame } from "../../editor/layer-drag";
	import {
		boxUv,
		captureToolKeys,
		createParamSession,
		followBox,
		measureMaskBox,
		uvPoint,
		type MaskBox,
	} from "./mask-tools";
	import {
		moveShape,
		rotateShape,
		scaleShape,
		shapeGeometry,
		imageBase,
		shapeHandle,
		type ShapeValues,
	} from "./mask-shape";
	import MaskToolBar from "./MaskToolBar.svelte";

	interface Props {
		renderer: GlRenderer;
		canvas: HTMLCanvasElement;
		area: HTMLDivElement;
		/** The selected media lane; a Mask on its clip edits over its box. */
		lane: MediaLane | null;
		/** Draw a frame now, for when no animation loop will. */
		redraw: () => void;
	}

	let { renderer, canvas, area, lane, redraw }: Props = $props();

	// Held from mount: the layer outlives the target while it fades out.
	const target = maskPaint.target!;
	let box = $state<MaskBox | null>(null);
	onMount(() =>
		followBox(
			() => measureMaskBox(renderer, canvas, area, lane, target.laneId),
			(next) => (box = next),
		),
	);

	/** The params as stored: for the Image shape, width and height are multiples of its Fit. */
	const stored = $derived(JSON.parse(target.current()) as ShapeValues);

	// The Image shape's own proportions, read off the loaded picture.
	let imageAspect = $state(1);
	$effect(() => {
		const url = target.image?.().url;
		if (!url) {
			imageAspect = 1;
			return;
		}
		const img = new Image();
		img.onload = () => (imageAspect = img.naturalWidth / img.naturalHeight);
		img.src = url;
	});

	/** Short-edge size at Width and Height 1: the Fit's rectangle, or 1 for shapes. */
	const base = $derived(
		target.image && box
			? imageBase(imageAspect, box.w / box.h, target.image().fit)
			: { w: 1, h: 1 },
	);
	/** The Image shape's size limits, as multiples of its Fit (catalog/mask.ts). */
	const IMAGE_SIZE = { min: 0.05, max: 4 };

	/** The shape in short-edge units, the way the drag math and the outline want it. */
	const shape = $derived({
		...stored,
		width: stored.width * base.w,
		height: stored.height * base.h,
	});

	/** Back to what the params hold. */
	function toStored(s: ShapeValues): ShapeValues {
		if (!target.image) return s;
		const clampSize = (v: number) =>
			Math.min(IMAGE_SIZE.max, Math.max(IMAGE_SIZE.min, v));
		return {
			...s,
			width: clampSize(s.width / base.w),
			height: clampSize(s.height / base.h),
		};
	}

	/** The Image shape is held by its own limits, applied in toStored. */
	const sizeMax = $derived(target.image ? Infinity : undefined);
	const gradient = $derived(target.shape === "gradient");

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

	/** Screen pixels a press must travel before it counts as a move. */
	const MOVE_SLOP = 3;

	type Drag = { from: ShapeValues; moved: boolean } & (
		| { kind: "move"; x0: number; y0: number }
		| { kind: "scale"; g: HandleFrame }
		| { kind: "rotate"; cx: number; cy: number; a0: number }
	);
	let drag: Drag | null = null;

	/** The pointer in the box's own unturned pixels. */
	function local(e: PointerEvent): { x: number; y: number } | null {
		if (!box) return null;
		const ar = area.getBoundingClientRect();
		const { u, v } = boxUv(box, e.clientX - ar.left, e.clientY - ar.top);
		return { x: u * box.w, y: v * box.h };
	}

	function grab(e: PointerEvent, start: (p: { x: number; y: number }) => Drag) {
		e.stopPropagation();
		if (e.button !== 0) return;
		e.preventDefault();
		const p = local(e);
		if (!p) return;
		catcher.setPointerCapture(e.pointerId);
		drag = start(p);
	}

	const startMove = (e: PointerEvent) =>
		grab(e, (p) => ({
			kind: "move",
			from: shape,
			moved: false,
			x0: p.x,
			y0: p.y,
		}));

	const startScale = (e: PointerEvent, hx: -1 | 0 | 1, hy: -1 | 0 | 1) =>
		grab(e, () => ({
			kind: "scale",
			from: shape,
			moved: false,
			g: shapeHandle(shape, hx, hy, box!.w, box!.h),
		}));

	const startRotate = (e: PointerEvent) =>
		grab(e, (p) => {
			const g = shapeGeometry(shape, box!.w, box!.h);
			return {
				kind: "rotate",
				from: shape,
				moved: false,
				cx: g.cx,
				cy: g.cy,
				a0: Math.atan2(p.y - g.cy, p.x - g.cx),
			};
		});

	function onMove(e: PointerEvent) {
		if (!drag || !box) return;
		const p = local(e);
		if (!p) return;
		let next: ShapeValues;
		if (drag.kind === "move") {
			let dx = p.x - drag.x0;
			let dy = p.y - drag.y0;
			if (!drag.moved && Math.hypot(dx, dy) < MOVE_SLOP) return;
			// Shift holds the drag to whichever axis it has gone further along.
			if (e.shiftKey) {
				if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
				else dx = 0;
			}
			next = moveShape(drag.from, dx, dy, box.w, box.h, sizeMax);
		} else if (drag.kind === "scale") {
			next = scaleShape(
				drag.from,
				drag.g,
				p.x,
				p.y,
				box.w,
				box.h,
				e.altKey,
				sizeMax,
			);
		} else {
			next = rotateShape(drag.from, drag, p.x, p.y, e.shiftKey);
		}
		const extend = drag.moved;
		drag.moved = true;
		save(JSON.stringify(toStored(next)), extend);
	}

	function onUp(e: PointerEvent) {
		drag = null;
		if (catcher.hasPointerCapture(e.pointerId)) {
			catcher.releasePointerCapture(e.pointerId);
		}
	}

	function resetAngle() {
		if (shape.angle === 0) return;
		save(JSON.stringify({ ...stored, angle: 0 }));
	}

	function save(json: string, extend = false) {
		session.save(json, extend);
		redraw();
	}

	function step(changed: string | null) {
		if (changed === null) return;
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

	let catcher = $state<HTMLDivElement>(null!);

	/** Where the shape sits on screen: centre, size and the turn it shows at. */
	const placed = $derived.by(() => {
		if (!box) return null;
		const g = shapeGeometry(shape, box.w, box.h);
		const at = uvPoint(box, shape.x, shape.y);
		return { ...at, w: g.sw, h: g.sh, rot: box.rot + g.rot };
	});
	/** Long enough for the gradient's edge to cross the whole box at any turn. */
	const lineLength = $derived(box ? 2 * Math.hypot(box.w, box.h) : 0);

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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="shape-catcher"
	bind:this={catcher}
	onpointerdown={startMove}
	onpointermove={onMove}
	onpointerup={onUp}
	onpointercancel={onUp}
>
	{#if placed && gradient}
		<div
			class="gradient-pivot"
			style="left: {placed.x}px; top: {placed.y}px; transform: rotate({placed.rot}rad)"
		>
			<span class="gradient-edge" style:width="{lineLength}px"></span>
			<span class="gradient-grip"></span>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="shape-rotate"
				title="Drag to turn (Shift snaps to 15°). The effects show on this side. Double-click to reset."
				onpointerdown={startRotate}
				ondblclick={resetAngle}
			></div>
		</div>
	{:else if placed}
		<div
			class="shape-outline"
			class:round={target.shape === "ellipse"}
			style="left: {placed.x - placed.w / 2}px; top: {placed.y -
				placed.h /
					2}px; width: {placed.w}px; height: {placed.h}px; transform: rotate({placed.rot}rad)"
		>
			{#each HANDLES as h (h.hx * 3 + h.hy)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="shape-handle"
					style="left: {(h.hx + 1) * 50}%; top: {(h.hy + 1) *
						50}%; cursor: {h.cursor}"
					onpointerdown={(e) => startScale(e, h.hx, h.hy)}
				></div>
			{/each}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="shape-rotate"
				title="Drag to turn (Shift snaps to 15°). Double-click to reset."
				onpointerdown={startRotate}
				ondblclick={resetAngle}
			></div>
		</div>
	{/if}
	<MaskToolBar
		message={!box
			? "Select this clip's layer to edit the shape on it."
			: gradient
				? "Drag to move the edge. Turn it with the knob."
				: "Drag the shape to move it. Use the handles to resize or turn it."}
	/>
</div>

<style>
	.shape-catcher {
		position: absolute;
		inset: 0;
		z-index: 8;
		cursor: move;
		touch-action: none;
	}

	.shape-outline {
		position: absolute;
		border: 1px dashed var(--live);
		box-shadow:
			0 0 0 1px rgba(0, 0, 0, 0.55),
			inset 0 0 0 1px rgba(0, 0, 0, 0.55);
		pointer-events: none;
	}

	.shape-outline.round {
		border-radius: 50%;
	}

	.shape-handle {
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

	/* A knob on a stalk above the top edge; it turns with the shape. */
	.shape-rotate {
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

	.shape-rotate::before {
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

	/* A zero-size point at the gradient's centre; its children turn with it. */
	.gradient-pivot {
		position: absolute;
		width: 0;
		height: 0;
		pointer-events: none;
	}

	.gradient-pivot .shape-rotate {
		top: -30px;
		margin-left: -6px;
	}

	.gradient-pivot .shape-rotate::before {
		height: 20px;
	}

	.gradient-edge {
		position: absolute;
		top: 0;
		left: 0;
		transform: translateX(-50%);
		border-top: 1px dashed var(--live);
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.45);
	}

	.gradient-grip {
		position: absolute;
		width: 9px;
		height: 9px;
		margin: -5px 0 0 -5px;
		background: var(--live);
		border: 1px solid rgba(0, 0, 0, 0.7);
		box-sizing: border-box;
	}
</style>
