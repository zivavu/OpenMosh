<script lang="ts">
	import { onDestroy } from 'svelte';
	import NumberField from './NumberField.svelte';

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
	<NumberField
		{id}
		value={bpm}
		min={MIN_BPM}
		max={MAX_BPM}
		step={1}
		fineStep={0.5}
		emptyValue={DEFAULT_BPM}
		unit="BPM"
		upTitle="Faster (shift for half a beat)"
		downTitle="Slower (shift for half a beat)"
		onChange={onBpmChange}
	/>
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
