<script lang="ts">
	import { ChevronDown, ChevronUp } from 'lucide-svelte';
	import { onDestroy } from 'svelte';

	interface Props {
		bpm: number;
		onBpmChange: (bpm: number) => void;
		bpmDetecting?: boolean;
		/** Detection needs audio to analyse; without it the button is disabled. */
		hasTrack?: boolean;
		onDetectBpm?: () => void;
		/** Field id, so each host can keep its label association unique. */
		id?: string;
	}

	let {
		bpm,
		onBpmChange,
		bpmDetecting = false,
		hasTrack = false,
		onDetectBpm,
		id = 'bpm',
	}: Props = $props();

	const MIN_BPM = 20;
	const MAX_BPM = 300;
	/** Where the steppers start from when no tempo has been set yet. */
	const DEFAULT_BPM = 120;

	/** Whole beats by default; shift lands on the halves the field allows. */
	function step(direction: 1 | -1, fine: boolean) {
		if (bpm <= 0) {
			onBpmChange(DEFAULT_BPM);
			return;
		}
		const next = bpm + direction * (fine ? 0.5 : 1);
		onBpmChange(Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(next * 2) / 2)));
	}

	// Tap BPM state
	let tapTimes: number[] = $state([]);
	let tapResetTimer: ReturnType<typeof setTimeout> | null = null;
	const TAP_RESET_MS = 2000;

	onDestroy(() => {
		if (tapResetTimer) clearTimeout(tapResetTimer);
	});

	function handleTap() {
		const now = performance.now();
		if (tapResetTimer) clearTimeout(tapResetTimer);
		tapResetTimer = setTimeout(() => {
			tapTimes = [];
		}, TAP_RESET_MS);

		tapTimes = [...tapTimes, now];
		if (tapTimes.length < 2) return;

		// Keep last 8 taps for a stable average
		if (tapTimes.length > 8) tapTimes = tapTimes.slice(-8);

		const intervals: number[] = [];
		for (let i = 1; i < tapTimes.length; i++) {
			intervals.push(tapTimes[i] - tapTimes[i - 1]);
		}
		const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
		const tapped = Math.round((60000 / avgMs) * 2) / 2; // round to nearest 0.5
		onBpmChange(Math.min(MAX_BPM, Math.max(MIN_BPM, tapped)));
	}
</script>

<div class="config-row">
	<label for={id}>BPM</label>
	<div class="bpm-field">
		<input
			{id}
			type="number"
			min={MIN_BPM}
			max={MAX_BPM}
			step="0.5"
			placeholder="—"
			value={bpm > 0 ? bpm : ''}
			oninput={(e) => onBpmChange(+(e.currentTarget as HTMLInputElement).value)}
		/>
		<div class="stepper">
			<button
				class="step-btn"
				type="button"
				disabled={bpm >= MAX_BPM}
				onclick={(e) => step(1, e.shiftKey)}
				title="Faster (shift for half a beat)"
				aria-label="Increase BPM"
			>
				<ChevronUp size={11} />
			</button>
			<button
				class="step-btn"
				type="button"
				disabled={bpm > 0 && bpm <= MIN_BPM}
				onclick={(e) => step(-1, e.shiftKey)}
				title="Slower (shift for half a beat)"
				aria-label="Decrease BPM"
			>
				<ChevronDown size={11} />
			</button>
		</div>
	</div>
	<button
		class="detect-btn detect-auto"
		class:detecting={bpmDetecting}
		onclick={onDetectBpm}
		disabled={bpmDetecting || !hasTrack || !onDetectBpm}
	>
		{#if bpmDetecting}
			<span class="detect-lamp"></span>
			Detecting
		{:else}
			Detect
		{/if}
	</button>
	<button class="detect-btn" onclick={handleTap}>
		Tap{tapTimes.length >= 2 ? ` (${tapTimes.length})` : ''}
	</button>
</div>

<style>
	.config-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
	}

	.config-row label {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 500;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	/* Reads as an instrument display: the tempo is a number you check at a
	   glance, so it sits in a sunken well in tabular mono. */
	.config-row input[type='number'] {
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

	.config-row input[type='number']:hover {
		border-color: var(--line-strong);
	}

	.config-row input[type='number']:focus {
		border-color: var(--live-dim);
		box-shadow: 0 0 0 2px rgba(110, 231, 192, 0.12);
	}

	.config-row input[type='number']::placeholder {
		color: var(--text-4);
	}

	.config-row input[type='number']::-webkit-inner-spin-button,
	.config-row input[type='number']::-webkit-outer-spin-button {
		appearance: none;
		-webkit-appearance: none;
		margin: 0;
	}

	.bpm-field {
		display: flex;
		align-items: stretch;
		gap: 0.2rem;
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

	.detect-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		padding: 0.25rem 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: transparent;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		white-space: nowrap;
		transition:
			border-color var(--t-fast),
			color var(--t-fast),
			background var(--t-fast);
	}

	.detect-btn:hover:not(:disabled) {
		border-color: var(--text-3);
		color: var(--text);
	}

	.detect-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* Wide enough for "Detecting" and its lamp in every state: the settings panel
	   is shrink-to-fit, so a button that grows mid-run drags the whole sidebar
	   wider with it. */
	.detect-auto {
		min-width: 94px;
	}

	/* Live work in progress, so it reads with the same green as everything else
	   that is running — and keeps full contrast despite being disabled. */
	.detect-btn.detecting,
	.detect-btn.detecting:disabled {
		opacity: 1;
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.1);
		color: var(--live);
	}

	.detect-lamp {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--live);
		box-shadow: 0 0 6px rgba(110, 231, 192, 0.8);
		animation: detect-pulse 1s ease-in-out infinite;
	}

	@keyframes detect-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.25;
		}
	}
</style>
