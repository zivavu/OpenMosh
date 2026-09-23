<script lang="ts">
	import { onMount } from "svelte";
	import type { ClipTransition } from "../../media/transition";
	import TransitionRows from "./TransitionRows.svelte";

	/** The transition editor a click on a join opens, anchored above it. */
	interface Props {
		anchor: DOMRect;
		transitions: (ClipTransition | undefined)[];
		onChange: (
			edit: (t: ClipTransition | undefined) => ClipTransition | undefined,
		) => void;
		onClose: () => void;
	}

	let { anchor, transitions, onChange, onClose }: Props = $props();

	let el: HTMLDivElement | undefined = $state();

	let left = $derived(
		Math.max(
			96,
			Math.min(window.innerWidth - 96, anchor.left + anchor.width / 2),
		),
	);
	let bottom = $derived(window.innerHeight - anchor.top + 6);

	onMount(() => {
		const onDown = (e: PointerEvent) => {
			if (!el?.contains(e.target as Node)) onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			onClose();
		};
		window.addEventListener("pointerdown", onDown, true);
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("pointerdown", onDown, true);
			window.removeEventListener("keydown", onKey, true);
		};
	});
</script>

<!-- Fixed, so the lane's own overflow can't clip it. -->
<div
	bind:this={el}
	class="trans-pop"
	style:left="{left}px"
	style:bottom="{bottom}px"
	role="dialog"
	aria-label="Transition"
>
	<div class="trans-pop-head">
		<span class="trans-pop-title">Transition</span>
		{#if transitions.length > 1}
			<span class="trans-pop-count">{transitions.length} joins</span>
		{/if}
		<button class="trans-pop-close" title="Close (Esc)" onclick={onClose}
			>&#10005;</button
		>
	</div>
	<TransitionRows {transitions} follows idPrefix="jp" {onChange} />
</div>

<style>
	.trans-pop {
		position: fixed;
		z-index: 60;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 220px;
		padding: 0.45rem 0.55rem 0.55rem;
		border: 1px solid var(--line);
		border-radius: 5px;
		background: #131313;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
	}

	.trans-pop-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.trans-pop-title {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--mosh);
	}

	.trans-pop-count {
		font-size: 0.6rem;
		color: var(--text-4);
	}

	.trans-pop-close {
		margin-left: auto;
		padding: 0 0.15rem;
		border: none;
		background: none;
		color: var(--text-4);
		font-size: 0.7rem;
		line-height: 1;
		cursor: pointer;
	}

	.trans-pop-close:hover {
		color: var(--text-2);
	}

	.trans-pop :global(.row) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
	}

	.trans-pop :global(.row label) {
		flex-shrink: 0;
		min-width: 64px;
		color: var(--text-2);
		font-size: 0.7rem;
		user-select: none;
	}

	.trans-pop :global(.row select) {
		flex: 1;
		min-width: 0;
		padding: 0.2rem 0.3rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.72rem;
		font-family: inherit;
	}

	.trans-pop :global(.label-spacer) {
		min-width: 64px;
	}
</style>
