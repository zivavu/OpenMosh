<script lang="ts">
	import {
		formatField,
		parseField,
		stepField,
		type FieldDisplay,
	} from "../../value-field";

	/** A slider's value as a typed number. It commits on Enter or blur, so a half-typed
	 * number never reaches the picture and one entry is one undo step. */
	interface Props {
		id?: string;
		value: number;
		min: number;
		max: number;
		step: number;
		display?: FieldDisplay;
		disabled?: boolean;
		label?: string;
		onCommit: (value: number) => void;
	}

	let { id, value, min, max, step, display, disabled, label, onCommit }: Props =
		$props();

	const range = $derived({ min, max, step, display });
	let draft = $state<string | null>(null);

	function commit() {
		if (draft === null) return;
		const next = parseField(draft, range);
		draft = null;
		if (next !== null && next !== value) onCommit(next);
	}

	function onkeydown(e: KeyboardEvent & { currentTarget: HTMLInputElement }) {
		if (e.key === "Enter") {
			commit();
			e.currentTarget.blur();
		} else if (e.key === "Escape") {
			e.stopPropagation();
			draft = null;
			e.currentTarget.blur();
		} else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
			e.preventDefault();
			const from = draft === null ? value : (parseField(draft, range) ?? value);
			draft = null;
			const direction = e.key === "ArrowUp" ? 1 : -1;
			const next = stepField(from, direction, e.shiftKey, range);
			if (next !== value) onCommit(next);
		}
	}
</script>

<span class="value-field" class:disabled>
	<input
		{id}
		type="number"
		step="any"
		{disabled}
		aria-label={label}
		value={draft ?? formatField(value, display)}
		oninput={(e) => (draft = e.currentTarget.value)}
		onblur={commit}
		{onkeydown}
		ondblclick={(e) => e.stopPropagation()}
	/>
	{#if display?.unit}<span class="unit">{display.unit}</span>{/if}
</span>

<style>
	.value-field {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		margin-left: auto;
		padding: 0 0.35rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		background: var(--sunken);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		transition: border-color var(--t-fast);
	}

	.value-field:hover:not(.disabled) {
		border-color: var(--text-3);
	}

	.value-field:focus-within {
		border-color: var(--live);
	}

	.value-field.disabled {
		opacity: 0.45;
	}

	input {
		flex: 1 1 6ch;
		width: 6ch;
		min-width: 0;
		padding: 0.1rem 0;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font: inherit;
		text-align: right;
		appearance: textfield;
		-moz-appearance: textfield;
	}

	input::-webkit-inner-spin-button,
	input::-webkit-outer-spin-button {
		appearance: none;
		-webkit-appearance: none;
		margin: 0;
	}

	.unit {
		color: var(--text-2);
	}
</style>
