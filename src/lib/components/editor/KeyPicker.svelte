<script lang="ts" module>
	/** One colour as the picker draws and drags it. */
	export interface PickerKey {
		/** Any CSS colour. */
		color: string;
		/** 0..1 of the box, y down. */
		x: number;
		y: number;
		range: number;
		on: boolean;
	}

	export type PickerPatch = Partial<Pick<PickerKey, "x" | "y" | "range">>;
</script>

<script lang="ts">
	import { onMount, type Snippet } from "svelte";
	import { KEY_RANGE_MAX } from "../../color-key";
	import { isTextEntryTarget } from "../../editor/shortcut-target";
	import { boxUv, uvPoint, type MaskBox } from "./mask-tools";

	/** Colour picking over a picture, shared by the Mask's Key shape and the media
	 * key: click to pick (dragging out sets the range), drag a dot to move it, drag
	 * the selected colour's ring to resize it. */
	interface Props {
		keys: PickerKey[];
		/** Where the picture sits, in this layer's pixels; null takes no picks. */
		box: MaskBox | null;
		selected: number;
		max: number;
		onselect: (index: number) => void;
		/** A pick at (u, v). Call `added` with the new key's index once it exists;
		 * `range` reads the drag's range at that moment. */
		onadd: (
			u: number,
			v: number,
			range: () => number,
			added: (index: number) => void,
		) => void;
		/** `extend`: part of the same gesture as the last change. */
		onchange: (index: number, patch: PickerPatch, extend: boolean) => void;
		/** A dot was dropped somewhere new: take the colour there, extending the move. */
		onmoved: (index: number) => void;
		/** The dot under the pointer, -1 for none. */
		onfocus: (index: number) => void;
		/** Delete or Backspace, after a press on the picker or on an element marked
		 * `data-key-points` (the host's swatches). */
		ondelete: (index: number) => void;
		children?: Snippet;
	}

	let {
		keys,
		box,
		selected,
		max,
		onselect,
		onadd,
		onchange,
		onmoved,
		onfocus,
		ondelete,
		children,
	}: Props = $props();

	let el: HTMLDivElement;

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

	function localPoint(e: PointerEvent) {
		const r = el.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	function onDown(e: PointerEvent) {
		e.stopPropagation();
		if (e.button !== 0 || !box) return;
		e.preventDefault();
		const p = localPoint(e);
		const b = box;
		const near = markerAt(p);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		overRing = false;
		if (near >= 0) {
			onselect(near);
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
		const sel = keys[selected];
		const r = ring;
		if (sel && r && onRing(p)) {
			drag = {
				mode: "range",
				index: selected,
				x0: r.x,
				y0: r.y,
				range: sel.range,
				moved: false,
			};
			return;
		}
		const { u, v } = boxUv(b, p.x, p.y);
		if (u < 0 || u > 1 || v < 0 || v > 1) return;
		if (keys.length >= max) return;
		const pending: Drag = {
			mode: "range",
			index: null,
			x0: p.x,
			y0: p.y,
			range: CLICK_RANGE,
			moved: false,
		};
		drag = pending;
		onadd(
			u,
			v,
			() => pending.range,
			(index) => {
				onselect(index);
				// Ticks from here on extend the step the pick just made.
				pending.index = index;
				pending.moved = true;
				onfocus(index);
			},
		);
	}

	function onRing(p: { x: number; y: number }): boolean {
		return (
			!!ring &&
			Math.abs(Math.hypot(p.x - ring.x, p.y - ring.y) - ring.r) <= RING_GRAB
		);
	}

	/** The dot under a point in this layer's pixels, or -1. */
	function markerAt(p: { x: number; y: number }): number {
		const b = box;
		if (!b) return -1;
		return keys.findIndex((k) => {
			const m = uvPoint(b, k.x, k.y);
			return Math.hypot(m.x - p.x, m.y - p.y) <= GRAB;
		});
	}

	function onMove(e: PointerEvent) {
		if (!box) return;
		const p = localPoint(e);
		if (!drag) {
			const near = markerAt(p);
			onfocus(near);
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
		onchange(drag.index, { range }, extend);
	}

	/** The dot to where the pointer is, kept inside the box. */
	function moveTo(d: Drag, p: { x: number; y: number }) {
		if (!box || d.index === null) return;
		const { u, v } = boxUv(box, p.x, p.y);
		const extend = d.moved;
		d.moved = true;
		onchange(
			d.index,
			{ x: Math.min(1, Math.max(0, u)), y: Math.min(1, Math.max(0, v)) },
			extend,
		);
	}

	function onUp(e: PointerEvent) {
		const d = drag;
		drag = null;
		dragTick++;
		onfocus(markerAt(localPoint(e)));
		if (d?.mode === "move" && d.moved && d.index !== null) onmoved(d.index);
	}

	/** The last press was on the points, so Delete means the selected one. */
	let armed = false;
	onMount(() => {
		// Opened from a swatch: that press came before this listener.
		armed = !!document.activeElement?.closest("[data-key-points]");
		const onPress = (e: PointerEvent) => {
			const t = e.target as Element | null;
			armed = !!t && (el.contains(t) || !!t.closest("[data-key-points]"));
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Delete" && e.key !== "Backspace") return;
			if (!armed || drag || !keys[selected] || isTextEntryTarget(e.target)) {
				return;
			}
			// Ahead of the host's own Delete, which would take a keyframe instead.
			e.preventDefault();
			e.stopImmediatePropagation();
			ondelete(selected);
		};
		window.addEventListener("pointerdown", onPress, true);
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("pointerdown", onPress, true);
			window.removeEventListener("keydown", onKey, true);
		};
	});

	function onLeave() {
		if (drag) return;
		onfocus(-1);
		overRing = false;
	}

	/** The range on screen: the drag's while sizing, else the selected colour's. */
	const ring = $derived.by(() => {
		void dragTick;
		if (!box) return null;
		const scale = (FULL_DRAG * Math.min(box.w, box.h)) / KEY_RANGE_MAX;
		if (drag?.mode === "range") {
			return { x: drag.x0, y: drag.y0, r: drag.range * scale };
		}
		const k = keys[selected];
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
	bind:this={el}
	class="key-picker"
	class:over-ring={overRing}
	onpointerdown={onDown}
	onpointermove={onMove}
	onpointerup={onUp}
	onpointercancel={onUp}
	onpointerleave={onLeave}
>
	{#each markers as m, i (i)}
		<span
			class="marker"
			class:selected={i === selected}
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
	{@render children?.()}
</div>

<style>
	.key-picker {
		position: absolute;
		inset: 0;
		z-index: 8;
		cursor: crosshair;
		touch-action: none;
	}

	.key-picker.over-ring {
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
