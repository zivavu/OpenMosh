<script lang="ts">
	interface Props {
		title: string;
		message: string;
		/** Shown under the message so a bug report can quote it. */
		detail?: string;
	}

	let { title, message, detail }: Props = $props();
</script>

<div class="app-error" role="alert">
	<div class="panel">
		<span class="title">{title}</span>
		<p class="message">{message}</p>
		{#if detail}
			<pre class="detail">{detail}</pre>
		{/if}
		<div class="actions">
			<a class="btn" href="/">Back to start</a>
			<button class="btn primary" onclick={() => location.reload()}>
				Reload
			</button>
		</div>
	</div>
</div>

<style>
	.app-error {
		position: fixed;
		inset: 0;
		z-index: 400;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--ink);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		width: 420px;
		max-width: calc(100vw - 2rem);
		padding: 1.25rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
	}

	.title {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.message {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-2);
	}

	.detail {
		margin: 0;
		max-height: 8rem;
		overflow: auto;
		padding: 0.5rem 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		line-height: 1.5;
		color: var(--text-3);
		white-space: pre-wrap;
		word-break: break-word;
		background: var(--sunken);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.4rem;
	}

	.btn {
		padding: 0.35rem 0.8rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-decoration: none;
		border-radius: var(--r-2);
		border: 1px solid var(--line-strong);
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-2);
		cursor: pointer;
		transition:
			background var(--t-fast),
			color var(--t-fast);
	}

	.btn:hover {
		background: rgba(255, 255, 255, 0.09);
		color: var(--text);
	}

	.btn:focus-visible {
		outline: 1px solid var(--text-4);
		outline-offset: 2px;
	}

	.primary {
		background: rgba(255, 255, 255, 0.07);
		color: var(--text);
	}
</style>
