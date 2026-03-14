<script lang="ts">
	import { ChevronRight, ChevronLeft, Plus, Play, Pause, X } from 'lucide-svelte';
	import { onDestroy, onMount } from 'svelte';
	import {
		addTrack,
		deleteTrack,
		getAllTracks,
		type StoredTrack,
	} from '../../audio/track-library';

	interface Props {
		activeTrackName: string | null;
		activeTrackId?: string | null;
		onLoadTrack: (file: File, trackId: string) => void;
		onPreviewStart?: () => void;
		mainPlaying?: boolean;
		pendingTrack?: File | null;
		onNormalizeChange?: (gain: number) => void;
	}

	let {
		activeTrackName,
		activeTrackId = null,
		onLoadTrack,
		onPreviewStart,
		mainPlaying = false,
		pendingTrack = null,
		onNormalizeChange,
	}: Props = $props();

	const OPEN_KEY = 'openmosh-library-open';
	let open = $state(localStorage.getItem(OPEN_KEY) === 'true');
	let tracks = $state<StoredTrack[]>([]);
	let libraryLoaded = $state(false);
	let previewId = $state<string | null>(null);
	let previewEl = $state<HTMLAudioElement | null>(null);
	let fileInput: HTMLInputElement;
	let libraryEl: HTMLDivElement;

	$effect(() => {
		localStorage.setItem(OPEN_KEY, String(open));
	});

	// Stop library preview when main player starts
	$effect(() => {
		if (mainPlaying && previewId !== null) stopPreview();
	});

	// Auto-add manually loaded tracks to the library
	$effect(() => {
		const f = pendingTrack;
		if (!f || !libraryLoaded) return;
		if (tracks.some((t) => t.name === f.name)) return;
		addTrack(f)
			.then((track) => {
				tracks = [...tracks, track];
			})
			.catch((e) => console.error('Failed to auto-save track:', e));
	});

	onMount(async () => {
		try {
			const loaded = await getAllTracks();
			tracks = loaded.sort((a, b) => a.addedAt - b.addedAt);
		} catch (e) {
			console.error('Failed to load tracks:', e);
		} finally {
			libraryLoaded = true;
		}
	});

	onMount(() => {
		function onPointerDown(e: PointerEvent) {
			if (open && libraryEl && !libraryEl.contains(e.target as Node)) {
				open = false;
			}
		}
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	});

	onDestroy(() => stopPreview());

	async function onFileChange() {
		const f = fileInput?.files?.[0];
		if (!f) return;
		fileInput.value = '';
		try {
			const track = await addTrack(f);
			tracks = [...tracks, track];
		} catch (e) {
			console.error('Failed to save track:', e);
		}
	}

	async function onDelete(id: string) {
		if (previewId === id) stopPreview();
		try {
			await deleteTrack(id);
			tracks = tracks.filter((t) => t.id !== id);
		} catch (e) {
			console.error('Failed to delete track:', e);
		}
	}

	function onLoad(track: StoredTrack) {
		stopPreview();
		onLoadTrack(
			new File([track.blob], track.name, { type: track.blob.type }),
			track.id,
		);
	}

	function togglePreview(track: StoredTrack) {
		if (previewId === track.id) {
			stopPreview();
		} else {
			stopPreview();
			onPreviewStart?.();
			previewId = track.id;
			if (previewEl) {
				previewEl.src = URL.createObjectURL(track.blob);
				previewEl.play();
			}
		}
	}

	function stopPreview() {
		if (previewEl) {
			const src = previewEl.src;
			previewEl.pause();
			previewEl.src = '';
			if (src) URL.revokeObjectURL(src);
		}
		previewId = null;
	}
</script>

<audio bind:this={previewEl} onended={stopPreview} hidden></audio>

<input
	bind:this={fileInput}
	type="file"
	accept="audio/*"
	onchange={onFileChange}
	hidden
/>

<div class="library" class:open bind:this={libraryEl}>
	<!-- Always in flow: the 28px expand strip -->
	<button
		class="expand-btn"
		onclick={() => (open = true)}
		title="Open track library"
	>
		<ChevronRight size={12} />
	</button>

	<!-- Overlay panel: slides in on top of the expand strip -->
	<div class="panel" aria-hidden={!open} inert={!open || undefined}>
		<div class="header">
			<span class="title">Tracks Library</span>
			<button
				class="add-btn"
				onclick={() => fileInput.click()}
				title="Add track"
			>
				<Plus size={12} />
			</button>
			<button
				class="collapse-btn"
				onclick={() => (open = false)}
				title="Collapse library"
			>
				<ChevronLeft size={12} />
			</button>
		</div>

		{#if tracks.length === 0}
			<div class="empty">No tracks yet.<br />Click + to add.</div>
		{:else}
			<ul class="track-list">
				{#each tracks as track (track.id)}
					{@const isActive = track.name === activeTrackName}
					{@const isPreviewing = previewId === track.id}
					<li class="track-row" class:active={isActive}>
						<button
							class="preview-btn"
							onclick={() => togglePreview(track)}
							title={isPreviewing ? 'Stop' : 'Preview'}
						>
							{#if isPreviewing}
								<Pause size={10} fill="currentColor" stroke="none" />
							{:else}
								<Play size={10} fill="currentColor" stroke="none" />
							{/if}
						</button>
						<button
							class="name-btn"
							onclick={() => onLoad(track)}
							title="Load track"
						>
							{track.name}
						</button>
						<button
							class="delete-btn"
							onclick={() => onDelete(track.id)}
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

<style>
	.library {
		position: relative;
		flex-shrink: 0;
		width: 28px;
		border-right: 1px solid #2a2a2a;
		background: #141414;
	}

	.expand-btn {
		width: 100%;
		height: 100%;
		background: none;
		border: none;
		color: #444;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		z-index: 1;
	}

	.expand-btn:hover {
		color: #888;
		background: #1a1a1a;
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
		background: #141414;
		border-right: 1px solid #2a2a2a;
		transform: translateX(-100%);
		transition: transform 0.15s ease;
	}

	.library.open .panel {
		transform: translateX(0);
	}

	.header {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.5rem 0.5rem 0.4rem 0.6rem;
		border-bottom: 1px solid #222;
		flex-shrink: 0;
	}

	.title {
		flex: 1;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #888;
		text-transform: uppercase;
	}

	.add-btn,
	.collapse-btn {
		background: none;
		border: none;
		color: #555;
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
		border: 1px solid #333;
	}

	.add-btn:hover {
		color: #ccc;
		border-color: #555;
	}

	.collapse-btn:hover {
		color: #aaa;
		background: #1e1e1e;
	}

	.empty {
		padding: 1rem 0.8rem;
		font-size: 0.65rem;
		color: #555;
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
		background: #1e1e1e;
	}

	.track-row.active {
		background: #1a2a1a;
	}

	.preview-btn,
	.delete-btn {
		flex-shrink: 0;
		background: none;
		border: none;
		color: #666;
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 2px;
	}

	.preview-btn:hover {
		color: #aaa;
	}
	.delete-btn:hover {
		color: #e06060;
	}

	.name-btn {
		flex: 1;
		background: none;
		border: none;
		color: #bbb;
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
		color: #eee;
	}
</style>
