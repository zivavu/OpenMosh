<script lang="ts">
	import { onMount } from "svelte";
	import { FolderOpen } from "lucide-svelte";
	import PanelModal from "../ui/PanelModal.svelte";
	import { readProjectNames } from "../../editor/project-names";
	import {
		listRecentEdits,
		readCachedRecentEdits,
		recentEditName,
		type RecentEdit,
	} from "../../editor/recent-edits";

	type PickedMode = "slideshow" | "single";

	/** The saved slideshows and single edits, to bring one into the editor. */
	interface Props {
		/** Settles once it's in; the list stays up meanwhile. */
		onPick: (
			mode: PickedMode,
			sessionKey: string,
			name: string,
		) => Promise<void>;
		onClose: () => void;
	}

	let { onPick, onClose }: Props = $props();

	let slideshows = $state<RecentEdit[]>(readCachedRecentEdits("slideshow"));
	let singles = $state<RecentEdit[]>(readCachedRecentEdits("single"));
	const names = readProjectNames();
	let busy = $state(false);

	onMount(() => {
		void listRecentEdits("slideshow")
			.then((list) => (slideshows = list))
			.catch(() => {});
		void listRecentEdits("single")
			.then((list) => (singles = list))
			.catch(() => {});
	});

	async function pick(mode: PickedMode, edit: RecentEdit) {
		if (busy) return;
		busy = true;
		try {
			await onPick(mode, edit.key, recentEditName(edit, names));
		} finally {
			busy = false;
		}
	}
</script>

<PanelModal title="Add a project" {busy} {onClose}>
	{#snippet icon()}<FolderOpen size={12} />{/snippet}
	{#if slideshows.length === 0 && singles.length === 0}
		<p class="hint">
			You have no saved slideshows or single edits yet. Make one in Slideshow or
			Single mode and it will show up here.
		</p>
	{/if}
	{#if slideshows.length > 0}
		<h3 class="section">Slideshows</h3>
		<p class="hint">
			It comes in as one clip that cuts on the slideshow's own beat. If you
			change the slideshow later, pick Update from slideshow on its clip.
		</p>
		<ul class="list">
			{#each slideshows as edit (edit.key)}
				<li>
					<button
						class="row"
						disabled={busy}
						onclick={() => pick("slideshow", edit)}
					>
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
	{#if singles.length > 0}
		<h3 class="section">Single edits</h3>
		<p class="hint">
			It comes in as one clip with the edit's effects, and its song goes on an
			audio lane under it. If you change the edit later, pick Update from single
			edit on its clip.
		</p>
		<ul class="list">
			{#each singles as edit (edit.key)}
				<li>
					<button
						class="row"
						disabled={busy}
						onclick={() => pick("single", edit)}
					>
						<span class="name">{recentEditName(edit, names)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</PanelModal>

<style>
	.section {
		margin: 0.4rem 0 0;
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-2);
	}

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
