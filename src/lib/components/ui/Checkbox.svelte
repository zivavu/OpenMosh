<script lang="ts">
	import type { HTMLInputAttributes } from "svelte/elements";

	/* The app's tick: off is a dim pip in a raised frame, on lights it in --live.
	   The native input sits invisibly over the box, so labels, focus and keyboard stay native. */
	interface Props extends Omit<
		HTMLInputAttributes,
		"type" | "checked" | "size"
	> {
		checked?: boolean;
		indeterminate?: boolean;
	}

	let {
		checked = $bindable(false),
		indeterminate = false,
		disabled = false,
		...rest
	}: Props = $props();
</script>

<span class="cb" class:disabled>
	<input type="checkbox" bind:checked {indeterminate} {disabled} {...rest} />
	<span class="box" aria-hidden="true">
		<span class="pip"></span>
		<svg class="tick" viewBox="0 0 12 12">
			<path d="M2.5 6.2l2.4 2.4 4.6-5" pathLength="1" />
		</svg>
		<span class="dash"></span>
	</span>
</span>

<style>
	.cb {
		position: relative;
		display: inline-flex;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		vertical-align: middle;
	}

	input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.disabled input {
		cursor: default;
	}

	.box {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		background: var(--raised);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
		pointer-events: none;
		transition:
			border-color var(--t-fast),
			background var(--t-fast),
			box-shadow var(--t-fast);
	}

	.pip,
	.tick,
	.dash {
		grid-area: 1 / 1;
		transition:
			opacity var(--t-fast),
			transform var(--t-fast),
			background var(--t-fast);
	}

	.pip {
		width: 4px;
		height: 4px;
		border-radius: 1px;
		background: var(--text-4);
	}

	.tick {
		width: 12px;
		height: 12px;
		overflow: visible;
		fill: none;
		stroke: var(--live);
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
		opacity: 0;
	}

	.tick path {
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		transition: stroke-dashoffset var(--t);
	}

	.dash {
		width: 7px;
		height: 2px;
		border-radius: 1px;
		background: var(--live);
		opacity: 0;
		transform: scaleX(0.4);
	}

	input:hover + .box {
		border-color: var(--text-3);
	}

	input:hover + .box .pip {
		background: var(--text-3);
	}

	input:focus-visible + .box {
		outline: 1.5px solid var(--live);
		outline-offset: 2px;
	}

	input:checked + .box,
	input:indeterminate + .box {
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.12);
		box-shadow:
			inset 0 1px 0 rgba(110, 231, 192, 0.08),
			0 0 8px rgba(110, 231, 192, 0.14);
	}

	input:checked + .box .pip,
	input:indeterminate + .box .pip {
		opacity: 0;
		transform: scale(0.4);
	}

	input:checked + .box .tick {
		opacity: 1;
	}

	input:checked + .box .tick path {
		stroke-dashoffset: 0;
	}

	input:indeterminate + .box .tick {
		opacity: 0;
	}

	input:indeterminate + .box .dash {
		opacity: 1;
		transform: scaleX(1);
	}

	.disabled .box {
		opacity: 0.45;
	}
</style>
