<script lang="ts">
	import { X, Github } from 'lucide-svelte';
	import ButtonGroup from './ButtonGroup.svelte';
	import { closeFeedback } from './feedback.svelte';
	import { showToast } from './toast.svelte';
	import { submitFeedback, type FeedbackKind } from '../../feedback/submit';

	let kind: FeedbackKind = $state('bug');
	let message = $state('');
	let email = $state('');
	let botcheck = $state('');
	let sending = $state(false);
	let error: string | null = $state(null);

	const PLACEHOLDERS: Record<FeedbackKind, string> = {
		bug: 'What happened, and what were you doing when it did?',
		idea: 'What would you like OpenMosh to do?',
		other: 'Anything you want to tell me.',
	};

	async function send() {
		if (!message.trim() || sending) return;
		sending = true;
		error = null;
		try {
			await submitFeedback({ kind, message: message.trim(), email: email.trim(), botcheck });
			showToast('Thanks — feedback sent.');
			closeFeedback();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong sending that.';
		} finally {
			sending = false;
		}
	}

	/** The editors bind their shortcuts on window, so every key pressed in here
	 * has to stop before it gets there — Escape included, which we handle. */
	function onKeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') {
			closeFeedback();
		} else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void send();
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="feedback-overlay" onclick={closeFeedback} onkeydown={onKeydown}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="feedback-modal" onclick={(e) => e.stopPropagation()}>
		<div class="header">
			<span class="title">Send feedback</span>
			<button class="close-btn" onclick={closeFeedback} title="Close">
				<X size={14} />
			</button>
		</div>

		<ButtonGroup
			buttons={[
				{ label: 'Bug', value: 'bug' },
				{ label: 'Idea', value: 'idea' },
				{ label: 'Other', value: 'other' },
			]}
			value={kind}
			onchange={(v: FeedbackKind) => (kind = v)}
		/>

		<!-- svelte-ignore a11y_autofocus -->
		<textarea
			class="message-input"
			placeholder={PLACEHOLDERS[kind]}
			autofocus
			bind:value={message}
		></textarea>

		<input
			class="email-input"
			type="email"
			placeholder="Your email (optional, only so I can reply)"
			bind:value={email}
		/>

		<!-- Honeypot: off-screen and tab-skipped, so only bots ever fill it. -->
		<input
			class="botcheck"
			type="text"
			tabindex="-1"
			autocomplete="off"
			aria-hidden="true"
			bind:value={botcheck}
		/>

		{#if error}
			<p class="error">{error}</p>
		{:else}
			<p class="hint">
				Your browser, screen size and current effect chain are attached, so
				bugs can be reproduced exactly.
			</p>
		{/if}

		<div class="actions">
			<a
				class="ghost"
				href="https://github.com/zivavu/OpenMosh/issues/new"
				target="_blank"
				rel="noopener noreferrer"
			>
				<Github size={12} />
				Open an issue instead
			</a>
			<div class="spacer"></div>
			<button class="ghost" onclick={closeFeedback}>Cancel</button>
			<button class="primary" disabled={!message.trim() || sending} onclick={send}>
				{sending ? 'Sending…' : 'Send'}
			</button>
		</div>
	</div>
</div>

<style>
	.feedback-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.feedback-modal {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 460px;
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		padding: 1.25rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.title {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--text-3);
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
	}

	.close-btn:hover {
		color: var(--text);
	}

	.message-input,
	.email-input {
		padding: 0.5rem;
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		background: var(--ink);
		color: var(--text);
		font-size: 0.85rem;
		font-family: inherit;
		line-height: 1.5;
	}

	.message-input {
		min-height: 150px;
		resize: vertical;
	}

	.email-input {
		font-size: 0.78rem;
	}

	.message-input:focus,
	.email-input:focus {
		border-color: var(--live-dim);
		outline: none;
	}

	.botcheck {
		position: absolute;
		left: -9999px;
		opacity: 0;
		height: 0;
		width: 0;
	}

	.hint,
	.error {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.35;
	}

	.hint {
		color: var(--text-3);
	}

	.error {
		color: var(--rec);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.spacer {
		flex: 1;
	}

	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		background: var(--surface);
		color: var(--text-2);
		font-size: 0.72rem;
		font-family: inherit;
		cursor: pointer;
	}

	.ghost:hover {
		border-color: var(--text-4);
		color: var(--text);
	}

	.primary {
		padding: 0.35rem 0.8rem;
		border: 1px solid var(--live-dim);
		border-radius: var(--r-2);
		background: var(--live-dim);
		color: var(--text);
		font-size: 0.75rem;
		font-family: inherit;
		cursor: pointer;
	}

	.primary:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
