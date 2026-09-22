<script lang="ts">
	import { tick } from "svelte";

	interface Props {
		name: string;
		title: string;
		/** Lit when the lane's own settings are open. */
		active?: boolean;
		/** Single click; absent on a lane whose name is only a label. */
		onclick?: () => void;
		onRename: (name: string) => void;
	}

	let { name, title, active = false, onclick, onRename }: Props = $props();

	let editing = $state(false);
	let draft = $state("");
	let input = $state<HTMLInputElement | null>(null);

	async function startEdit() {
		draft = name;
		editing = true;
		await tick();
		input?.select();
	}

	// Blank or unchanged keeps the old name; the row never ends up nameless.
	function commit() {
		if (!editing) return;
		editing = false;
		const next = draft.trim();
		if (next && next !== name) onRename(next);
	}

	function cancel() {
		editing = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			commit();
		} else if (e.key === "Escape") {
			e.preventDefault();
			cancel();
		}
	}
</script>

<!--
	The name every stacking lane shows in its gutter. Double-click edits in place;
	Enter or leaving keeps the new name, Escape drops it.
-->
{#if editing}
	<input
		bind:this={input}
		bind:value={draft}
		class="lane-name-input"
		type="text"
		maxlength="40"
		spellcheck="false"
		aria-label="Lane name"
		onkeydown={onKeydown}
		onblur={commit}
		onpointerdown={(e) => e.stopPropagation()}
	/>
{:else}
	<button
		class="lane-name"
		class:active
		title="{title} Double-click to rename."
		{onclick}
		ondblclick={(e) => {
			e.stopPropagation();
			startEdit();
		}}>{name}</button
	>
{/if}

<style>
	.lane-name,
	.lane-name-input {
		flex: 1;
		min-width: 0;
		font-family: inherit;
		font-size: 0.65rem;
		color: var(--text-3);
	}

	.lane-name {
		border: none;
		background: none;
		padding: 0;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lane-name:hover {
		color: var(--text);
	}

	.lane-name.active {
		color: var(--live);
	}

	.lane-name-input {
		width: 0;
		padding: 0 2px;
		border: 1px solid var(--live);
		border-radius: 2px;
		background: var(--surface);
		color: var(--text);
		outline: none;
	}
</style>
