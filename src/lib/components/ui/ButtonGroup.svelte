<script lang="ts" generics="T extends string">
	interface Props {
		buttons: { label: string; value: T }[];
		value: T;
		onchange: (value: T) => void;
	}

	let { buttons, value, onchange }: Props = $props();
</script>

<div class="btn-group">
	{#each buttons as btn}
		<button
			class="btn"
			class:active={value === btn.value}
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

	.btn {
		padding: 0.3rem 0.85rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		background: none;
		border: none;
		border-right: 1px solid var(--line);
		color: var(--text-3);
		cursor: pointer;
		width: 100%;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.btn:last-child {
		border-right: none;
	}

	.btn.active {
		color: var(--text);
		background: rgba(255, 255, 255, 0.07);
	}

	.btn:hover {
		color: var(--text-2);
	}
</style>
