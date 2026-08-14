<script lang="ts">
	interface Props {
		recording: boolean;
		recordProgress: number;
		recordFinalizing: boolean;
		onCancel: () => void;
	}

	let { recording, recordProgress, recordFinalizing, onCancel }: Props = $props();
</script>

{#if recording}
	<div class="record-overlay">
		<div class="record-modal">
			<p class="record-title">
				<span class="tally" class:steady={recordFinalizing}></span>
				{recordFinalizing ? 'Writing file' : 'Recording'}
			</p>
			<div class="progress-track" class:finalizing={recordFinalizing}>
				<div
					class="progress-fill"
					style="width: {recordFinalizing ? '100%' : `${Math.round(recordProgress * 100)}%`}"
				></div>
			</div>
			{#if !recordFinalizing}
				<p class="record-pct">{Math.round(recordProgress * 100)}%</p>
			{/if}
			<button class="rec-cancel-btn" onclick={onCancel}>Cancel</button>
		</div>
	</div>
{/if}

<style>
	.record-overlay {
		position: absolute;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.record-modal {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 3rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
	}

	.record-title {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--text);
		letter-spacing: 0.18em;
		text-transform: uppercase;
	}

	/* Tally light: blinks while frames are being captured, steady while writing. */
	.tally {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--rec);
		box-shadow: 0 0 10px rgba(255, 95, 86, 0.9);
		animation: tally-blink 1s steps(1, end) infinite;
	}

	.tally.steady {
		animation: none;
	}

	@keyframes tally-blink {
		0%,
		50% {
			opacity: 1;
		}
		51%,
		100% {
			opacity: 0.25;
		}
	}

	.progress-track {
		width: 200px;
		height: 4px;
		background: rgba(255, 255, 255, 0.07);
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: var(--rec);
		border-radius: 2px;
		transition: width 0.15s;
	}

	.progress-track.finalizing .progress-fill {
		animation: record-finalize-pulse 1.2s ease-in-out infinite;
	}

	@keyframes record-finalize-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.65;
		}
	}

	.record-pct {
		font-family: var(--font-mono);
		font-size: 0.72rem;
		color: var(--text-2);
		font-variant-numeric: tabular-nums;
	}

	.rec-cancel-btn {
		padding: 0.35rem 1.2rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-2);
		background: none;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.rec-cancel-btn:hover {
		color: var(--text);
		border-color: var(--text-4);
	}
</style>
