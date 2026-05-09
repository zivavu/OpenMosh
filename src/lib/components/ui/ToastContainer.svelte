<script lang="ts">
	import { getToasts, dismissToast } from './toast';

	const toasts = getToasts();
</script>

<div class="toast-container" role="status" aria-live="polite" aria-atomic="true">
	{#each toasts as toast (toast.id)}
		<div
			class="toast"
			class:error={toast.type === 'error'}
			class:info={toast.type === 'info'}
		>
			<span class="message">{toast.message}</span>
			<button
				class="close"
				onclick={() => dismissToast(toast.id)}
				aria-label="Dismiss notification"
			>
				&#x2715;
			</button>
		</div>
	{/each}
</div>

<style>
	.toast-container {
		position: fixed;
		top: 1rem;
		right: 1rem;
		z-index: 9999;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		pointer-events: none;
	}

	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-radius: 6px;
		background: rgba(30, 30, 30, 0.95);
		border: 1px solid #333;
		color: #ccc;
		font-size: 0.85rem;
		max-width: 320px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		animation: slideIn 0.2s ease;
	}

	.toast.error {
		border-color: rgba(192, 80, 80, 0.5);
		color: #ff9999;
	}

	.message {
		flex: 1;
		line-height: 1.4;
	}

	.close {
		background: none;
		border: none;
		color: #888;
		cursor: pointer;
		font-size: 0.75rem;
		padding: 0.2rem;
		line-height: 1;
	}

	.close:hover {
		color: #fff;
	}

	@keyframes slideIn {
		from {
			transform: translateX(100%);
			opacity: 0;
		}
		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
</style>
