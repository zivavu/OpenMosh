<script lang="ts">
	import { onMount } from "svelte";

	interface Props {
		value: string;
		label: string;
		/** Styled by the row it sits in: the field inherits font and colour. */
		class?: string;
		onRename: (name: string) => void;
		/** Fired once, however the edit ends, so the row can swap the label back. */
		onDone: () => void;
	}

	let { value, label, class: klass = "", onRename, onDone }: Props = $props();

	// The starting text only; the field owns it from here.
	// svelte-ignore state_referenced_locally
	let draft = $state(value);
	let input = $state<HTMLInputElement | null>(null);
	let done = false;

	onMount(() => input?.select());

	// Blank or unchanged keeps the old name; a row never ends up nameless.
	function commit() {
		if (done) return;
		done = true;
		const next = draft.trim();
		if (next && next !== value) onRename(next);
		onDone();
	}

	function cancel() {
		if (done) return;
		done = true;
		onDone();
	}

	function onKeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === "Enter") {
			e.preventDefault();
			commit();
		} else if (e.key === "Escape") {
			e.preventDefault();
			cancel();
		}
	}
</script>

<!-- A name turned into a field in place. Enter or leaving keeps it, Escape drops it. -->
<input
	bind:this={input}
	bind:value={draft}
	class="rename-input {klass}"
	type="text"
	maxlength="80"
	spellcheck="false"
	aria-label={label}
	onkeydown={onKeydown}
	onblur={commit}
	onclick={(e) => e.stopPropagation()}
	onpointerdown={(e) => e.stopPropagation()}
/>

<style>
	.rename-input {
		flex: 1;
		min-width: 0;
		width: 0;
		padding: 0 3px;
		border: 1px solid var(--mosh, var(--live));
		border-radius: 2px;
		background: var(--surface);
		color: var(--text);
		font-family: inherit;
		font-size: inherit;
		line-height: 1.4;
		outline: none;
	}
</style>
