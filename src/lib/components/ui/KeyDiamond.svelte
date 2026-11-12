<script lang="ts">
	import { ChevronLeft, ChevronRight, Diamond } from "lucide-svelte";

	/** A slider's keyframe switch: hidden until its row is hovered, unless the value
	 * is animated. With a previous/next pair once there are keys to step between. */
	interface Props {
		/** The setting's name, for screen readers. */
		label: string;
		keyed: boolean;
		/** A key sits at the playhead. */
		here: boolean;
		/** The tooltip before anything is keyed. */
		startHint: string;
		onToggle: (clear: boolean) => void;
		/** Null when there is no key that way. */
		prev?: (() => void) | null;
		next?: (() => void) | null;
	}

	let {
		label,
		keyed,
		here,
		startHint,
		onToggle,
		prev = null,
		next = null,
	}: Props = $props();

	const REMOVE_HINT =
		"Remove the key here. Shift-click stops the animation and keeps the value on screen.";
	const ADD_HINT =
		"Key the value shown here. Shift-click stops the animation and keeps the value on screen.";
</script>

<span class="key-diamond" class:keyed>
	{#if keyed}
		<button
			type="button"
			class="key-step"
			title="Previous key"
			aria-label="Previous key of {label}"
			disabled={!prev}
			onclick={() => prev?.()}
		>
			<ChevronLeft size={11} />
		</button>
	{/if}
	<button
		type="button"
		class="key-btn"
		class:here
		aria-pressed={keyed}
		title={!keyed ? startHint : here ? REMOVE_HINT : ADD_HINT}
		aria-label={!keyed
			? `Animate ${label}`
			: here
				? `Remove the key on ${label}`
				: `Add a key on ${label}`}
		onclick={(e) => onToggle(e.shiftKey)}
		ondblclick={(e) => e.stopPropagation()}
	>
		<Diamond size={11} />
	</button>
	{#if keyed}
		<button
			type="button"
			class="key-step"
			title="Next key"
			aria-label="Next key of {label}"
			disabled={!next}
			onclick={() => next?.()}
		>
			<ChevronRight size={11} />
		</button>
	{/if}
</span>

<style>
	.key-diamond {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		opacity: 0;
		transition: opacity var(--t-fast);
	}

	/* Out of the way until its row is hovered, and for good once the value animates. */
	:global(.param-row:hover) .key-diamond,
	:global(.row:hover) .key-diamond,
	.key-diamond:focus-within,
	.key-diamond.keyed {
		opacity: 1;
	}

	.key-btn,
	.key-step {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--r-1);
		color: var(--text-3);
		cursor: pointer;
	}

	.key-step:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.key-btn:hover,
	.key-step:not(:disabled):hover {
		color: var(--text);
	}

	.keyed .key-btn {
		color: var(--live);
	}

	.key-btn.here :global(svg) {
		fill: currentColor;
	}
</style>
