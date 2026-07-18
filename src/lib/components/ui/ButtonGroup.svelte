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
		background: rgba(30, 30, 30, 0.85);
		border: 1px solid #333;
		border-radius: 6px;
		overflow: hidden;
	}

	.btn {
		padding: 0.35rem 0.9rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		font-family: inherit;
		background: none;
		border: none;
		border-right: 1px solid #333;
		color: #777;
		cursor: pointer;
		width: 100%;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.btn:last-child {
		border-right: none;
	}

	.btn.active {
		color: #ddd;
		background: rgba(255, 255, 255, 0.06);
	}

	.btn:hover {
		color: #ccc;
	}
</style>
