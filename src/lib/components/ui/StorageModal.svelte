<script lang="ts">
	import Checkbox from "./Checkbox.svelte";
	interface Props {
		onClose: () => void;
		/** Fired after anything was deleted or renamed, so the opener can repaint its lists. */
		onChanged?: () => void;
	}

	import {
		ChevronRight,
		Film,
		Image,
		ListVideo,
		Music,
		Pencil,
		Trash2,
		Type,
		X,
	} from "lucide-svelte";
	import { onMount } from "svelte";
	import {
		deleteAllProxies,
		deleteEverything,
		deleteFont,
		deleteLooseEdit,
		deleteProject,
		deleteUnassignedMedia,
		describeLooseEditDeletion,
		describeProjectDeletion,
		keepStorage,
		loadStorageInventory,
		type ProjectMode,
		type StorageInventory,
		type StorageLooseEdit,
		type StorageMediaItem,
		type StorageProject,
	} from "../../editor/storage-inventory";
	import {
		canInstall,
		onInstallableChange,
		promptInstall,
	} from "../../install-prompt";
	import {
		projectKeyForSession,
		setProjectName,
	} from "../../editor/project-names";
	import ConfirmDialog from "./ConfirmDialog.svelte";
	import RenameInput from "./RenameInput.svelte";
	import { showToast } from "./toast.svelte";
	import { fmtAgo } from "../../utils";

	let { onClose, onChanged }: Props = $props();

	let inventory = $state<StorageInventory | null>(null);
	let failed = $state(false);
	/** Set while a deletion runs, so a second click can't overlap the first. */
	let busy = $state(false);
	let changed = false;
	/** Rows whose media list is unfolded. */
	let expanded = $state<Set<string>>(new Set());
	/** Checked rows, by the same `p:`/`e:` keys as `expanded`. */
	let selected = $state<Set<string>>(new Set());
	/** The last row checked, so shift-click can extend from it. */
	let lastPicked: string | null = null;
	let keepRefused = $state(false);
	/** Chrome offered an install we can trigger — the one lever that flips its refusal. */
	let installable = $state(canInstall());
	const isChromium = "chrome" in window;
	/** Chrome keys its trust signals on the registrable domain, and localhost has none. */
	const isLocalhost = location.hostname === "localhost";

	interface PendingAction {
		title: string;
		message: string;
		run: () => Promise<void>;
	}
	let pending = $state<PendingAction | null>(null);

	async function refresh() {
		try {
			inventory = await loadStorageInventory();
			failed = false;
		} catch {
			failed = true;
		}
	}

	onMount(() => onInstallableChange(() => (installable = canInstall())));

	onMount(() => {
		void refresh();
	});

	function close() {
		if (changed) onChanged?.();
		onClose();
	}

	function onKeydown(e: KeyboardEvent) {
		// The confirm dialog handles its own Escape.
		if (e.key === "Escape" && !pending) close();
	}

	/** The `p:`/`e:` row whose name is a field right now. */
	let renaming = $state<string | null>(null);

	// Blank clears the custom name; the reload is what brings the song's back.
	function renameProject(p: StorageProject, name: string) {
		setProjectName(p.trackId, name);
		changed = true;
		void refresh();
	}

	function renameLoose(e: StorageLooseEdit, name: string) {
		setProjectName(projectKeyForSession(e.key), name);
		changed = true;
		void refresh();
	}

	function toggle(key: string) {
		const next = new Set(expanded);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expanded = next;
	}

	async function runPending() {
		const action = pending;
		if (!action || busy) return;
		pending = null;
		busy = true;
		try {
			await action.run();
			changed = true;
			await refresh();
			// Whatever survived the deletion stays checked; the rest is gone.
			selected = new Set(
				[...selected].filter((k) => selectableKeys.includes(k)),
			);
		} catch (e) {
			console.error(e);
			showToast("Couldn't delete that — storage refused the write", "error");
		} finally {
			busy = false;
		}
	}

	async function keep() {
		const ok = await keepStorage();
		if (ok) {
			keepRefused = false;
			showToast("Your work is now exempt from browser cleanup");
			await refresh();
		} else {
			keepRefused = true;
		}
	}

	/** Install as an app, then ask again — Chrome grants installed apps outright. */
	async function installAndKeep() {
		if (!(await promptInstall())) return;
		await keep();
	}

	// ── Selection ──

	/** Every checkable row, in display order, so a shift-click has a range. */
	let selectableKeys = $derived<string[]>(
		inventory
			? [
					...inventory.projects.map((p) => `p:${p.trackId}`),
					...inventory.looseEdits.map((e) => `e:${e.key}`),
				]
			: [],
	);

	function pick(key: string, e: MouseEvent) {
		const next = new Set(selected);
		const on = !next.has(key);
		if (e.shiftKey && lastPicked && lastPicked !== key) {
			const a = selectableKeys.indexOf(lastPicked);
			const b = selectableKeys.indexOf(key);
			if (a !== -1 && b !== -1) {
				const range = selectableKeys.slice(Math.min(a, b), Math.max(a, b) + 1);
				for (const k of range) {
					if (on) next.add(k);
					else next.delete(k);
				}
			}
		} else if (on) next.add(key);
		else next.delete(key);
		lastPicked = key;
		selected = next;
	}

	/** Checks the whole section, or clears it when every row is already in. */
	function pickAll(keys: string[]) {
		const next = new Set(selected);
		const all = keys.every((k) => next.has(k));
		for (const k of keys) {
			if (all) next.delete(k);
			else next.add(k);
		}
		selected = next;
	}

	function sectionState(keys: string[]): "none" | "some" | "all" {
		const n = keys.filter((k) => selected.has(k)).length;
		return n === 0 ? "none" : n === keys.length ? "all" : "some";
	}

	let projectKeys = $derived(
		inventory?.projects.map((p) => `p:${p.trackId}`) ?? [],
	);
	let looseKeys = $derived(
		inventory?.looseEdits.map((e) => `e:${e.key}`) ?? [],
	);
	let selectedProjects = $derived(
		inventory?.projects.filter((p) => selected.has(`p:${p.trackId}`)) ?? [],
	);
	let selectedLoose = $derived(
		inventory?.looseEdits.filter((e) => selected.has(`e:${e.key}`)) ?? [],
	);
	let selectedCount = $derived(selectedProjects.length + selectedLoose.length);
	let selectedSize = $derived(
		selectedProjects.reduce(
			(n, p) => n + p.mediaSize + p.trackSize + p.workSize,
			0,
		) + selectedLoose.reduce((n, e) => n + e.mediaSize + e.workSize, 0),
	);

	function askDeleteSelected() {
		const projects = selectedProjects;
		const loose = selectedLoose;
		pending = {
			title: "Delete selected",
			message: `Removes ${fmtCount(selectedCount, "item")} — songs, timelines, sessions and any media only they use. Files shared with unselected projects stay. This can't be undone.`,
			run: async () => {
				for (const p of projects) await deleteProject(p);
				for (const e of loose) await deleteLooseEdit(e);
			},
		};
	}

	// ── Actions ──

	function askDeleteProject(p: StorageProject) {
		pending = {
			title: "Delete project",
			message: describeProjectDeletion(p),
			run: () => deleteProject(p),
		};
	}

	function askDeleteLoose(e: StorageLooseEdit) {
		pending = {
			title: "Delete edit",
			message: describeLooseEditDeletion(e),
			run: () => deleteLooseEdit(e),
		};
	}

	function askClearUnassigned(items: StorageMediaItem[]) {
		pending = {
			title: "Clear unassigned media",
			message: `Deletes ${items.length} file${items.length === 1 ? "" : "s"} no project uses. Anything you dropped and never built with goes too.`,
			run: () => deleteUnassignedMedia(items),
		};
	}

	function askClearProxies() {
		pending = {
			title: "Clear preview proxies",
			message:
				"Deletes every stored preview re-encode. Each video builds a fresh one the next time it opens, which takes a moment.",
			run: deleteAllProxies,
		};
	}

	function askDeleteFont(id: string, name: string) {
		pending = {
			title: "Remove font",
			message: `Removes "${name}". Text already set in it falls back to the default face.`,
			run: () => deleteFont(id),
		};
	}

	function askDeleteEverything() {
		pending = {
			title: "Delete everything",
			message:
				"Every project, song, media file, proxy and font stored by OpenMosh. Presets and settings stay. This can't be undone.",
			run: deleteEverything,
		};
	}

	// ── Formatting ──

	function fmtBytes(n: number): string {
		if (n < 1024) return `${n} B`;
		const units = ["KB", "MB", "GB", "TB"];
		let v = n / 1024;
		let i = 0;
		while (v >= 1024 && i < units.length - 1) {
			v /= 1024;
			i++;
		}
		return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
	}

	function fmtCount(n: number, noun: string): string {
		return `${n} ${noun}${n === 1 ? "" : "s"}`;
	}

	const MODE_LABEL: Record<ProjectMode, string> = {
		sequence: "Editor",
		single: "Single",
		slideshow: "Slideshow",
	};

	// ── Derived ──

	let unassignedSize = $derived(
		inventory?.unassigned.reduce((n, m) => n + m.size + m.proxySize, 0) ?? 0,
	);
	let storedTotal = $derived(
		inventory
			? inventory.totals.media +
					inventory.totals.tracks +
					inventory.totals.proxies +
					inventory.totals.work +
					inventory.totals.fonts
			: 0,
	);
	/** What the bar is drawn against: the quota when known, else what we hold. */
	let barBase = $derived(
		inventory?.quota && inventory.quota > 0
			? inventory.quota
			: Math.max(storedTotal, 1),
	);
	let segments = $derived(
		inventory
			? [
					{ key: "media", label: "Media", size: inventory.totals.media },
					{ key: "tracks", label: "Songs", size: inventory.totals.tracks },
					{ key: "proxies", label: "Proxies", size: inventory.totals.proxies },
					{ key: "work", label: "Edits", size: inventory.totals.work },
					{ key: "fonts", label: "Fonts", size: inventory.totals.fonts },
				]
			: [],
	);
	let isEmpty = $derived(
		!!inventory &&
			inventory.projects.length === 0 &&
			inventory.looseEdits.length === 0 &&
			inventory.unassigned.length === 0 &&
			inventory.proxyCount === 0 &&
			inventory.fonts.length === 0,
	);
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="storage-overlay" onclick={close}>
	<div
		class="storage-modal"
		role="dialog"
		aria-modal="true"
		aria-label="Storage"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="header">
			<span class="title">Storage</span>
			<button class="close-btn" onclick={close} title="Close">
				<X size={14} />
			</button>
		</div>

		{#if failed}
			<p class="note">Couldn't read storage. The browser may be blocking it.</p>
		{:else if !inventory}
			<div class="loading">
				<span class="bar bar--loading"></span>
				<span class="note">Reading…</span>
			</div>
		{:else}
			<!-- Usage -->
			<section class="usage">
				<div class="bar" title={`${fmtBytes(storedTotal)} stored by OpenMosh`}>
					{#each segments as seg (seg.key)}
						{#if seg.size > 0}
							<span
								class="seg seg--{seg.key}"
								style="width: {Math.max((seg.size / barBase) * 100, 0.4)}%"
							></span>
						{/if}
					{/each}
				</div>
				<div class="usage-row">
					<span class="usage-text">
						<strong>{fmtBytes(storedTotal)}</strong>
						{#if inventory.quota}
							of {fmtBytes(inventory.quota)} available
						{:else}
							stored
						{/if}
					</span>
					{#if inventory.persisted === true}
						<span
							class="badge badge--safe"
							title="The browser won't clear this site's data to free space"
						>
							Protected
						</span>
					{:else if inventory.persisted === false}
						<span class="keep">
							<span
								class="badge"
								title="A browser short on disk may clear this site's data without asking"
							>
								Evictable
							</span>
							{#if !keepRefused}
								<button class="link-btn" onclick={keep}>Protect</button>
							{:else if installable}
								<button class="link-btn" onclick={installAndKeep}
									>Install app</button
								>
							{:else}
								<button class="link-btn" onclick={keep}>Retry</button>
							{/if}
						</span>
					{/if}
				</div>
				{#if keepRefused}
					<p class="note">
						{#if isChromium && isLocalhost}
							Chrome ignores bookmarks and installs on localhost. Open the app
							at 127.0.0.1 instead, bookmark that, and try again. Storage is
							per-origin, so projects saved here won't follow.
						{:else if isChromium}
							Chrome decides this itself, without asking. It says yes to sites
							you've installed as an app or bookmarked, so
							{installable ? "install it" : "bookmark this page"} and try again. If
							it still says no, check that Chrome isn't set to clear site data on
							close.
						{:else}
							The browser turned the request down. It may ask again on a later
							visit.
						{/if}
					</p>
				{/if}
				<div class="legend">
					{#each segments as seg (seg.key)}
						<span class="legend-item" class:dim={seg.size === 0}>
							<span class="dot dot--{seg.key}"></span>
							{seg.label}
							<span class="legend-size">{fmtBytes(seg.size)}</span>
						</span>
					{/each}
				</div>
			</section>

			{#if isEmpty}
				<p class="note empty">
					Nothing stored yet. Projects show up here once you start one.
				</p>
			{/if}

			<!-- Projects -->
			{#if inventory.projects.length > 0}
				<section>
					<div class="section-head">
						<Checkbox
							checked={sectionState(projectKeys) === "all"}
							indeterminate={sectionState(projectKeys) === "some"}
							aria-label="Select all projects"
							onclick={() => pickAll(projectKeys)}
						/>
						<span class="section-title">Projects</span>
						<span class="section-meta">{inventory.projects.length}</span>
					</div>
					<ul class="rows">
						{#each inventory.projects as p (p.trackId)}
							{@const key = `p:${p.trackId}`}
							{@const open = expanded.has(key)}
							<li
								class="row selectable"
								class:open
								class:picked={selected.has(key)}
							>
								<Checkbox
									checked={selected.has(key)}
									aria-label={`Select ${p.name}`}
									onclick={(e) => pick(key, e)}
								/>
								<svelte:element
									this={renaming === key ? "div" : "button"}
									class="row-main"
									class:static={renaming === key}
									onclick={() => renaming !== key && toggle(key)}
									disabled={p.media.length === 0}
									aria-expanded={open}
								>
									<span class="chev" class:hidden={p.media.length === 0}>
										<ChevronRight size={12} />
									</span>
									<Music size={13} />
									{#if renaming === key}
										<RenameInput
											value={p.name}
											label="Project name"
											class="row-name"
											onRename={(name) => renameProject(p, name)}
											onDone={() => (renaming = null)}
										/>
									{:else}
										<span class="row-name" title={p.name}>{p.name}</span>
									{/if}
									<span class="modes">
										{#each p.modes as m (m)}
											<span class="mode mode--{m}">{MODE_LABEL[m]}</span>
										{/each}
									</span>
									<span class="row-meta">
										{#if p.media.length > 0}
											{fmtCount(p.media.length, "file")} · {fmtBytes(
												p.mediaSize,
											)}
										{:else}
											song only
										{/if}
										<span class="sep">·</span>
										song {fmtBytes(p.trackSize)}
									</span>
									<span class="row-when">{fmtAgo(p.updatedAt)}</span>
								</svelte:element>
								<span class="row-actions">
									<button
										class="icon-btn"
										title="Rename project"
										aria-label={`Rename ${p.name}`}
										disabled={busy}
										onclick={() => (renaming = key)}
									>
										<Pencil size={13} />
									</button>
									<button
										class="icon-btn danger"
										title="Delete project"
										aria-label={`Delete ${p.name}`}
										disabled={busy}
										onclick={() => askDeleteProject(p)}
									>
										<Trash2 size={13} />
									</button>
								</span>
								{#if open}
									<ul class="media-list">
										{#each p.media as m (m.id)}
											<li class="media">
												{#if m.type.startsWith("video/")}
													<Film size={11} />
												{:else}
													<Image size={11} />
												{/if}
												<span class="media-name" title={m.name}>{m.name}</span>
												{#if m.refs > 1}
													<span
														class="shared"
														title="Used by more than one project">shared</span
													>
												{/if}
												<span class="media-size">
													{fmtBytes(m.size)}{#if m.proxySize > 0}<span
															class="proxy-size"
														>
															+{fmtBytes(m.proxySize)} proxy</span
														>{/if}
												</span>
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<!-- Song-less edits -->
			{#if inventory.looseEdits.length > 0}
				<section>
					<div class="section-head">
						<Checkbox
							checked={sectionState(looseKeys) === "all"}
							indeterminate={sectionState(looseKeys) === "some"}
							aria-label="Select all song-less edits"
							onclick={() => pickAll(looseKeys)}
						/>
						<span class="section-title">Without a song</span>
						<span class="section-meta">{inventory.looseEdits.length}</span>
					</div>
					<ul class="rows">
						{#each inventory.looseEdits as e (e.key)}
							{@const key = `e:${e.key}`}
							{@const open = expanded.has(key)}
							<li
								class="row selectable"
								class:open
								class:picked={selected.has(key)}
							>
								<Checkbox
									checked={selected.has(key)}
									aria-label={`Select ${e.label}`}
									onclick={(ev) => pick(key, ev)}
								/>
								<svelte:element
									this={renaming === key ? "div" : "button"}
									class="row-main"
									class:static={renaming === key}
									onclick={() => renaming !== key && toggle(key)}
									disabled={e.media.length === 0}
									aria-expanded={open}
								>
									<span class="chev" class:hidden={e.media.length === 0}>
										<ChevronRight size={12} />
									</span>
									{#if e.mode === "single"}
										<Image size={13} />
									{:else}
										<ListVideo size={13} />
									{/if}
									{#if renaming === key}
										<RenameInput
											value={e.label}
											label="Edit name"
											class="row-name"
											onRename={(name) => renameLoose(e, name)}
											onDone={() => (renaming = null)}
										/>
									{:else}
										<span class="row-name" title={e.label}>{e.label}</span>
									{/if}
									<span class="modes">
										<span class="mode mode--{e.mode}">{MODE_LABEL[e.mode]}</span
										>
									</span>
									<span class="row-meta">
										{fmtCount(e.media.length, "file")} · {fmtBytes(
											e.mediaSize + e.workSize,
										)}
									</span>
									<span class="row-when">{fmtAgo(e.updatedAt)}</span>
								</svelte:element>
								<span class="row-actions">
									<button
										class="icon-btn"
										title="Rename edit"
										aria-label={`Rename ${e.label}`}
										disabled={busy}
										onclick={() => (renaming = key)}
									>
										<Pencil size={13} />
									</button>
									<button
										class="icon-btn danger"
										title="Delete edit"
										aria-label={`Delete ${e.label}`}
										disabled={busy}
										onclick={() => askDeleteLoose(e)}
									>
										<Trash2 size={13} />
									</button>
								</span>
								{#if open}
									<ul class="media-list">
										{#each e.media as m (m.id)}
											<li class="media">
												{#if m.type.startsWith("video/")}
													<Film size={11} />
												{:else}
													<Image size={11} />
												{/if}
												<span class="media-name" title={m.name}>{m.name}</span>
												{#if m.refs > 1}
													<span class="shared">shared</span>
												{/if}
												<span class="media-size"
													>{fmtBytes(m.size + m.proxySize)}</span
												>
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<!-- Caches and leftovers -->
			{#if inventory.unassigned.length > 0 || inventory.proxyCount > 0 || inventory.fonts.length > 0}
				<section>
					<div class="section-head">
						<span class="section-title">Other</span>
					</div>
					<ul class="rows">
						{#if inventory.unassigned.length > 0}
							{@const open = expanded.has("unassigned")}
							<li class="row" class:open>
								<button
									class="row-main"
									onclick={() => toggle("unassigned")}
									aria-expanded={open}
								>
									<span class="chev"><ChevronRight size={12} /></span>
									<Image size={13} />
									<span class="row-name">Unassigned media</span>
									<span class="row-meta">
										{fmtCount(inventory.unassigned.length, "file")} · {fmtBytes(
											unassignedSize,
										)}
									</span>
									<span class="row-hint">dropped, never used by a project</span>
								</button>
								<button
									class="text-btn danger"
									disabled={busy}
									onclick={() => askClearUnassigned(inventory!.unassigned)}
								>
									Clear
								</button>
								{#if open}
									<ul class="media-list">
										{#each inventory.unassigned as m (m.id)}
											<li class="media">
												{#if m.type.startsWith("video/")}
													<Film size={11} />
												{:else}
													<Image size={11} />
												{/if}
												<span class="media-name" title={m.name}>{m.name}</span>
												<span class="media-size"
													>{fmtBytes(m.size + m.proxySize)}</span
												>
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/if}
						{#if inventory.proxyCount > 0}
							<li class="row">
								<div class="row-main static">
									<span class="chev hidden"><ChevronRight size={12} /></span>
									<Film size={13} />
									<span class="row-name">Preview proxies</span>
									<span class="row-meta">
										{inventory.proxyCount} · {fmtBytes(
											inventory.totals.proxies,
										)}
									</span>
									<span class="row-hint">rebuilt on demand</span>
								</div>
								<button
									class="text-btn danger"
									disabled={busy}
									onclick={askClearProxies}
								>
									Clear
								</button>
							</li>
						{/if}
						{#each inventory.fonts as f (f.id)}
							<li class="row">
								<div class="row-main static">
									<span class="chev hidden"><ChevronRight size={12} /></span>
									<Type size={13} />
									<span class="row-name" title={f.name}>{f.name}</span>
									<span class="row-meta">font · {fmtBytes(f.size)}</span>
								</div>
								<button
									class="icon-btn danger"
									title="Remove font"
									aria-label={`Remove ${f.name}`}
									disabled={busy}
									onclick={() => askDeleteFont(f.id, f.name)}
								>
									<Trash2 size={13} />
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if selectedCount > 0}
				<div class="bulk">
					<span class="bulk-text">
						<strong>{selectedCount}</strong> selected · {fmtBytes(selectedSize)}
					</span>
					<span class="bulk-actions">
						<button class="text-btn" onclick={() => (selected = new Set())}>
							Clear
						</button>
						<button
							class="text-btn danger outline"
							disabled={busy}
							onclick={askDeleteSelected}
						>
							Delete selected
						</button>
					</span>
				</div>
			{/if}

			{#if !isEmpty}
				<div class="footer">
					<span class="note"
						>Shared files count toward every project that uses them.</span
					>
					<button
						class="text-btn danger outline"
						disabled={busy}
						onclick={askDeleteEverything}
					>
						Delete everything
					</button>
				</div>
			{/if}
		{/if}
	</div>
</div>

{#if pending}
	<ConfirmDialog
		title={pending.title}
		message={pending.message}
		confirmLabel="Delete"
		danger
		onConfirm={runPending}
		onCancel={() => (pending = null)}
	/>
{/if}

<style>
	.storage-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.storage-modal {
		display: flex;
		flex-direction: column;
		gap: 1.1rem;
		width: 640px;
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

	.title,
	.section-title {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		border: none;
		border-radius: 4px;
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}

	.close-btn:hover {
		color: var(--text);
	}

	.note {
		margin: 0;
		font-size: 0.7rem;
		color: var(--text-3);
	}

	.note.empty {
		padding: 1.5rem 0;
		text-align: center;
	}

	.loading {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* ── Usage ── */

	.usage {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
	}

	.bar {
		display: flex;
		height: 8px;
		overflow: hidden;
		border-radius: var(--r-pill);
		background: var(--sunken);
		border: 1px solid var(--line);
	}

	.bar--loading {
		background: linear-gradient(
			90deg,
			var(--sunken) 0%,
			var(--raised) 50%,
			var(--sunken) 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.2s linear infinite;
	}

	@keyframes shimmer {
		from {
			background-position: 200% 0;
		}
		to {
			background-position: -200% 0;
		}
	}

	.seg {
		display: block;
		height: 100%;
		transition: width var(--t);
	}

	/* One hue per kind of thing, echoed by the legend dots. Media is the live
	   colour because it is the work; the rest are supporting. */
	.seg--media,
	.dot--media {
		background: var(--live);
	}
	.seg--tracks,
	.dot--tracks {
		background: var(--mosh);
	}
	.seg--proxies,
	.dot--proxies {
		background: var(--start);
	}
	.seg--work,
	.dot--work {
		background: var(--text-2);
	}
	.seg--fonts,
	.dot--fonts {
		background: var(--text-3);
	}

	.usage-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.usage-text {
		font-size: 0.72rem;
		color: var(--text-2);
	}

	.usage-text strong {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--text);
	}

	.keep {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}

	.badge {
		padding: 0.15rem 0.45rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		font-family: var(--font-mono);
		font-size: 0.56rem;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	.badge--safe {
		border-color: var(--live-dim);
		color: var(--live);
	}

	.link-btn {
		padding: 0;
		border: none;
		background: none;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--live);
		cursor: pointer;
	}

	.link-btn:hover {
		text-decoration: underline;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 1rem;
	}

	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.66rem;
		color: var(--text-2);
	}

	.legend-item.dim {
		color: var(--text-4);
	}

	.legend-item.dim .dot {
		opacity: 0.35;
	}

	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}

	.legend-size {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--text-3);
	}

	/* ── Sections ── */

	section {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.section-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.section-title {
		font-size: 0.6rem;
		color: var(--text-3);
		letter-spacing: 0.14em;
	}

	.section-meta {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--text-4);
	}

	.rows {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		background: var(--sunken);
	}

	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		border-top: 1px solid var(--line);
	}

	.row:first-child {
		border-top: none;
	}

	.row.selectable {
		grid-template-columns: auto 1fr auto;
	}

	.row.picked {
		background: rgba(255, 255, 255, 0.035);
	}

	.row.selectable > :global(.cb) {
		margin-left: 0.6rem;
	}

	.section-head > :global(.cb) {
		margin-right: 0.1rem;
	}

	.row.selectable .row-main {
		padding-left: 0.35rem;
	}

	/* Sticks to the bottom of the scroll so the action is reachable from any
	   row, on a solid backing so rows don't show through. */
	.bulk {
		position: sticky;
		bottom: -1.25rem;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--live-dim);
		border-radius: var(--r-2);
		background: var(--raised);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}

	.bulk-text {
		font-size: 0.72rem;
		color: var(--text-2);
	}

	.bulk-text strong {
		font-family: var(--font-mono);
		font-weight: 600;
		color: var(--live);
	}

	.bulk-actions {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.bulk-actions .text-btn {
		margin: 0;
	}

	.text-btn:not(.danger):hover:not(:disabled) {
		color: var(--text);
		background: rgba(255, 255, 255, 0.06);
	}

	.row-main {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
		padding: 0.5rem 0.6rem;
		border: none;
		background: none;
		color: var(--text-2);
		font-family: inherit;
		font-size: 0.72rem;
		text-align: left;
		cursor: pointer;
	}

	.row-main:disabled,
	.row-main.static {
		cursor: default;
	}

	.row-main:not(:disabled):not(.static):hover {
		color: var(--text);
	}

	.row-main:focus-visible {
		outline: 1px solid var(--text-4);
		outline-offset: -1px;
	}

	/* Long names would otherwise crush the icons to a different width per row. */
	.row-main > :global(svg),
	.media > :global(svg) {
		flex-shrink: 0;
	}

	.chev {
		display: flex;
		flex-shrink: 0;
		color: var(--text-4);
		transition: transform var(--t-fast);
	}

	.row.open .chev {
		transform: rotate(90deg);
	}

	.chev.hidden {
		visibility: hidden;
	}

	.row-name,
	.row-main :global(.row-name) {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}

	/* Rename and delete share the row's one action column. */
	.row-actions {
		display: flex;
	}

	.row-actions .icon-btn:not(:last-child) {
		margin-right: 0;
	}

	.modes {
		display: inline-flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}

	/* Mode chips borrow the upload screen's mode colours: the editor is the
	   generative mode, single and slideshow sit in neutral. */
	.mode {
		padding: 0.1rem 0.35rem;
		border-radius: var(--r-1);
		font-family: var(--font-mono);
		font-size: 0.54rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-3);
	}

	.mode--sequence {
		background: color-mix(in srgb, var(--mosh) 16%, transparent);
		color: var(--mosh);
	}

	.row-meta {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--text-3);
		white-space: nowrap;
	}

	.sep {
		margin: 0 0.15rem;
		color: var(--text-4);
	}

	.row-when,
	.row-hint {
		flex-shrink: 0;
		min-width: 3.5rem;
		font-size: 0.62rem;
		color: var(--text-4);
		text-align: right;
		white-space: nowrap;
	}

	.row-hint {
		min-width: 0;
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-right: 0.35rem;
		padding: 0.35rem;
		border: none;
		border-radius: var(--r-1);
		background: none;
		color: var(--text-4);
		cursor: pointer;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.icon-btn:hover:not(:disabled) {
		color: var(--text);
		background: rgba(255, 255, 255, 0.06);
	}

	.icon-btn.danger:hover:not(:disabled) {
		color: var(--rec);
		background: rgba(255, 95, 86, 0.12);
	}

	.text-btn {
		margin-right: 0.5rem;
		padding: 0.25rem 0.55rem;
		border: 1px solid transparent;
		border-radius: var(--r-2);
		background: none;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-3);
		cursor: pointer;
		transition:
			color var(--t-fast),
			background var(--t-fast),
			border-color var(--t-fast);
	}

	.text-btn.danger:hover:not(:disabled) {
		color: var(--rec);
		background: rgba(255, 95, 86, 0.12);
	}

	.text-btn.outline {
		margin: 0;
		border-color: var(--line-strong);
	}

	.text-btn.outline.danger:hover:not(:disabled) {
		border-color: var(--rec-dim);
	}

	.icon-btn:disabled,
	.text-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* ── Expanded media ── */

	.media-list {
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0.15rem 0.6rem 0.5rem 2.1rem;
		list-style: none;
		max-height: 190px;
		overflow-y: auto;
	}

	.media {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		padding: 0.2rem 0;
		font-size: 0.66rem;
		color: var(--text-3);
	}

	.media-name {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-2);
	}

	.shared {
		padding: 0 0.3rem;
		border-radius: var(--r-1);
		background: rgba(255, 255, 255, 0.06);
		font-family: var(--font-mono);
		font-size: 0.52rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-4);
	}

	.media-size {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		color: var(--text-4);
	}

	.proxy-size {
		color: var(--start-dim);
	}

	/* ── Footer ── */

	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-top: 0.5rem;
		border-top: 1px solid var(--line);
	}

	@media (max-width: 640px) {
		.row-when,
		.row-hint {
			display: none;
		}
	}
</style>
