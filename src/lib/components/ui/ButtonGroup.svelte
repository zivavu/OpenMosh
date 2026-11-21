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
	/* Dressed like the bar's other buttons; the pick lights up like a pill. */
	.btn-group {
		display: flex;
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		overflow: hidden;
		transition: border-color var(--t-fast);
	}

	.btn-group:hover {
		border-color: var(--line-hover);
	}

	/* Not `.btn`: PanelModal styles every `.btn` inside it, which boxed each
	 * option in its own border and hid which one was active. */
	.option {
		padding: 0.28rem 0.8rem;
		font-family: var(--font-mono);
		font-size: 0.64rem;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		background: none;
		border: none;
		border-right: 1px solid var(--line-strong);
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
		color: var(--live);
		background: rgba(110, 231, 192, 0.12);
	}

	.option:hover:not(.active) {
		color: var(--text);
		background: rgba(255, 255, 255, 0.06);
	}
</style>
