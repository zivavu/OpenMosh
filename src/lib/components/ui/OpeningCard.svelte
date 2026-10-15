<script lang="ts">
	import type { ProjectOpening } from "../../project-file/import";

	let { opening }: { opening: ProjectOpening } = $props();

	const STAGE_TEXT: Record<ProjectOpening["stage"], string> = {
		checking: "Checking the file",
		storing: "Copying media into this browser",
		opening: "Loading the media",
	};

	let determinate = $derived(opening.stage === "checking");
</script>

<div class="opening-overlay" class:quiet={opening.quiet}>
	<div class="opening-card" role="status" aria-live="polite">
		<div class="opening-spinner"></div>
		<span class="opening-label">OPENING</span>
		{#if opening.name}
			<span class="opening-name" title={opening.name}>{opening.name}</span>
		{/if}
		<div
			class="opening-bar"
			class:indeterminate={!determinate}
			role="progressbar"
			aria-label={STAGE_TEXT[opening.stage]}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={determinate ? opening.percent : undefined}
		>
			{#if determinate}
				<span class="opening-fill" style:width="{opening.percent}%"></span>
			{/if}
		</div>
		<span class="opening-stage">
			{STAGE_TEXT[opening.stage]}{determinate ? ` · ${opening.percent}%` : ""}
		</span>
		{#if !opening.quiet}
			<p class="opening-note">
				Big projects take a while. Keep this tab open until it's done.
			</p>
		{/if}
	</div>
</div>

<style>
	.opening-overlay {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
		background: rgba(0, 0, 0, 0.7);
	}

	/* Clicks are held from the start, but a quick open never shows the card. */
	.opening-overlay.quiet {
		animation: opening-appear 0.2s ease-out 0.35s both;
	}

	@keyframes opening-appear {
		from {
			opacity: 0;
		}
	}

	.opening-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.7rem;
		width: 24rem;
		max-width: 100%;
		padding: 1.6rem 1.8rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		background: var(--surface);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
		text-align: center;
	}

	.opening-spinner {
		width: 18px;
		height: 18px;
		border: 2px solid var(--line);
		border-top-color: var(--mosh);
		border-radius: 50%;
		animation: opening-spin 0.7s linear infinite;
	}

	@keyframes opening-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.opening-label {
		color: var(--mosh);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.16em;
	}

	.opening-name {
		max-width: 100%;
		overflow: hidden;
		color: var(--text);
		font-size: 0.95rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.opening-bar {
		width: 100%;
		height: 6px;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: var(--sunken);
	}

	.opening-fill {
		display: block;
		height: 100%;
		background: var(--mosh);
		transition: width 0.2s linear;
	}

	.opening-bar.indeterminate {
		background: linear-gradient(
			90deg,
			var(--sunken) 0%,
			var(--raised) 50%,
			var(--sunken) 100%
		);
		background-size: 200% 100%;
		animation: opening-shimmer 1.2s linear infinite;
	}

	@keyframes opening-shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}

	.opening-stage {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}

	.opening-note {
		margin: 0;
		color: var(--text-3);
		font-size: 0.8rem;
		line-height: 1.5;
	}
</style>
