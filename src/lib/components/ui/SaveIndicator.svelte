<script lang="ts">
	import {
		Check,
		CircleDashed,
		LoaderCircle,
		TriangleAlert,
	} from "lucide-svelte";
	import type { SaveState } from "../../editor/save-status.svelte";

	/** The top bar's word on autosave. Muted unless something needs looking at. */
	interface Props {
		state: SaveState;
		lastSavedAt: number | null;
		/** Why this edit isn't being kept, when it isn't; `warn` when it never will be. */
		notSaved?: { reason: string; warn: boolean } | null;
	}

	let { state, lastSavedAt, notSaved = null }: Props = $props();

	let savedAt = $derived(
		lastSavedAt
			? new Date(lastSavedAt).toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
					second: "2-digit",
				})
			: null,
	);

	let view = $derived.by(() => {
		if (state === "failed") {
			return {
				kind: "failed",
				label: "Save failed",
				title:
					"The last change couldn't be written to this browser's storage, so it may not survive a reload. It retries on your next edit.",
			};
		}
		if (notSaved) {
			return {
				kind: notSaved.warn ? "warn" : "quiet",
				label: "Not saved",
				title: notSaved.reason,
			};
		}
		if (state === "saving") {
			return {
				kind: "quiet",
				label: "Saving…",
				title: "Saving to this browser",
			};
		}
		if (state === "saved") {
			return {
				kind: "quiet",
				label: "Saved",
				title: `Saved automatically in this browser${savedAt ? ` at ${savedAt}` : ""}. Nothing is uploaded anywhere.`,
			};
		}
		return null;
	});
</script>

{#if view}
	<span
		class="save-indicator readout"
		class:warn={view.kind === "warn"}
		class:failed={view.kind === "failed"}
		title={view.title}
		role="status"
	>
		{#if view.kind === "failed" || view.kind === "warn"}
			<TriangleAlert size={12} />
		{:else if notSaved}
			<CircleDashed size={12} />
		{:else if state === "saving"}
			<LoaderCircle size={12} />
		{:else}
			<Check size={12} />
		{/if}
		{view.label}
	</span>
	<div class="bar-sep"></div>
{/if}

<style>
	.save-indicator {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		white-space: nowrap;
		cursor: default;
	}

	.save-indicator.warn {
		color: #d9a441;
	}

	.save-indicator.failed {
		color: var(--rec);
	}

	/* Narrow bars keep the icon; the tooltip carries the word. */
	@media (max-width: 800px) {
		.save-indicator {
			font-size: 0;
			gap: 0;
		}
	}
</style>
