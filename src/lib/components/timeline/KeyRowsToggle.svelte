<script lang="ts">
	import { Diamond } from "lucide-svelte";

	/** A lane's switch for the rows of its animated settings. */
	interface Props {
		open: boolean;
		onToggle: () => void;
	}

	let { open, onToggle }: Props = $props();
</script>

<button
	type="button"
	class="key-rows-toggle"
	class:on={open}
	aria-pressed={open}
	title={open
		? "Hide the animated settings' rows"
		: "Show each animated setting in its own row"}
	onclick={onToggle}
>
	<Diamond size={11} />
</button>

<style>
	.key-rows-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.15rem;
		background: none;
		border: none;
		border-radius: var(--r-1);
		color: var(--text-3);
		cursor: pointer;
	}

	.key-rows-toggle:hover {
		color: var(--text);
	}

	.key-rows-toggle.on {
		color: var(--live);
	}

	.key-rows-toggle.on :global(svg) {
		fill: currentColor;
	}
</style>
