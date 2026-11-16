<script lang="ts">
	import ContextMenu from "../ui/ContextMenu.svelte";
	import KeyGlyph from "./KeyGlyph.svelte";
	import {
		EASE_HEADING,
		EASE_OPTIONS,
		easeLabel,
		repeatsFor,
	} from "../../timeline/key-eases";
	import { onDestroy, untrack } from "svelte";
	import { dropBoxed, holdBoxed } from "../../timeline/key-focus.svelte";
	import { formatTimeMs } from "../../audio/audio-utils";
	import { NUDGE_SEC, type KeyEase } from "../../keyframes";
	import { copyKeys, type CopiedKey } from "../../timeline/key-clipboard";
	import { CLICK_PX, FinePointer, isFine, PLAIN } from "../../fine-drag";
	import DragReadout from "./DragReadout.svelte";
	import { keyGrid } from "../../timeline/key-grid.svelte";
	import { nextGridLine, onGrid } from "../../key-grid";

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
		/** The keys at these moments laid down again every `period` seconds. */
		onRepeatEvery?: (times: number[], period: number) => void;
		/** What has a key at this moment, for its tooltip. */
		describe?: (t: number) => string;
		/** The keys at these moments, for the clipboard. */
		onCopy?: (times: number[]) => CopiedKey[];
		/** A key the panel's arrows stepped to, seconds from `start`: it gets selected. */
		focus?: { t: number; serial: number } | null;
		/** A shift-drag box over the lane, seconds from `start`: the keys in it get
		 * selected, for the next Delete. */
		box?: { from: number; to: number; serial: number } | null;
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
		onCopy,
		describe,
		onRepeatEvery,
		focus = null,
		box = null,
	}: Props = $props();

	/** Within this many pixels of a beat, a dragged key lands on it. */
	const SNAP_PX = 6;
	const SAME = 1e-3;

	const has = (list: readonly number[], t: number) =>
		list.some((x) => Math.abs(x - t) <= SAME);

	let strip: HTMLDivElement | undefined = $state();
	let menu = $state<{ x: number; y: number } | null>(null);
	let picked = $state<number[]>([]);
	let anchor: number | null = null;
	let dragSerial = 0;
	let readout = $state<{ x: number; y: number; text: string } | null>(null);

	/** The picked keys still there: an undo or an edit elsewhere can take some away. */
	let selected = $derived(picked.filter((t) => has(times, t)));
	// Only a step taken while the strip is up selects; a scroll that shifts
	// `focus.t` doesn't.
	let focusSerial = untrack(() => focus?.serial ?? 0);
	$effect(() => {
		if (!focus || focus.serial === focusSerial) return;
		focusSerial = focus.serial;
		untrack(() => {
			const t = focus!.t;
			const hit = times.find((x) => Math.abs(x - t) <= SAME);
			if (hit === undefined) return;
			picked = [hit];
			anchor = hit;
		});
	});

	const boxId = Symbol("clip-keys");
	let boxSerial = 0;
	$effect(() => {
		if (!box || box.serial === boxSerial) return;
		boxSerial = box.serial;
		const { from, to } = box;
		untrack(() => {
			picked = times.filter((t) => t >= from - SAME && t <= to + SAME);
			anchor = picked[0] ?? null;
			if (picked.length === 0) return;
			holdBoxed(
				boxId,
				() => {
					if (selected.length > 0) onDelete(selected);
					picked = [];
				},
				() => onCopy?.(selected) ?? [],
			);
		});
	});
	onDestroy(() => dropBoxed(boxId));

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
		if (e.shiftKey) {
			select(t, e);
			return;
		}
		// Ctrl: a click adds or drops the key, a drag moves slowly.
		const ctrlPress = isFine(e);
		if (!ctrlPress && !has(selected, t)) select(t, e);
		target.setPointerCapture(e.pointerId);
		const width = strip.getBoundingClientRect().width;
		const secPerPx = width > 0 ? length / width : 0;
		const pointer = new FinePointer(e);
		const x0 = pointer.x;
		const coalesceKey = `keys-drag:${++dragSerial}`;
		let moving: number[] = [];
		let lo = 0;
		let hi = 0;
		let applied = 0;
		let moved = false;

		const move = (ev: PointerEvent) => {
			pointer.move(ev);
			if (!moved) {
				if (Math.abs(ev.clientX - e.clientX) < CLICK_PX) return;
				moved = true;
				if (!has(selected, t)) select(t, PLAIN);
				moving = [...selected];
				lo = Math.min(...moving);
				hi = Math.max(...moving);
			}
			let delta = (pointer.x - x0) * secPerPx;
			const grid = keyGrid();
			if (grid && !ev.altKey)
				delta = onGrid(start + t + delta, grid) - start - t;
			else if (beatSec > 0 && !ev.altKey) {
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
			readout = {
				x: ev.clientX,
				y: ev.clientY,
				text: formatTimeMs(start + t + delta),
			};
		};
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			target.removeEventListener("pointercancel", up);
			readout = null;
			if (moved) return;
			if (ctrlPress) {
				select(t, e);
				return;
			}
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
		const these = has(selected, t) ? selected : [t];
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && onCopy) {
			e.preventDefault();
			e.stopPropagation();
			copyKeys(onCopy(these));
		} else if (
			(e.key === "ArrowLeft" || e.key === "ArrowRight") &&
			!e.ctrlKey &&
			!e.metaKey
		) {
			e.preventDefault();
			e.stopPropagation();
			nudge(t, these, e.key === "ArrowLeft" ? -1 : 1, e.shiftKey);
		} else if (e.key === "Delete" || e.key === "Backspace") {
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

	function keyTitle(t: number): string {
		const ease = easeAt(t);
		const what = describe?.(t);
		return (
			`${noun} at ${formatTimeMs(start + t)}` +
			(what ? `: ${what}` : "") +
			(ease ? `. To the next key: ${easeLabel(ease)}` : "")
		);
	}

	/** The keys a frame along, or to the next grid line while the grid is on; a beat
	 * with `beat` while there is one. `t` is the key the arrow was pressed on. */
	function nudge(t: number, these: number[], direction: -1 | 1, beat: boolean) {
		const grid = keyGrid();
		const step =
			beat && beatSec > 0
				? direction * beatSec
				: grid
					? nextGridLine(start + t, grid, direction) - start - t
					: direction * NUDGE_SEC;
		const lo = Math.min(...these);
		const hi = Math.max(...these);
		const delta = Math.min(Math.max(step, -lo), length - hi);
		if (Math.abs(delta) < 1e-4) return;
		onMove(these, delta, `keys-nudge:${++dragSerial}`);
		picked = these.map((x) => x + delta);
		if (anchor !== null) anchor += delta;
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
</script>

<div class="clip-keys" class:top={scope === "layer"} bind:this={strip}>
	{#each times as t, i (i)}
		{#if t >= 0 && t <= length}
			<button
				type="button"
				class="clip-key"
				class:picked={has(selected, t)}
				style="left: {pct(t)}%"
				title={keyTitle(t)}
				aria-label="{noun} at {formatTimeMs(start + t)}"
				aria-pressed={has(selected, t)}
				onpointerdown={(e) => onPointerDown(e, t)}
				oncontextmenu={(e) => openMenu(e, t)}
				onkeydown={(e) => onKeydown(e, t)}
				ondblclick={(e) => e.stopPropagation()}
			>
				<KeyGlyph ease={easeAt(t)} />
			</button>
		{/if}
	{/each}
</div>

{#if readout}
	<DragReadout {...readout} />
{/if}

{#if menu}
	<!-- Fixed, so the lane's own overflow can't clip it. -->
	<ContextMenu x={menu.x} y={menu.y} onClose={() => (menu = null)}>
		<span class="menu-label">{EASE_HEADING}</span>
		{#each EASE_OPTIONS as option (option.label)}
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
		{@const repeats =
			onRepeatEvery && selected.length > 0
				? repeatsFor(Math.max(...selected) - Math.min(...selected), beatSec)
				: []}
		{#if times.length > 2 || (onRepeat && times.length > 1) || repeats.length > 0}
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
		{#each repeats as option (option.beats)}
			<button
				type="button"
				role="menuitem"
				onclick={() =>
					pick(() => onRepeatEvery?.(selected, option.beats * beatSec))}
				>{option.label}</button
			>
		{/each}
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
