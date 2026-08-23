<script lang="ts">
	import { MessageSquare } from 'lucide-svelte';
	import { openFeedback } from './feedback.svelte';
</script>

<button
	class="feedback-btn"
	onclick={openFeedback}
	title="Send feedback"
	aria-label="Send feedback"
>
	<MessageSquare size={14} />
</button>

<style>
	/* Sits beside the GitHub link in every top bar, so it borrows its shape. */
	.feedback-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 50%;
		background: rgba(18, 18, 18, 0.85);
		border: 1.5px solid var(--line-strong);
		color: var(--text-3);
		flex-shrink: 0;
		box-sizing: border-box;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.feedback-btn:hover {
		border-color: var(--text-3);
		color: var(--text);
	}
</style>
