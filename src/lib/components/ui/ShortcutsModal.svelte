<script lang="ts">
	import { X } from 'lucide-svelte';

	interface ShortcutGroup {
		title: string;
		shortcuts: { keys: string[]; description: string }[];
	}

	interface Props {
		groups: ShortcutGroup[];
		onClose: () => void;
	}

	let { groups, onClose }: Props = $props();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="shortcuts-overlay" onclick={onClose}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="shortcuts-modal"
		style="--cols: {groups.length}"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="header">
			<span class="title">Keyboard shortcuts</span>
			<button class="close-btn" onclick={onClose} title="Close">
				<X size={14} />
			</button>
		</div>
		<div class="groups">
			{#each groups as group (group.title)}
				<div class="group">
					<span class="group-title">{group.title}</span>
					<ul class="shortcut-list">
						{#each group.shortcuts as shortcut (shortcut.description)}
							<li class="shortcut-row">
								<span class="description">{shortcut.description}</span>
								<span class="keys">
									{#each shortcut.keys as key, i (key)}
										{#if i > 0}<span class="key-sep">or</span>{/if}
										<kbd>{key}</kbd>
									{/each}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.shortcuts-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.shortcuts-modal {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		/* One column per group, so every group sits in a single row rather than
		   wrapping — sequence mode with the text timeline on has three. The floor
		   keeps a lone group from collapsing to a cramped 326px; max-width still
		   wins on small screens, where the grid falls back to wrapping. */
		width: max(
			420px,
			calc(var(--cols) * 286px + (var(--cols) - 1) * 1.75rem + 2.5rem)
		);
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		padding: 1.25rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.title {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--text-3);
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
	}

	.close-btn:hover {
		color: var(--text);
	}

	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 1rem 1.75rem;
		align-items: start;
	}

	.group-title {
		display: block;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		color: var(--text-3);
		text-transform: uppercase;
		margin-bottom: 0.4rem;
	}

	.shortcut-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
	}

	.shortcut-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--line);
	}

	.shortcut-row:last-child {
		border-bottom: none;
	}

	.keys {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.key-sep {
		font-size: 0.6rem;
		color: var(--text-3);
	}

	kbd {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 500;
		color: var(--text);
		background: var(--raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		padding: 0.15rem 0.4rem;
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.6);
	}

	.description {
		font-size: 0.75rem;
		color: var(--text-2);
		text-align: left;
	}
</style>
