<script lang="ts">
	import { modalDialog } from "../../actions/modal-dialog";
	import type { LoadLosses } from "../../effects/load-report";

	interface Props {
		losses: LoadLosses;
		onClose: () => void;
	}

	let { losses, onClose }: Props = $props();

	let closeBtnEl = $state<HTMLButtonElement | undefined>(undefined);

	$effect(() => {
		closeBtnEl?.focus();
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="overlay" onclick={onClose}>
	<div
		class="dialog"
		{@attach modalDialog()}
		role="alertdialog"
		aria-modal="true"
		aria-label="Not everything loaded"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
	>
		<span class="title">Not everything loaded</span>
		{#if losses.effects.length > 0}
			<section>
				<p>
					{losses.effects.length === 1
						? "This version of OpenMosh doesn't have this effect, so it was left out:"
						: "This version of OpenMosh doesn't have these effects, so they were left out:"}
				</p>
				<ul>
					{#each losses.effects as name (name)}
						<li>{name}</li>
					{/each}
				</ul>
			</section>
		{/if}
		{#if losses.settings.length > 0}
			<section>
				<p>
					{losses.settings.length === 1
						? "This setting was out of range for its effect, so it was changed to fit:"
						: "These settings were out of range for their effect, so they were changed to fit:"}
				</p>
				<ul>
					{#each losses.settings as setting (setting)}
						<li>{setting}</li>
					{/each}
				</ul>
			</section>
		{/if}
		<div class="actions">
			<button bind:this={closeBtnEl} class="btn" onclick={onClose}>OK</button>
		</div>
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

	.dialog {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 380px;
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		padding: 1.25rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
	}

	.title {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	p {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-2);
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		padding: 0.1rem 0.4rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		color: var(--text);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
	}

	.btn {
		padding: 0.35rem 0.8rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		border-radius: var(--r-2);
		border: 1px solid var(--line-strong);
		background: rgba(255, 255, 255, 0.07);
		color: var(--text);
		cursor: pointer;
		transition: background var(--t-fast);
	}

	.btn:hover {
		background: rgba(255, 255, 255, 0.12);
	}

	.btn:focus-visible {
		outline: 1px solid var(--text-4);
		outline-offset: 2px;
	}
</style>
