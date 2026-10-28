<script lang="ts">
	import { onMount } from "svelte";
	import { GalleryHorizontal } from "lucide-svelte";
	import PanelModal from "../ui/PanelModal.svelte";
	import { readProjectNames } from "../../editor/project-names";
	import {
		listRecentEdits,
		readCachedRecentEdits,
		recentEditName,
		type RecentEdit,
	} from "../../editor/recent-edits";

	/** The saved slideshows, to bring one into the editor's pool. */
	interface Props {
		/** Settles once the slideshow is in; the list stays up meanwhile. */
		onPick: (sessionKey: string, name: string) => Promise<void>;
		onClose: () => void;
	}

	let { onPick, onClose }: Props = $props();

	let edits = $state<RecentEdit[]>(readCachedRecentEdits("slideshow"));
	const names = readProjectNames();
	let busy = $state(false);

	onMount(() => {
		void listRecentEdits("slideshow")
			.then((list) => (edits = list))
			.catch(() => {});
	});

	async function pick(edit: RecentEdit) {
		if (busy) return;
		busy = true;
		try {
			await onPick(edit.key, recentEditName(edit, names));
		} finally {
			busy = false;
		}
	}
</script>

<PanelModal title="Add a slideshow" {busy} {onClose}>
	{#snippet icon()}<GalleryHorizontal size={12} />{/snippet}
	{#if edits.length === 0}
		<p class="hint">
			You have no saved slideshows yet. Make one in Slideshow mode and it will
			show up here.
		</p>
	{:else}
		<p class="hint">
			It comes in as one clip that cuts on the slideshow's own beat. If you
			change the slideshow later, pick Update from slideshow on its clip.
		</p>
		<ul class="list">
			{#each edits as edit (edit.key)}
				<li>
					<button class="row" disabled={busy} onclick={() => pick(edit)}>
						<span class="name">{recentEditName(edit, names)}</span>
						<span class="count"
							>{edit.sourceCount}
							{edit.sourceCount === 1 ? "slide" : "slides"}</span
						>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</PanelModal>

<style>
	.hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-3);
		line-height: 1.5;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: baseline;
		gap: 0.6rem;
		width: 100%;
		padding: 0.5rem 0.65rem;
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		background: none;
		color: var(--text-2);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--t-fast),
			color var(--t-fast);
	}

	.row:hover:not(:disabled) {
		border-color: var(--mosh);
		color: var(--text);
	}

	.row:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.8rem;
	}

	.count {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		color: var(--text-4);
	}
</style>
