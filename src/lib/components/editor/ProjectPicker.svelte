<script lang="ts">
	import { onMount } from "svelte";
	import { FolderOpen } from "lucide-svelte";
	import PanelModal from "../ui/PanelModal.svelte";
	import MediaThumb from "../ui/MediaThumb.svelte";
	import { fmtAgo } from "../../utils";
	import {
		readProjectPreviews,
		sourceThumb,
		type ProjectPreview,
	} from "../../editor/project-preview";
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

	const cachedSlideshows = readCachedRecentEdits("slideshow");
	const cachedSingles = readCachedRecentEdits("single");
	let slideshows = $state<RecentEdit[]>(cachedSlideshows);
	let singles = $state<RecentEdit[]>(cachedSingles);
	const names = readProjectNames();
	let busy = $state(false);
	/** Opens on whichever kind was edited last. */
	let tab = $state<PickedMode>(
		(cachedSingles[0]?.updatedAt ?? 0) > (cachedSlideshows[0]?.updatedAt ?? 0)
			? "single"
			: "slideshow",
	);
	let previews = $state<Map<string, ProjectPreview>>(new Map());
	let thumbs = $state<Record<string, string | null>>({});

	onMount(() => {
		void listRecentEdits("slideshow")
			.then((list) => (slideshows = list))
			.catch(() => {});
		void listRecentEdits("single")
			.then((list) => (singles = list))
			.catch(() => {});
		for (const mode of ["slideshow", "single"] as const) {
			void readProjectPreviews(mode)
				.then((found) => {
					previews = new Map([...previews, ...found]);
					for (const { sourceIds } of found.values()) loadThumbs(sourceIds);
				})
				.catch(() => {});
		}
	});

	function loadThumbs(ids: string[]) {
		for (const id of ids) {
			if (id in thumbs) continue;
			void sourceThumb(id).then((url) => (thumbs[id] = url));
		}
	}

	function effectsLine(effects: string[]): string {
		if (effects.length === 0) return "No effects";
		const shown = effects.slice(0, 3).join(", ");
		return effects.length > 3 ? `${shown} +${effects.length - 3}` : shown;
	}

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

{#snippet frames(edit: RecentEdit, kind: "slide" | "single")}
	{@const ids = previews.get(edit.key)?.sourceIds}
	<span class="frames {kind}" aria-hidden="true">
		{#if ids}
			{#each ids as id (id)}
				<span class="frame">
					<MediaThumb thumbUrl={thumbs[id]} thumbPending={!(id in thumbs)} />
				</span>
			{/each}
		{:else}
			<span class="frame"><MediaThumb thumbPending /></span>
		{/if}
	</span>
{/snippet}

<PanelModal title="Add a project" {busy} {onClose}>
	{#snippet icon()}<FolderOpen size={12} />{/snippet}
	<div class="tabs" role="tablist">
		{#each [["slideshow", "Slideshows", slideshows.length], ["single", "Single edits", singles.length]] as const as [mode, label, count] (mode)}
			<button
				class="tab"
				role="tab"
				aria-selected={tab === mode}
				class:active={tab === mode}
				onclick={() => (tab = mode)}
				>{label}<span class="tab-count">{count}</span></button
			>
		{/each}
	</div>
	{#if tab === "slideshow" && slideshows.length === 0}
		<p class="hint">
			You have no saved slideshows yet. Make one in Slideshow mode and it will
			show up here.
		</p>
	{:else if tab === "slideshow"}
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
						{@render frames(edit, "slide")}
						<span class="text">
							<span class="name">{recentEditName(edit, names)}</span>
							<span class="meta"
								>{edit.sourceCount}
								{edit.sourceCount === 1 ? "slide" : "slides"}</span
							>
						</span>
						<span class="when">{fmtAgo(edit.updatedAt)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	{#if tab === "single" && singles.length === 0}
		<p class="hint">
			You have no saved single edits yet. Make one in Single mode and it will
			show up here.
		</p>
	{:else if tab === "single"}
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
						{@render frames(edit, "single")}
						<span class="text">
							<span class="name">{recentEditName(edit, names)}</span>
							{#if previews.get(edit.key)}
								<span class="meta"
									>{effectsLine(previews.get(edit.key)!.effects)}</span
								>
							{/if}
						</span>
						<span class="when">{fmtAgo(edit.updatedAt)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</PanelModal>

<style>
	.tabs {
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--sunken);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
	}

	.tab {
		display: inline-flex;
		flex: 1;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding: 0.3rem 0;
		background: none;
		border: none;
		border-radius: var(--r-1);
		color: var(--text-3);
		font-family: inherit;
		font-size: 0.72rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.tab:hover {
		color: var(--text-2);
	}

	.tab.active {
		color: var(--text);
		background: var(--raised);
		box-shadow: inset 0 0 0 1px var(--line);
	}

	.tab:focus-visible {
		outline: 1px solid var(--live);
		outline-offset: -1px;
	}

	.tab-count {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--text-4);
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
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.4rem 0.65rem 0.4rem 0.4rem;
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

	.frames {
		display: flex;
		flex-shrink: 0;
		gap: 2px;
	}

	.frames.slide {
		width: 208px;
	}

	.frame {
		position: relative;
		width: 40px;
		height: 48px;
		overflow: hidden;
		border-radius: var(--r-1);
		background: var(--sunken);
	}

	.frames.single .frame {
		width: 72px;
	}

	.text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.15rem;
		min-width: 0;
	}

	.name,
	.meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.name {
		font-size: 0.8rem;
	}

	.meta,
	.when {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		color: var(--text-4);
	}

	.when {
		flex-shrink: 0;
		align-self: flex-start;
		padding-top: 0.15rem;
	}

	@media (max-width: 520px) {
		.frames.slide {
			width: auto;
		}

		.frames.slide .frame:nth-child(n + 4) {
			display: none;
		}
	}
</style>
