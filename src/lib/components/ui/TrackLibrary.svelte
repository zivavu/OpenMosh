<script lang="ts">
	import {
		AudioLines,
		ChevronLeft,
		Library,
		Pause,
		Pencil,
		Play,
		Plus,
		Trash2,
		X,
	} from "lucide-svelte";
	import { onMount } from "svelte";
	import { readJson, readRaw, writeJson, writeRaw } from "../../storage";
	import { getDecodedAudioBuffer } from "../../audio/audio-buffer-cache";
	import { computeNormalizeGain, measureLoudness } from "../../audio/loudness";
	import {
		addTrack,
		deleteTrack,
		getAllTracks,
		renameTrack,
		trackFileName,
		trackToFile,
		type StoredTrack,
	} from "../../audio/track-library";
	import {
		listSavedSequences,
		readCachedSavedSequences,
		type SavedSequence,
	} from "../../editor/saved-sequences";
	import { readProjectNames, setProjectName } from "../../editor/project-names";
	import {
		beginTrackDrag,
		endTrackDrag,
		TRACK_DND_TYPE,
	} from "../../editor/source-drag.svelte";
	import { deleteRecentEdit } from "../../editor/storage-inventory";
	import { showToast } from "./toast.svelte";
	import { fmtAgo } from "../../utils";
	import ConfirmDialog from "./ConfirmDialog.svelte";
	import RenameInput from "./RenameInput.svelte";

	interface Props {
		activeTrackName: string | null;
		activeTrackId?: string | null;
		onLoadTrack: (file: File, trackId: string, autoplay?: boolean) => void;
		onUnloadTrack?: () => void;
		onPlay?: () => void;
		onPause?: () => void;
		mainPlaying?: boolean;
		pendingTrack?: File | null;
		onNormalizeChange?: (gain: number) => void;
		/** Fired when a manually loaded track is auto-saved, so the editor can adopt it. */
		onAutoAdded?: (trackId: string) => void;
		/** Editor only: the drawer leads with the saved projects, and this opens one,
		 * media, timeline and song together. */
		onOpenProject?: (key: string) => void;
		/** The project open now, marked in the list. */
		activeProjectKey?: string | null;
		/** Editor only: songs drag out onto the audio lanes. */
		tracksDraggable?: boolean;
	}

	let {
		activeTrackName,
		activeTrackId = null,
		onLoadTrack,
		onUnloadTrack,
		onPlay,
		onPause,
		mainPlaying = false,
		pendingTrack = null,
		onNormalizeChange,
		onAutoAdded,
		onOpenProject,
		activeProjectKey = null,
		tracksDraggable = false,
	}: Props = $props();

	const hasProjects = $derived(!!onOpenProject);
	/** Always opens on the projects: picking one is what the drawer is for. */
	let tab = $state<"projects" | "songs">("projects");
	$effect(() => {
		if (open) tab = "projects";
	});
	/** Single and slideshow have no projects tab: the drawer is their song library. */
	const showing = $derived(hasProjects ? tab : "songs");

	let projects = $state<SavedSequence[]>(readCachedSavedSequences());
	let projectNames = $state(readProjectNames());

	// Re-read on every open: the list moves as projects save, rename and go.
	$effect(() => {
		if (!hasProjects || !open) return;
		projectNames = readProjectNames();
		refreshProjects();
	});

	function refreshProjects() {
		void listSavedSequences().then((list) => (projects = list));
	}

	function openProject(key: string) {
		if (key === activeProjectKey) return;
		open = false;
		onOpenProject?.(key);
	}

	let renamingProject = $state<string | null>(null);

	function renameProject(key: string, name: string) {
		setProjectName(key, name);
		projectNames = readProjectNames();
	}

	interface ProjectDelete {
		key: string;
		name: string;
	}
	let pendingProjectDelete = $state<ProjectDelete | null>(null);

	async function deleteProject({ key }: ProjectDelete) {
		pendingProjectDelete = null;
		projects = projects.filter((p) => p.trackId !== key);
		try {
			await deleteRecentEdit("sequence", key);
		} catch (e) {
			console.error("Failed to delete project:", e);
			showToast(
				"Couldn't delete that project. Storage refused the write.",
				"error",
			);
		} finally {
			refreshProjects();
		}
	}

	const OPEN_KEY = "openmosh-library-open";
	let open = $state(readRaw(OPEN_KEY) === "true");
	let tracks = $state<StoredTrack[]>([]);
	let libraryLoaded = $state(false);
	let fileInput: HTMLInputElement;
	let libraryEl: HTMLDivElement;

	const NORMALIZE_KEY = "openmosh-library-normalize";
	let normalizedIds = $state<Set<string>>(
		new Set(readJson<string[]>(NORMALIZE_KEY, [])),
	);
	// Not $state: only used internally, never read in the template directly
	let gainCache = new Map<string, number>();
	let measuringIds = $state<Set<string>>(new Set());

	$effect(() => {
		writeJson(NORMALIZE_KEY, [...normalizedIds]);
	});

	$effect(() => {
		writeRaw(OPEN_KEY, String(open));
	});

	$effect(() => {
		const f = pendingTrack;
		if (!f || !libraryLoaded) return;
		const existing = tracks.find(
			(t) => trackFileName(t) === f.name && t.blob.size === f.size,
		);
		if (existing) {
			// Already saved from an earlier visit. Still report it: this is the only place
			// the editor learns the id of a track picked on the upload screen.
			onAutoAdded?.(existing.id);
			return;
		}
		addTrack(f)
			.then((track) => {
				onAutoAdded?.(track.id);
				// addTrack returns the existing entry when the song is already saved, so only
				// list and normalize what is new.
				if (tracks.some((t) => t.id === track.id)) return;
				tracks = [...tracks, track];
				autoNormalize(track);
			})
			.catch((e) => console.error("Failed to auto-save track:", e));
	});

	onMount(async () => {
		try {
			const loaded = await getAllTracks();
			tracks = loaded.sort((a, b) => a.addedAt - b.addedAt);
		} catch (e) {
			console.error("Failed to load tracks:", e);
		} finally {
			libraryLoaded = true;
		}
	});

	export function openLibrary() {
		open = true;
	}

	onMount(() => {
		// The confirm dialog sits outside the panel; clicks in it aren't "away".
		function onPointerDown(e: PointerEvent) {
			if (pendingDelete || pendingProjectDelete) return;
			if (open && libraryEl && !libraryEl.contains(e.target as Node)) {
				open = false;
			}
		}
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	});

	/** Resolve the track's normalize gain (measuring if not cached) and push it to
	 * the editor once known. Fire-and-forget. */
	function applyNormalizeGain(track: StoredTrack) {
		const cached = gainCache.get(track.id);
		if (cached !== undefined) {
			if (track.id === activeTrackId) onNormalizeChange?.(cached);
			return;
		}
		if (measuringIds.has(track.id)) return;
		measuringIds = new Set([...measuringIds, track.id]);
		const file = trackToFile(track);
		getDecodedAudioBuffer(file)
			.then((buffer) => {
				const db = measureLoudness(buffer);
				const gain = computeNormalizeGain(db);
				gainCache.set(track.id, gain);
				if (track.id === activeTrackId) onNormalizeChange?.(gain);
			})
			.catch((e) => {
				console.error("Failed to measure track loudness:", e);
				normalizedIds = new Set(
					[...normalizedIds].filter((x) => x !== track.id),
				);
				if (track.id === activeTrackId) onNormalizeChange?.(1.0);
			})
			.finally(() => {
				measuringIds = new Set([...measuringIds].filter((x) => x !== track.id));
			});
	}

	function autoNormalize(track: StoredTrack) {
		normalizedIds = new Set([...normalizedIds, track.id]);
		applyNormalizeGain(track);
	}

	async function onFileChange() {
		const f = fileInput?.files?.[0];
		if (!f) return;
		fileInput.value = "";
		try {
			const track = await addTrack(f);
			if (tracks.some((t) => t.id === track.id)) return;
			tracks = [...tracks, track];
			autoNormalize(track);
		} catch (e) {
			console.error("Failed to save track:", e);
		}
	}

	let pendingDelete = $state<StoredTrack | null>(null);

	/** Removing the loaded track hands the editor its neighbour first, so it never
	 * sits on a file that is gone. */
	async function onDelete(track: StoredTrack) {
		pendingDelete = null;
		if (isTrackActive(track)) {
			const i = tracks.indexOf(track);
			const next = tracks[i + 1] ?? tracks[i - 1];
			if (next) onLoad(next, mainPlaying);
			else onUnloadTrack?.();
		}
		try {
			await deleteTrack(track.id);
			tracks = tracks.filter((t) => t.id !== track.id);
			normalizedIds = new Set([...normalizedIds].filter((x) => x !== track.id));
			gainCache.delete(track.id);
		} catch (e) {
			console.error("Failed to delete track:", e);
		}
	}

	let renamingId = $state<string | null>(null);

	async function onRename(track: StoredTrack, name: string) {
		try {
			await renameTrack(track.id, name);
			tracks = tracks.map((t) => {
				if (t.id !== track.id) return t;
				const fileName = trackFileName(t);
				return { ...t, fileName, name: name.trim() || fileName };
			});
		} catch (e) {
			console.error("Failed to rename track:", e);
		}
	}

	/** Prefer the id (two library entries can share a name); fall back to the name. */
	function isTrackActive(track: StoredTrack): boolean {
		return activeTrackId
			? track.id === activeTrackId
			: track.name === activeTrackName;
	}

	/** Clicking the loaded track unloads it, rather than reloading it into a
	 * deselect flash. */
	function toggleLoad(track: StoredTrack) {
		if (isTrackActive(track)) {
			onUnloadTrack?.();
			return;
		}
		onLoad(track);
		// Picking a track is what the drawer is for, so close it once the job is done.
		open = false;
	}

	/** Communicate this track's normalize gain to the editor. The gain cache is
	 * memory-only while normalizedIds persists, so a reload re-measures. */
	function syncNormalizeGain(track: StoredTrack) {
		if (normalizedIds.has(track.id)) {
			if (!gainCache.has(track.id)) onNormalizeChange?.(1.0);
			applyNormalizeGain(track);
		} else {
			onNormalizeChange?.(1.0);
		}
	}

	function onLoad(track: StoredTrack, autoplay = false) {
		onLoadTrack(trackToFile(track), track.id, autoplay);
		// Relies on activeTrackId being updated synchronously by onLoadTrack.
		syncedTrackId = track.id;
		syncNormalizeGain(track);
	}

	/** Whichever track ends up loaded gets its gain emitted, however it got there. */
	let syncedTrackId: string | null = null;
	$effect(() => {
		const id = activeTrackId;
		if (!id) {
			syncedTrackId = null;
			return;
		}
		// The list arrives from IndexedDB a tick or two after mount, and a restored
		// session is already active by then.
		if (!libraryLoaded || syncedTrackId === id) return;
		const track = tracks.find((t) => t.id === id);
		// A session whose track was since deleted stays at unity, correctly.
		if (!track) return;
		syncedTrackId = id;
		syncNormalizeGain(track);
	});

	/** Slides the panel aside while a song is dragged, so it doesn't cover the lanes. */
	let draggingTrack = $state(false);

	function onTrackDragStart(e: DragEvent, track: StoredTrack) {
		beginTrackDrag(track.id);
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = "copy";
		e.dataTransfer.setData(TRACK_DND_TYPE, track.id);
		// Some browsers cancel a drag that carries no standard data at all.
		e.dataTransfer.setData("text/plain", track.name);
		// A frame late: moving the dragged row in its own dragstart cancels the drag.
		requestAnimationFrame(() => (draggingTrack = true));
	}

	function onTrackDragEnd(e: DragEvent) {
		endTrackDrag();
		draggingTrack = false;
		if (e.dataTransfer?.dropEffect !== "none") open = false;
	}

	function togglePlay(track: StoredTrack) {
		if (isTrackActive(track)) {
			if (mainPlaying) onPause?.();
			else onPlay?.();
		} else {
			onLoad(track, true);
		}
	}

	function toggleNormalize(track: StoredTrack) {
		if (normalizedIds.has(track.id)) {
			normalizedIds = new Set([...normalizedIds].filter((x) => x !== track.id));
			if (track.id === activeTrackId) onNormalizeChange?.(1.0);
			return;
		}

		normalizedIds = new Set([...normalizedIds, track.id]);
		applyNormalizeGain(track);
	}
