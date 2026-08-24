<script lang="ts">
	import { ChevronDown, ChevronUp } from 'lucide-svelte';

	interface Props {
		id?: string;
		/** The current number. Anything <= 0 reads as empty and shows the placeholder. */
		value: number;
		min: number;
		max: number;
		/** What one click of a stepper moves. */
		step?: number;
		/** What shift+click moves instead, when the field wants a finer grid. */
		fineStep?: number;
		placeholder?: string;
		/** Where the steppers start from when the field is empty. */
		emptyValue?: number;
		/** False when the host has no meaning for "unset" and needs a number. */
		allowEmpty?: boolean;
		/** Names the thing in the steppers' aria labels, e.g. `BPM`. */
		unit?: string;
		upTitle?: string;
		downTitle?: string;
		onChange: (value: number) => void;
	}

	let {
		id,
		value,
		min,
		max,
		step = 1,
		fineStep,
		placeholder = '—',
		emptyValue,
		allowEmpty = true,
		unit = 'value',
		upTitle,
		downTitle,
		onChange,
	}: Props = $props();

	let inputEl: HTMLInputElement | null = $state(null);

	/** Snaps to the finest grid the field allows, so a click can't leave a
	    number the field itself would reject. */
	function quantize(n: number): number {
		const grid = fineStep ?? step;
		// Rounded again: a grid of 0.1 lands on 0.30000000000000004 otherwise.
		return Math.round(Math.round(n / grid) * grid * 1e4) / 1e4;
	}

	function nudge(direction: 1 | -1, fine: boolean) {
		if (value <= 0) {
			onChange(emptyValue ?? min);
			return;
		}
		const next = value + direction * (fine && fineStep ? fineStep : step);
		onChange(Math.min(max, Math.max(min, quantize(next))));
	}
</script>

<div class="number-field">
	<input
		bind:this={inputEl}
		{id}
		{placeholder}
		type="number"
		{min}
		{max}
		step={fineStep ?? step}
		value={value > 0 ? value : ''}
		oninput={(e) => {
			const raw = (e.currentTarget as HTMLInputElement).value;
			// Only the ceiling is enforced while typing: clamping up to `min`
			// would fight the first digit of a bigger number.
			onChange(raw === '' ? 0 : Math.min(max, +raw));
		}}
		onblur={() => {
			// Whatever half-typed text is in the field, leaving it shows the
			// number the rest of the app is actually using.
			const next = value > 0 ? Math.max(min, value) : allowEmpty ? 0 : min;
			if (next !== value) onChange(next);
			if (inputEl) inputEl.value = next > 0 ? String(next) : '';
		}}
	/>
	<div class="stepper">
		<button
			class="step-btn"
			type="button"
			disabled={value >= max}
			onclick={(e) => nudge(1, e.shiftKey)}
			title={upTitle}
			aria-label="Increase {unit}"
		>
			<ChevronUp size={11} />
		</button>
		<button
			class="step-btn"
			type="button"
			disabled={value > 0 && value <= min}
			onclick={(e) => nudge(-1, e.shiftKey)}
			title={downTitle}
			aria-label="Decrease {unit}"
		>
			<ChevronDown size={11} />
		</button>
	</div>
</div>

<style>
	.number-field {
		display: flex;
		align-items: stretch;
		gap: 0.2rem;
	}

	/* Reads as an instrument display: a number you check at a glance, so it sits
	   in a sunken well in tabular mono. */
	.number-field input[type='number'] {
		width: 62px;
		padding: 0.25rem 0.45rem;
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		background: var(--sunken);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 0.82rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		text-align: center;
		outline: none;
		/* The custom stepper replaces the native spinners, which differ per
		   browser and never match the panel. */
		appearance: textfield;
		-moz-appearance: textfield;
		transition:
			border-color var(--t-fast),
			box-shadow var(--t-fast);
	}

	.number-field input[type='number']:hover {
		border-color: var(--line-strong);
	}

	.number-field input[type='number']:focus {
		border-color: var(--live-dim);
		box-shadow: 0 0 0 2px rgba(110, 231, 192, 0.12);
	}

	.number-field input[type='number']::placeholder {
		color: var(--text-4);
	}

	.number-field input[type='number']::-webkit-inner-spin-button,
	.number-field input[type='number']::-webkit-outer-spin-button {
		appearance: none;
		-webkit-appearance: none;
		margin: 0;
	}

	/* Stacked, so the pair costs one control's width — same as the effect rows. */
	.stepper {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.step-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		flex: 1;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		background: var(--sunken);
		color: var(--text-3);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}

	.step-btn:hover:not(:disabled) {
		color: var(--live);
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.1);
	}

	.step-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
</style>
