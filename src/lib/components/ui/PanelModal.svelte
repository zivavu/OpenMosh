<script lang="ts">
	import { modalDialog } from "../../actions/modal-dialog";
	import type { Snippet } from "svelte";
	import { X } from "lucide-svelte";
	import { onMount } from "svelte";
	import { pushModalKeyboard } from "../../modal-keyboard";

	/** The centred tool panel the generator and the webcam open in: overlay, card, a
	 * titled head with a close button, and the keyboard claimed while it is up. */
	interface Props {
		title: string;
		/** Accessible name; defaults to the title. */
		label?: string;
		/** Beside the title, dimmer: a size, a state. */
		sub?: string;
		/** While busy the overlay and close button refuse to close. */
		busy?: boolean;
		onClose: () => void;
		icon?: Snippet;
		children: Snippet;
	}

	let {
		title,
		label,
		sub,
		busy = false,
		onClose,
		icon,
		children,
	}: Props = $props();

	onMount(() => pushModalKeyboard());
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="overlay" onclick={() => !busy && onClose()}>
	<div
		class="panel"
		role="dialog"
		aria-modal="true"
		aria-label={label ?? title}
		tabindex="-1"
		{@attach modalDialog()}
		onclick={(e) => e.stopPropagation()}
	>
		<div class="head">
			<span class="title">{@render icon?.()} {title}</span>
			{#if sub}<span class="sub">{sub}</span>{/if}
			<button
				class="close"
				onclick={onClose}
				disabled={busy}
				aria-label="Close"
			>
				<X size={14} />
			</button>
		</div>
		{@render children()}
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		width: 640px;
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 2rem);
		padding: 1rem 1.1rem 1.1rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
		overflow: auto;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.title {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--mosh);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.sub {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		color: var(--text-3);
		letter-spacing: 0.08em;
	}

	.close {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--r-1);
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}
	.close:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.06);
	}

	.panel :global(.label) {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-3);
		flex: 1;
	}

	.panel :global(.btn) {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.85rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		border-radius: var(--r-2);
		border: 1px solid var(--line-strong);
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-2);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}
	.panel :global(.btn:hover:not(:disabled)) {
		color: var(--text);
		border-color: var(--text-3);
	}
	.panel :global(.btn:disabled) {
		opacity: 0.5;
		cursor: default;
	}
	.panel :global(.btn.use) {
		color: var(--ink);
		background: var(--mosh);
		border-color: var(--mosh);
	}
	.panel :global(.btn.use:hover:not(:disabled)) {
		filter: brightness(1.1);
	}
</style>
