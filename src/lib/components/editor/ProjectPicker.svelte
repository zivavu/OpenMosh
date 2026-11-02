<script lang="ts">
	import { onMount } from "svelte";
	import { FolderOpen } from "lucide-svelte";
	import PanelModal from "../ui/PanelModal.svelte";
	import MediaThumb from "../ui/MediaThumb.svelte";
	import Checkbox from "../ui/Checkbox.svelte";
	import type { ProjectSongChoice } from "../../editor/settings";
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
			includeSong: boolean,
		) => Promise<void>;
		/** "ask" puts the question on the picked row before it goes in. */
		projectSong: ProjectSongChoice;
		onRememberSong: (choice: ProjectSongChoice) => void;
		onClose: () => void;
	}

	let { onPick, projectSong, onRememberSong, onClose }: Props = $props();

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

	/** The row asking whether its song comes along. */
	let askingKey = $state<string | null>(null);
	let rememberSong = $state(false);

	function pick(mode: PickedMode, edit: RecentEdit) {
		if (busy) return;
		// Not known yet counts as having one: the answer is ignored when there's none.
		const hasSong = previews.get(edit.key)?.hasSong ?? true;
		if (hasSong && projectSong === "ask") {
			askingKey = askingKey === edit.key ? null : edit.key;
			rememberSong = false;
			return;
		}
		void add(mode, edit, projectSong !== "skip");
	}

	function answer(mode: PickedMode, edit: RecentEdit, includeSong: boolean) {
		if (rememberSong) onRememberSong(includeSong ? "add" : "skip");
		void add(mode, edit, includeSong);
	}

	async function add(mode: PickedMode, edit: RecentEdit, includeSong: boolean) {
		if (busy) return;
		busy = true;
		try {
			await onPick(mode, edit.key, recentEditName(edit, names), includeSong);
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

{#snippet songAsk(mode: PickedMode, edit: RecentEdit)}
	{#if askingKey === edit.key}
		<div class="song-ask">
			<p class="ask-q">
				Add its song too? It goes on an audio lane under the clip.
			</p>
			<div class="ask-actions">
				<button
					class="ask-btn primary"
					disabled={busy}
					onclick={() => answer(mode, edit, true)}>Add the song</button
				>
				<button
					class="ask-btn"
					disabled={busy}
					onclick={() => answer(mode, edit, false)}>Leave it out</button
				>
				<label class="ask-remember">
					<Checkbox bind:checked={rememberSong} disabled={busy} />
					Remember my choice
				</label>
			</div>
			{#if rememberSong}
				<p class="hint">
					You can change it later in Mosh settings, under Project songs.
				</p>
			{/if}
		</div>
	{/if}
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
					{@render songAsk("slideshow", edit)}
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
			It comes in as one clip with the edit's effects. If you change the edit
			later, pick Update from single edit on its clip.
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
					{@render songAsk("single", edit)}
				</li>
			{/each}
		</ul>
	{/if}
</PanelModal>

<style>
	.song-ask {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
		margin-top: 0.25rem;
		padding: 0.55rem 0.65rem;
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		background: var(--sunken);
	}

	.ask-q {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-2);
	}

	.ask-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
	}

	.ask-btn {
		padding: 0.3rem 0.65rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		background: none;
		color: var(--text-2);
		font-family: inherit;
		font-size: 0.72rem;
		cursor: pointer;
	}

	.ask-btn:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--text-3);
	}

	.ask-btn.primary {
		border-color: var(--mosh);
		color: var(--text);
	}

	.ask-btn:disabled {
		cursor: progress;
		opacity: 0.6;
	}

	.ask-remember {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: auto;
		font-size: 0.72rem;
		color: var(--text-3);
		cursor: pointer;
	}

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
