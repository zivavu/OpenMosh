<script lang="ts">
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
	<button
		class="detect-btn"
		onclick={onDetectBpm}
		disabled={bpmDetecting || !hasTrack || !onDetectBpm}
	>
		{bpmDetecting ? 'Detecting...' : 'Detect'}
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
		min-width: 80px;
		color: #999;
		font-size: 0.75rem;
	}

	.config-row input[type='number'] {
		width: 64px;
		padding: 0.2rem 0.4rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #1a1a1a;
		color: #e0e0e0;
		font-size: 0.78rem;
		font-family: inherit;
	}

	.detect-btn {
		padding: 0.15rem 0.6rem;
		border: 1px solid #444;
		border-radius: 4px;
		background: transparent;
		color: #ccc;
		font-size: 0.7rem;
		cursor: pointer;
		font-family: inherit;
		white-space: nowrap;
	}

	.detect-btn:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
	}

	.detect-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
