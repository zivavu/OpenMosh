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
				{recordFinalizing ? 'Creating file…' : 'Recording WEBM...'}
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
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
	}

	.record-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #ddd;
		letter-spacing: 0.04em;
	}

	.progress-track {
		width: 200px;
		height: 4px;
		background: #333;
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: #c05050;
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
		font-size: 0.75rem;
		color: #999;
		font-variant-numeric: tabular-nums;
	}

	.rec-cancel-btn {
		padding: 0.35rem 1.2rem;
		border: 1px solid #444;
		border-radius: 6px;
		background: none;
		color: #999;
		font-size: 0.7rem;
		font-family: inherit;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.rec-cancel-btn:hover {
		color: #ddd;
		border-color: #666;
	}
</style>
