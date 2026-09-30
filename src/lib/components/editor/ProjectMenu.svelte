<script lang="ts">
	import { ChevronDown, FolderDown } from "lucide-svelte";

	/** The editor's project menu: the project's name, and the ways to move it around. */
	interface Props {
		name: string;
		onSave: () => void;
	}

	let { name, onSave }: Props = $props();
	let open = $state(false);
</script>

<div class="project-menu">
	<button
		class="project-btn"
		title="Project"
		aria-haspopup="menu"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<span class="project-name">{name}</span>
		<ChevronDown size={12} />
	</button>
	{#if open}
		<!-- A full-screen catcher, so a click anywhere else closes the menu. -->
		<button
			class="backdrop"
			aria-label="Close menu"
			onclick={() => (open = false)}
		></button>
		<div class="menu" role="menu">
			<button
				class="menu-item"
				role="menuitem"
				onclick={() => {
					open = false;
					onSave();
				}}
			>
				<FolderDown size={13} />
				<span>Save project file</span>
			</button>
		</div>
	{/if}
</div>

<style>
	.project-menu {
		position: relative;
		flex-shrink: 0;
	}

	.project-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		max-width: 14rem;
		padding: 0.28rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		background: none;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.64rem;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
	}

	.project-btn:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}

	.project-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		padding: 0;
		border: none;
		background: none;
		cursor: default;
	}

	.menu {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 41;
		min-width: 12rem;
		padding: 0.25rem;
		background: var(--panel);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-2);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
	}

	.menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.4rem 0.5rem;
		border: none;
		border-radius: var(--r-1);
		background: none;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.68rem;
		text-align: left;
		cursor: pointer;
	}

	.menu-item:hover {
		background: var(--sunken);
		color: var(--text);
	}
</style>
