<script lang="ts">
	import { Diamond } from "lucide-svelte";
	import { formatTimeMs } from "../../audio/audio-utils";
	import type { KeyEase } from "../../keyframes";

	/** The keys along a selected clip's bar: click to go there, drag to retime,
	 * right-click to ease, delete or repeat them. Works in clip seconds. */
	interface Props {
		/** Every moment the clip has a key, seconds from its start. */
		times: number[];
		/** Seconds from the clip's start to its end. */
		length: number;
		/** Where the clip starts on the timeline, for seeking and the beat grid. */
		start: number;
		easeAt: (t: number) => KeyEase | "mixed" | undefined;
		/** Seconds per beat and the first beat's time, for snapping; 0 is off. */
		beatSec?: number;
		beatOffset?: number;
		onSeek: (time: number) => void;
		/** `coalesceKey` keeps one drag one undo step. */
		onMove: (from: number, to: number, coalesceKey: string) => void;
		onEase: (t: number, ease: KeyEase | undefined) => void;
		onDelete: (t: number) => void;
		onRepeat?: () => void;
	}

	let {
		times,
		length,
		start,
		easeAt,
		beatSec = 0,
		beatOffset = 0,
		onSeek,
		onMove,
		onEase,
		onDelete,
		onRepeat,
	}: Props = $props();

	/** Within this many pixels of a beat, a dragged key lands on it. */
	const SNAP_PX = 6;
	/** Movement under this is a click. */
	const CLICK_PX = 3;

	let strip: HTMLDivElement | undefined = $state();
	let menu = $state<{ t: number; x: number; y: number } | null>(null);
	let dragSerial = 0;

	function pct(t: number): number {
		return length > 0 ? (t / length) * 100 : 0;
	}

	function onPointerDown(e: PointerEvent, t: number) {
		if (e.button !== 0 || !strip) return;
		// The clip under it would start a drag of its own.
		e.stopPropagation();
		e.preventDefault();
		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);
		const width = strip.getBoundingClientRect().width;
		const secPerPx = width > 0 ? length / width : 0;
		const x0 = e.clientX;
		const coalesceKey = `keys-drag:${++dragSerial}`;
		let at = t;
		let moved = false;

		const move = (ev: PointerEvent) => {
			const dx = ev.clientX - x0;
			if (!moved && Math.abs(dx) < CLICK_PX) return;
			moved = true;
			let next = Math.min(Math.max(t + dx * secPerPx, 0), length);
			if (beatSec > 0 && !ev.altKey) {
				const abs = start + next;
				const beat =
					Math.round((abs - beatOffset) / beatSec) * beatSec + beatOffset;
				if (Math.abs(beat - abs) <= SNAP_PX * secPerPx)
					next = Math.min(Math.max(beat - start, 0), length);
			}
			if (Math.abs(next - at) < 1e-4) return;
			onMove(at, next, coalesceKey);
			at = next;
		};
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			target.removeEventListener("pointercancel", up);
			if (!moved) onSeek(start + t);
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
		target.addEventListener("pointercancel", up);
	}

	function openMenu(e: MouseEvent, t: number) {
		e.preventDefault();
		e.stopPropagation();
		menu = { t, x: e.clientX, y: e.clientY };
	}

	function onKeydown(e: KeyboardEvent, t: number) {
		if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			e.stopPropagation();
			onDelete(t);
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

	$effect(() => {
		if (!menu) return;
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent && e.key !== "Escape") return;
			menu = null;
		};
		window.addEventListener("pointerdown", close);
		window.addEventListener("keydown", close);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("keydown", close);
		};
	});

	const EASES: { ease: KeyEase | undefined; label: string }[] = [
		{ ease: undefined, label: "Linear" },
		{ ease: "smooth", label: "Smooth" },
		{ ease: "hold", label: "Hold until the next key" },
	];
</script>

<div class="clip-keys" bind:this={strip}>
	{#each times as t, i (i)}
		{#if t >= 0 && t <= length}
			<button
				type="button"
				class="clip-key"
				class:hold={easeAt(t) === "hold"}
				style="left: {pct(t)}%"
				title="Keys at {formatTimeMs(
					start + t,
				)}. Click to jump here and drag to move them. Right-click to change their ease or delete them."
				aria-label="Keys at {formatTimeMs(start + t)}"
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
	{@const current = easeAt(menu.t)}
	<!-- Fixed, so the lane's own overflow can't clip it. -->
	<div
		class="key-menu"
		role="menu"
		tabindex="-1"
		style="left: {menu.x}px; top: {menu.y}px"
		onpointerdown={(e) => e.stopPropagation()}
	>
		{#each EASES as option (option.label)}
			<button
				type="button"
				role="menuitemradio"
				aria-checked={current === option.ease}
				class:active={current === option.ease}
				onclick={() => pick(() => onEase(menu!.t, option.ease))}
				>{option.label}</button
			>
		{/each}
		<hr />
		{#if onRepeat && times.length > 1}
			<button
				type="button"
				role="menuitem"
				title="Plays the run from the first key to the last over and over until the clip ends."
				onclick={() => pick(onRepeat)}>Repeat to the clip's end</button
			>
		{/if}
		<button
			type="button"
			role="menuitem"
			class="danger"
			onclick={() => pick(() => onDelete(menu!.t))}>Delete these keys</button
		>
	</div>
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

	.clip-key :global(svg) {
		fill: currentColor;
		filter: drop-shadow(0 0 1px var(--ink));
	}

	.clip-key.hold :global(svg) {
		fill: var(--ink);
	}

	.clip-key:hover,
	.clip-key:focus-visible {
		color: var(--text);
	}

	.key-menu {
		position: fixed;
		z-index: 1000;
		min-width: 160px;
		padding: 0.25rem;
		display: flex;
		flex-direction: column;
		background: var(--raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-2);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
	}

	.key-menu button {
		padding: 0.3rem 0.5rem;
		text-align: left;
		font-size: 0.72rem;
		color: var(--text-2);
		background: none;
		border: none;
		border-radius: var(--r-1);
		cursor: pointer;
	}

	.key-menu button:hover {
		background: var(--sunken);
		color: var(--text);
	}

	.key-menu button.active {
		color: var(--live);
	}

	.key-menu button.danger:hover {
		color: var(--rec);
	}

	.key-menu hr {
		width: 100%;
		margin: 0.2rem 0;
		border: none;
		border-top: 1px solid var(--line);
	}
</style>
