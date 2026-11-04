<script lang="ts" generics="T extends string">
	interface Props {
		buttons: { label: string; value: T }[];
		/** A list lights every button in it, for a group that picks several. */
		value: T | T[];
		onchange: (value: T) => void;
	}

	let { buttons, value, onchange }: Props = $props();

	const isActive = (option: T) =>
		Array.isArray(value) ? value.includes(option) : value === option;
</script>

<div class="btn-group">
	{#each buttons as btn}
		<button
			class="option"
			class:active={isActive(btn.value)}
			aria-pressed={isActive(btn.value)}
			onclick={() => onchange(btn.value)}
		>
			{btn.label}
		</button>
	{/each}
</div>

<style>
	.btn-group {
		display: flex;
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		overflow: hidden;
	}

	/* Not `.btn`: PanelModal styles every `.btn` inside it, which boxed each
	 * option in its own border and hid which one was active. */
	.option {
		padding: 0.3rem 0.85rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		background: none;
		border: none;
		border-right: 1px solid var(--line);
		color: var(--text-2);
		cursor: pointer;
		width: 100%;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.option:last-child {
		border-right: none;
	}

	.option.active {
		color: var(--text);
		background: rgba(255, 255, 255, 0.07);
	}

	.option:hover:not(.active) {
		color: var(--text);
	}
</style>
