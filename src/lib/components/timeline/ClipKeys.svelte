<script lang="ts">
	import ContextMenu from "../ui/ContextMenu.svelte";
	import { Diamond } from "lucide-svelte";
	import { formatTimeMs } from "../../audio/audio-utils";
	import type { KeyEase } from "../../keyframes";

	/** The keys along a selected clip's bar, or a lane's: click, Shift-click or
	 * Ctrl-click to select them, drag to move the selection, Delete to remove it,
	 * right-click for eases and the rest. Works in seconds from `start`. */
	interface Props {
		/** Every moment there is a key, seconds from `start`. */
		times: number[];
		/** Seconds the strip spans. */
		length: number;
		/** Where the strip starts on the timeline, for seeking and the beat grid. */
		start: number;
		/** Whose keys these are, for the menu and tooltips. */
		scope: "clip" | "layer";
		easeAt: (t: number) => KeyEase | "mixed" | undefined;
		/** Seconds per beat and the first beat's time, for snapping; 0 is off. */
		beatSec?: number;
		beatOffset?: number;
		onSeek: (time: number) => void;
		/** `coalesceKey` keeps one drag one undo step. */
		onMove: (times: number[], delta: number, coalesceKey: string) => void;
		onEase: (times: number[], ease: KeyEase | undefined) => void;
		onDelete: (times: number[]) => void;
		onDeleteAll: () => void;
		onSimplify: () => void;
		onRepeat?: () => void;
	}

	let {
		times,
		length,
		start,
		scope,
		easeAt,
		beatSec = 0,
		beatOffset = 0,
		onSeek,
		onMove,
		onEase,
		onDelete,
		onDeleteAll,
		onSimplify,
		onRepeat,
	}: Props = $props();

	/** Within this many pixels of a beat, a dragged key lands on it. */
	const SNAP_PX = 6;
	/** Movement under this is a click. */
	const CLICK_PX = 3;
	const SAME = 1e-3;

	const has = (list: readonly number[], t: number) =>
		list.some((x) => Math.abs(x - t) <= SAME);

	let strip: HTMLDivElement | undefined = $state();
	let menu = $state<{ x: number; y: number } | null>(null);
	let picked = $state<number[]>([]);
	let anchor: number | null = null;
	let dragSerial = 0;

	/** The picked keys still there: an undo or an edit elsewhere can take some away. */
	let selected = $derived(picked.filter((t) => has(times, t)));
	let noun = $derived(scope === "clip" ? "Keys" : "Layer keys");

	function pct(t: number): number {
		return length > 0 ? (t / length) * 100 : 0;
	}

	function select(
		t: number,
		e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
	) {
		if (e.ctrlKey || e.metaKey) {
			picked = has(selected, t)
				? selected.filter((x) => Math.abs(x - t) > SAME)
				: [...selected, t];
			anchor = t;
			return;
		}
		if (e.shiftKey && anchor !== null && has(times, anchor)) {
			const lo = Math.min(anchor, t) - SAME;
			const hi = Math.max(anchor, t) + SAME;
			picked = times.filter((x) => x >= lo && x <= hi);
			return;
		}
		picked = [t];
		anchor = t;
	}

	function onPointerDown(e: PointerEvent, t: number) {
		if (e.button !== 0 || !strip) return;
		// The clip under it would start a drag of its own.
		e.stopPropagation();
		e.preventDefault();
		const target = e.currentTarget as HTMLElement;
		// Held off by preventDefault; Delete needs it to land here, not on the clip.
		target.focus({ preventScroll: true });
		if (e.shiftKey || e.ctrlKey || e.metaKey) {
			select(t, e);
			return;
		}
		if (!has(selected, t)) select(t, e);
		target.setPointerCapture(e.pointerId);
		const width = strip.getBoundingClientRect().width;
		const secPerPx = width > 0 ? length / width : 0;
		const x0 = e.clientX;
		const coalesceKey = `keys-drag:${++dragSerial}`;
		let moving = [...selected];
		const lo = Math.min(...moving);
		const hi = Math.max(...moving);
		let applied = 0;
		let moved = false;

		const move = (ev: PointerEvent) => {
			const dx = ev.clientX - x0;
			if (!moved && Math.abs(dx) < CLICK_PX) return;
			moved = true;
			let delta = dx * secPerPx;
			if (beatSec > 0 && !ev.altKey) {
				const abs = start + t + delta;
				const beat =
					Math.round((abs - beatOffset) / beatSec) * beatSec + beatOffset;
				if (Math.abs(beat - abs) <= SNAP_PX * secPerPx)
					delta = beat - start - t;
			}
			// The whole selection stays on the strip.
			delta = Math.min(Math.max(delta, -lo), length - hi);
			const step = delta - applied;
			if (Math.abs(step) < 1e-4) return;
			onMove(moving, step, coalesceKey);
			moving = moving.map((x) => x + step);
			picked = moving;
			if (anchor !== null) anchor += step;
			applied = delta;
		};
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			target.removeEventListener("pointercancel", up);
			if (moved) return;
			// A plain click on one of several picked keys narrows to it.
			picked = [t];
			anchor = t;
			onSeek(start + t);
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
		target.addEventListener("pointercancel", up);
	}

	function openMenu(e: MouseEvent, t: number) {
		e.preventDefault();
		e.stopPropagation();
		if (!has(selected, t)) {
			picked = [t];
			anchor = t;
		}
		menu = { x: e.clientX, y: e.clientY };
	}

	function onKeydown(e: KeyboardEvent, t: number) {
		if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			e.stopPropagation();
			onDelete(has(selected, t) ? selected : [t]);
			picked = [];
		} else if (e.key === "Escape" && selected.length > 0) {
			e.preventDefault();
			e.stopPropagation();
			picked = [];
		} else if (e.key === "Enter") {
			e.preventDefault();
			e.stopPropagation();
			onSeek(start + t);
		}
	}

	function pick(action: () => void) {
		action();
		menu = null;
	}

	/** The ease every selected key shares, for the menu's check mark. */
	let sharedEase = $derived.by(() => {
		const eases = selected.map(easeAt);
		return eases.every((x) => x === eases[0]) ? eases[0] : "mixed";
	});

	const EASES: { ease: KeyEase | undefined; label: string }[] = [
		{ ease: undefined, label: "Linear" },
		{ ease: "smooth", label: "Smooth" },
		{ ease: "hold", label: "Hold until the next key" },
	];
