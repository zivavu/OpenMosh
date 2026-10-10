<script lang="ts">
	import { onMount } from "svelte";
	import { maskPaint } from "../../effects/mask-paint.svelte";
	import { DEFAULT_KEY_SOFTNESS, MAX_COLOR_KEYS } from "../../color-key";
	import {
		parseKeys,
		serializeKeys,
		type ColorKey,
	} from "../../effects/mask-keys";
	import type { GlRenderer } from "../../gl/renderer";
	import type { MediaLane } from "../../media";
	import {
		captureToolKeys,
		createParamSession,
		followBox,
		measureMaskBox,
		type MaskBox,
	} from "./mask-tools";
	import KeyPicker, { type PickerPatch } from "./KeyPicker.svelte";
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

	function write(next: ColorKey[], extend: boolean) {
		session.save(serializeKeys(next), extend);
		redraw();
	}

	function step(changed: string | null) {
		if (changed === null) return;
		redraw();
	}

	function add(
		u: number,
		v: number,
		range: () => number,
		added: (index: number) => void,
	) {
		renderer.pickMaskColor(target.instanceId, u, v, (color) => {
			const next = [
				...keys,
				{
					color,
					x: u,
					y: v,
					range: range(),
					softness: DEFAULT_KEY_SOFTNESS,
					touching: false,
					on: true,
				},
			];
			write(next, false);
			added(next.length - 1);
		});
		redraw();
	}

	function change(index: number, patch: PickerPatch, extend: boolean) {
		write(
			keys.map((k, i) => (i === index ? { ...k, ...patch } : k)),
			extend,
		);
	}

	/** A moved dot takes the colour where it landed, in the same undo step. */
	function moved(index: number) {
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

	function remove(index: number) {
		focus(-1);
		write(
			keys.filter((_, i) => i !== index),
			false,
		);
		if (maskPaint.keyIndex >= index && maskPaint.keyIndex > 0) {
			maskPaint.keyIndex--;
		}
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
</script>

<KeyPicker
	{keys}
	{box}
	selected={maskPaint.keyIndex}
	max={MAX_COLOR_KEYS}
	onselect={(i) => (maskPaint.keyIndex = i)}
	onadd={add}
	onchange={change}
	onmoved={moved}
	onfocus={focus}
	ondelete={remove}
>
	<MaskToolBar
		message={!box
			? "Select this clip's layer to pick colors on it."
			: keys.length >= MAX_COLOR_KEYS
				? "A Mask holds up to 8 colors. Drag a dot to move it, or the ring around it to change its range."
				: "Click a color to select it, dragging outward to set its range. Drag a dot to move it, or the ring around it to change its range."}
	/>
</KeyPicker>