</script>

<input
	bind:this={fileInput}
	type="file"
	accept="audio/*"
	onchange={onFileChange}
	hidden
/>

<div
	class="library"
	class:open
	class:dragging={draggingTrack}
	bind:this={libraryEl}
>
	<!-- Always in flow: the 28px expand strip -->
	<button
		class="expand-btn"
		onclick={() => (open = true)}
		title={hasProjects ? "Open projects and songs" : "Open track library"}
	>
		<Library size={14} />
	</button>

	<!-- Overlay panel: slides in on top of the expand strip -->
	<div class="panel" aria-hidden={!open} inert={!open || undefined}>
		<div class="header">
			{#if hasProjects}
				<div class="tabs" role="tablist">
					<button
						class="tab"
						role="tab"
						aria-selected={showing === "projects"}
						class:active={showing === "projects"}
						onclick={() => (tab = "projects")}>Projects</button
					>
					<button
						class="tab"
						role="tab"
						aria-selected={showing === "songs"}
						class:active={showing === "songs"}
						onclick={() => (tab = "songs")}>Songs</button
					>
				</div>
			{:else}
				<span class="title">Track library</span>
			{/if}
			<!-- Kept in place on the projects tab so switching tabs never resizes them. -->
			<button
				class="add-btn"
				class:held={showing !== "songs"}
				onclick={() => fileInput.click()}
				title="Add track"
				inert={showing !== "songs" || undefined}
				aria-hidden={showing !== "songs" || undefined}
			>
				<Plus size={12} />
			</button>
			<button
				class="collapse-btn"
				onclick={() => (open = false)}
				title={hasProjects ? "Collapse" : "Collapse library"}
			>
				<ChevronLeft size={12} />
			</button>
		</div>

		{#if showing === "projects"}
			{#if projects.length === 0}
				<div class="empty">
					No saved projects yet.<br />This one saves as you work.
				</div>
			{:else}
				<ul class="track-list">
					{#each projects as project (project.trackId)}
						{@const name = projectNames[project.trackId] ?? project.trackName}
						{@const isOpen = project.trackId === activeProjectKey}
						<li class="project" class:open-now={isOpen}>
							{#if renamingProject === project.trackId}
								<div class="project-body">
									<RenameInput
										value={name}
										label="Project name"
										class="project-name-input"
										onRename={(next) => renameProject(project.trackId, next)}
										onDone={() => (renamingProject = null)}
									/>
								</div>
							{:else}
								<button
									class="project-body"
									onclick={() => openProject(project.trackId)}
									title={isOpen ? "Open now" : `Open "${name}"`}
									aria-current={isOpen || undefined}
								>
									<span class="project-name">{name}</span>
									<span class="project-meta">
										<span
											>{project.sourceCount} source{project.sourceCount === 1
												? ""
												: "s"}</span
										>
										<span>{fmtAgo(project.updatedAt)}</span>
									</span>
								</button>
								<div class="project-actions">
									<button
										class="project-action"
										onclick={() => (renamingProject = project.trackId)}
										title="Rename"
										aria-label="Rename {name}"
									>
										<Pencil size={11} />
									</button>
									{#if !isOpen}
										<button
											class="project-action danger"
											onclick={() =>
												(pendingProjectDelete = { key: project.trackId, name })}
											title="Delete"
											aria-label="Delete {name}"
										>
											<Trash2 size={11} />
										</button>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else if tracks.length === 0}
			<div class="empty">No tracks yet.<br />Click + to add.</div>
		{:else}
			<ul class="track-list">
				{#each tracks as track (track.id)}
					{const isActive = $derived(isTrackActive(track))}
					{const isPlaying = $derived(isActive && mainPlaying)}
					<li
						class="track-row"
						class:active={isActive}
						draggable={tracksDraggable && renamingId !== track.id}
						ondragstart={(e) => onTrackDragStart(e, track)}
						ondragend={onTrackDragEnd}
					>
						<button
							class="preview-btn"
							onclick={() => togglePlay(track)}
							title={isPlaying ? "Pause" : "Play"}
						>
							{#if isPlaying}
								<Pause size={10} fill="currentColor" stroke="none" />
							{:else}
								<Play size={10} fill="currentColor" stroke="none" />
							{/if}
						</button>
						<button
							class="normalize-btn"
							class:active={normalizedIds.has(track.id)}
							class:measuring={measuringIds.has(track.id)}
							disabled={measuringIds.has(track.id)}
							onclick={() => toggleNormalize(track)}
							title={normalizedIds.has(track.id)
								? "Remove normalization"
								: "Normalize to -14 LUFS"}
						>
							<AudioLines size={10} />
						</button>
						{#if renamingId === track.id}
							<RenameInput
								value={track.name}
								label="Track name"
								class="name-input"
								onRename={(name) => onRename(track, name)}
								onDone={() => (renamingId = null)}
							/>
						{:else}
							<button
								class="name-btn"
								onclick={() => toggleLoad(track)}
								title={(isActive ? "Unload track" : "Load track") +
									(tracksDraggable ? ", or drag it onto an audio lane" : "")}
							>
								{track.name}
							</button>
							<button
								class="rename-btn"
								onclick={() => (renamingId = track.id)}
								title="Rename"
							>
								<Pencil size={10} />
							</button>
						{/if}
						<button
							class="delete-btn"
							onclick={() => (pendingDelete = track)}
							title="Remove"
						>
							<X size={10} />
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

{#if pendingProjectDelete}
	<ConfirmDialog
		title="Delete “{pendingProjectDelete.name}”?"
		message="Removes this project's timeline and any media only it uses. Your songs and other projects stay. This can't be undone."
		confirmLabel="Delete project"
		cancelLabel="Cancel"
		danger
		onConfirm={() => deleteProject(pendingProjectDelete!)}
		onCancel={() => (pendingProjectDelete = null)}
	/>
{/if}

{#if pendingDelete}
	<ConfirmDialog
		title="Remove “{pendingDelete.name}”?"
		message={isTrackActive(pendingDelete)
			? "It's the loaded track. The next one in the library takes its place."
			: "This removes the track from the library."}
		confirmLabel="Remove track"
		cancelLabel="Cancel"
		danger
		onConfirm={() => onDelete(pendingDelete!)}
		onCancel={() => (pendingDelete = null)}
	/>
{/if}

<style>
	.library {
		position: relative;
		flex-shrink: 0;
		width: 28px;
		border-right: 1px solid var(--line);
		background: var(--ink);
	}

	@media (max-width: 800px) {
		.library {
			width: 0;
			border-right: none;
		}

		.expand-btn {
			display: none;
		}

		.panel {
			position: fixed;
			top: 0;
			bottom: 0;
			left: 0;
			z-index: 100;
		}
	}

	.expand-btn {
		width: 100%;
		height: 100%;
		background: none;
		border: none;
		color: var(--text-4);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		z-index: 1;
	}

	.expand-btn:hover {
		color: var(--text-3);
		background: var(--surface);
	}

	.panel {
		position: absolute;
		top: 0;
		left: 0;
		bottom: 0;
		width: 220px;
		z-index: 20;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--ink);
		border-right: 1px solid var(--line);
		transform: translateX(-100%);
		transition: transform 0.15s ease;
	}

	.library.open .panel {
		transform: translateX(0);
	}

	.library.open.dragging .panel {
		transform: translateX(-100%);
	}

	.header {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.5rem 0.5rem 0.4rem 0.6rem;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.title {
		flex: 1;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: var(--text-3);
		text-transform: uppercase;
	}

	.add-btn,
	.collapse-btn {
		background: none;
		border: none;
		color: var(--text-4);
		cursor: pointer;
		width: 18px;
		height: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border-radius: 3px;
	}

	.add-btn {
		border: 1px solid var(--line);
	}

	.add-btn.held {
		visibility: hidden;
	}

	.add-btn:hover {
		color: var(--text);
		border-color: var(--text-4);
	}

	.collapse-btn:hover {
		color: var(--text-2);
		background: var(--raised);
	}

	.empty {
		padding: 1rem 0.8rem;
		font-size: 0.65rem;
		color: var(--text-4);
		line-height: 1.6;
	}

	.track-list {
		list-style: none;
		margin: 0;
		padding: 0.25rem 0;
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}

	.track-row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem 0.5rem;
		border-radius: 3px;
		margin: 0 0.25rem;
	}

	.track-row:hover {
		background: var(--raised);
	}

	.track-row.active {
		background: #1a2a1a;
	}

	.preview-btn,
	.rename-btn,
	.delete-btn {
		flex-shrink: 0;
		background: none;
		border: none;
		color: var(--text-3);
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 2px;
	}

	.preview-btn:hover,
	.rename-btn:hover {
		color: var(--text-2);
	}

	/* Only offered on the row under the pointer; every row lit was noise. */
	.rename-btn {
		color: var(--text-4);
		opacity: 0;
	}

	.track-row:hover .rename-btn,
	.rename-btn:focus-visible {
		opacity: 1;
	}

	.track-row :global(.name-input) {
		font-size: 0.65rem;
	}
	.delete-btn:hover {
		color: #e06060;
	}

	/* A two-way switch in a sunken well, like the action bar's clusters. */
	.tabs {
		flex: 1;
		display: flex;
		padding: 2px;
		gap: 2px;
		background: var(--sunken);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
	}

	.tab {
		flex: 1;
		padding: 0.2rem 0;
		background: none;
		border: none;
		border-radius: var(--r-1);
		color: var(--text-3);
		font-family: inherit;
		font-size: 0.65rem;
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

	.tab:focus-visible,
	.project-body:focus-visible,
	.project-action:focus-visible {
		outline: 1px solid var(--live);
		outline-offset: -1px;
	}

	.project {
		position: relative;
		margin: 0 0.3rem;
		border-radius: var(--r-1);
	}

	.project + .project {
		margin-top: 1px;
	}

	.project:hover,
	.project:focus-within {
		background: var(--raised);
	}

	/* The open project carries the live rail: it's the one the timeline is writing to. */
	.project.open-now {
		--row-bg: color-mix(in srgb, var(--live) 7%, var(--ink));
		background: var(--row-bg);
	}

	.project.open-now::before {
		content: "";
		position: absolute;
		left: 0;
		top: 0.4rem;
		bottom: 0.4rem;
		width: 2px;
		border-radius: 1px;
		background: var(--live);
	}

	.project-body {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		width: 100%;
		min-width: 0;
		padding: 0.4rem 0.55rem 0.4rem 0.6rem;
		background: none;
		border: none;
		border-radius: inherit;
		text-align: left;
		cursor: pointer;
		font-family: inherit;
	}

	.project-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.7rem;
		font-weight: 500;
		color: var(--text-2);
	}

	.project:hover .project-name,
	.project.open-now .project-name {
		color: var(--text);
	}

	.project-meta {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.55rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-3);
		white-space: nowrap;
	}

	.project.open-now .project-meta {
		color: var(--live-dim);
	}

	.project :global(.project-name-input) {
		font-size: 0.7rem;
		font-weight: 500;
	}

	/* Over the row's right end, only where the pointer or focus is. */
	.project-actions {
		position: absolute;
		top: 0.3rem;
		right: 0.3rem;
		display: flex;
		gap: 1px;
		padding-left: 0.6rem;
		background: linear-gradient(
			to right,
			transparent,
			var(--row-bg, var(--raised)) 0.6rem
		);
		opacity: 0;
		pointer-events: none;
		transition: opacity var(--t-fast);
	}

	.project:hover .project-actions,
	.project:focus-within .project-actions {
		opacity: 1;
		pointer-events: auto;
	}

	.project-action {
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		background: var(--raised);
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		color: var(--text-3);
		cursor: pointer;
	}

	.project-action:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}

	.project-action.danger:hover {
		color: var(--rec);
		border-color: var(--rec-dim);
	}

	.name-btn {
		flex: 1;
		background: none;
		border: none;
		color: var(--text-2);
		cursor: pointer;
		font-size: 0.65rem;
		text-align: left;
		padding: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.track-row.active .name-btn {
		color: #7dba7d;
	}

	.name-btn:hover {
		color: var(--text);
	}

	.normalize-btn {
		flex-shrink: 0;
		background: none;
		border: none;
		color: var(--text-4);
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 2px;
		width: 18px;
		height: 18px;
	}

	.normalize-btn:hover {
		color: var(--text-2);
	}

	.normalize-btn.active {
		color: #7dba7d;
	}

	.normalize-btn.measuring {
		animation: normalize-pulse 0.8s ease-in-out infinite;
	}

	@keyframes normalize-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}
</style>