</script>

<div class="clip-keys" class:top={scope === "layer"} bind:this={strip}>
	{#each times as t, i (i)}
		{#if t >= 0 && t <= length}
			<button
				type="button"
				class="clip-key"
				class:hold={easeAt(t) === "hold"}
				class:picked={has(selected, t)}
				style="left: {pct(t)}%"
				title="{noun} at {formatTimeMs(
					start + t,
				)}. Click to select one and jump to it. Shift-click selects a range and Ctrl-click adds one. Drag to move the selection; right-click for more."
				aria-label="{noun} at {formatTimeMs(start + t)}"
				aria-pressed={has(selected, t)}
				onpointerdown={(e) => onPointerDown(e, t)}
				oncontextmenu={(e) => openMenu(e, t)}
				onkeydown={(e) => onKeydown(e, t)}
				ondblclick={(e) => e.stopPropagation()}
			>
				<Diamond size={9} />
			</button>
		{/if}
	{/each}
</div>

{#if menu}
	<!-- Fixed, so the lane's own overflow can't clip it. -->
	<ContextMenu x={menu.x} y={menu.y} onClose={() => (menu = null)}>
		{#each EASES as option (option.label)}
			<button
				type="button"
				role="menuitemradio"
				aria-checked={sharedEase === option.ease}
				class:active={sharedEase === option.ease}
				onclick={() => pick(() => onEase(selected, option.ease))}
				>{option.label}</button
			>
		{/each}
		<hr />
		<button
			type="button"
			role="menuitem"
			class="danger"
			onclick={() =>
				pick(() => {
					onDelete(selected);
					picked = [];
				})}
			>{selected.length > 1
				? "Delete the selected keys"
				: "Delete this key"}</button
		>
		<button
			type="button"
			role="menuitem"
			class="danger"
			onclick={() =>
				pick(() => {
					onDeleteAll();
					picked = [];
				})}>Delete every key on this {scope}</button
		>
		{#if times.length > 2 || (onRepeat && times.length > 1)}
			<hr />
		{/if}
		{#if times.length > 2}
			<button
				type="button"
				role="menuitem"
				title="Drops keys that sit close to the line between their neighbours. The motion looks the same."
				onclick={() => pick(onSimplify)}>Simplify keys</button
			>
		{/if}
		{#if onRepeat && times.length > 1}
			<button
				type="button"
				role="menuitem"
				title="Plays the run from the first key to the last over and over until the {scope} ends."
				onclick={() => pick(onRepeat)}>Repeat to the {scope}'s end</button
			>
		{/if}
	</ContextMenu>
{/if}

<style>
	.clip-keys {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 12px;
		pointer-events: none;
	}

	.clip-keys.top {
		top: 0;
		bottom: auto;
	}

	.clip-key {
		position: absolute;
		bottom: 1px;
		width: 12px;
		height: 12px;
		margin-left: -6px;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		color: var(--live);
		cursor: ew-resize;
		pointer-events: auto;
		z-index: 2;
	}

	.clip-keys.top .clip-key {
		top: 1px;
		bottom: auto;
	}

	.clip-key :global(svg) {
		fill: currentColor;
		filter: drop-shadow(0 0 1px var(--ink));
	}

	.clip-key.hold :global(svg) {
		fill: var(--ink);
	}

	.clip-key.picked {
		color: var(--text);
	}

	.clip-key.picked :global(svg) {
		filter: drop-shadow(0 0 2px var(--live));
	}

	.clip-key:hover,
	.clip-key:focus-visible {
		color: var(--text);
	}
</style>
