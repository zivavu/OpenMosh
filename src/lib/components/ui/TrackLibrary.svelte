<script lang="ts">
	import {
		AudioLines,
		ChevronLeft,
		Library,
		Pause,
		Play,
		Plus,
		X,
	} from 'lucide-svelte';
	import { onDestroy, onMount } from 'svelte';
	import { computeNormalizeGain, measureLoudness } from '../../audio/loudness';
	import { decodeAudioFile } from '../../audio/offline-audio';
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

	const NORMALIZE_KEY = 'openmosh-library-normalize';
	let normalizedIds = $state<Set<string>>(
		new Set(JSON.parse(localStorage.getItem(NORMALIZE_KEY) ?? '[]')),
	);
	// Not $state — only used internally, never read in template directly
	let gainCache = new Map<string, number>();
	let measuringIds = $state<Set<string>>(new Set());

	$effect(() => {
		localStorage.setItem(NORMALIZE_KEY, JSON.stringify([...normalizedIds]));
	});

	let previewCtx: AudioContext | null = null;
	let previewGain: GainNode | null = null;
	let previewSource: MediaElementAudioSourceNode | null = null;

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
				autoNormalize(track);
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

	export function openLibrary() {
		open = true;
	}

	onMount(() => {
		function onPointerDown(e: PointerEvent) {
			if (open && libraryEl && !libraryEl.contains(e.target as Node)) {
				open = false;
			}
		}
		document.addEventListener('pointerdown', onPointerDown);
		return () => document.removeEventListener('pointerdown', onPointerDown);
	});

	onDestroy(() => {
		stopPreview();
		previewCtx?.close();
		previewCtx = null;
		previewGain = null;
		previewSource = null;
	});

	// Start normalize measurement for a newly added track (fire-and-forget).
	function autoNormalize(track: StoredTrack) {
		normalizedIds = new Set([...normalizedIds, track.id]);
		if (!gainCache.has(track.id)) {
			measuringIds = new Set([...measuringIds, track.id]);
			const file = new File([track.blob], track.name, {
				type: track.blob.type,
			});
			decodeAudioFile(file)
				.then((buffer) => {
					const db = measureLoudness(buffer);
					const gain = computeNormalizeGain(db);
					gainCache.set(track.id, gain);
					if (track.id === activeTrackId) onNormalizeChange?.(gain);
					if (previewId === track.id && previewGain)
						previewGain.gain.value = gain;
				})
				.catch((e) => {
					console.error('Failed to measure track loudness:', e);
					normalizedIds = new Set(
						[...normalizedIds].filter((x) => x !== track.id),
					);
				})
				.finally(() => {
					measuringIds = new Set(
						[...measuringIds].filter((x) => x !== track.id),
					);
				});
		}
	}

	async function onFileChange() {
		const f = fileInput?.files?.[0];
		if (!f) return;
		fileInput.value = '';
		try {
			const track = await addTrack(f);
			tracks = [...tracks, track];
			autoNormalize(track);
		} catch (e) {
			console.error('Failed to save track:', e);
		}
	}

	async function onDelete(id: string) {
		if (previewId === id) stopPreview();
		try {
			await deleteTrack(id);
			tracks = tracks.filter((t) => t.id !== id);
			normalizedIds = new Set([...normalizedIds].filter((x) => x !== id));
			gainCache.delete(id);
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
		// Communicate normalize gain to editor.
		// If normalized but gain not yet cached (measurement in flight), emit 1.0 for now.
		// The in-flight toggleNormalize will call onNormalizeChange once measurement completes,
		// provided activeTrackId is updated synchronously by onLoadTrack (which it is in Editor.svelte).
		const gain = normalizedIds.has(track.id)
			? (gainCache.get(track.id) ?? 1.0)
			: 1.0;
		onNormalizeChange?.(gain);
	}

	function togglePreview(track: StoredTrack) {
		if (previewId === track.id) {
			stopPreview();
		} else {
			stopPreview();
			onPreviewStart?.();
			previewId = track.id;
			if (previewEl) {
				// Lazily create audio graph — AT MOST ONCE per component lifetime.
				// createMediaElementSource can only be called once per element per AudioContext.
				// Source and gain node persist across all preview cycles; only gain.value changes.
				if (!previewCtx) {
					previewCtx = new AudioContext();
					previewSource = previewCtx.createMediaElementSource(previewEl);
					previewGain = previewCtx.createGain();
					previewSource.connect(previewGain);
					previewGain.connect(previewCtx.destination);
				}
				// Set gain for this track
				if (previewGain) {
					const gain =
						normalizedIds.has(track.id) && gainCache.has(track.id)
							? gainCache.get(track.id)!
							: 1.0;
					previewGain.gain.value = gain;
				}
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

	async function toggleNormalize(track: StoredTrack) {
		if (normalizedIds.has(track.id)) {
			// Turn off
			normalizedIds = new Set([...normalizedIds].filter((x) => x !== track.id));
			if (track.id === activeTrackId) onNormalizeChange?.(1.0);
			if (previewId === track.id && previewGain) previewGain.gain.value = 1.0;
			return;
		}

		// Turn on — measure if not cached
		normalizedIds = new Set([...normalizedIds, track.id]);
		measuringIds = new Set([...measuringIds, track.id]);

		try {
			if (!gainCache.has(track.id)) {
				const file = new File([track.blob], track.name, {
					type: track.blob.type,
				});
				const buffer = await decodeAudioFile(file);
				const db = measureLoudness(buffer);
				const gain = computeNormalizeGain(db);
				gainCache.set(track.id, gain);
			}
			const gain = gainCache.get(track.id)!;
			if (track.id === activeTrackId) onNormalizeChange?.(gain);
			if (previewId === track.id && previewGain) previewGain.gain.value = gain;
		} catch (e) {
			console.error('Failed to measure track loudness:', e);
			// Roll back: remove from normalizedIds
			normalizedIds = new Set([...normalizedIds].filter((x) => x !== track.id));
		} finally {
			measuringIds = new Set([...measuringIds].filter((x) => x !== track.id));
		}
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
		<Library size={14} />
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
							class="normalize-btn"
							class:active={normalizedIds.has(track.id)}
							class:measuring={measuringIds.has(track.id)}
							disabled={measuringIds.has(track.id)}
							onclick={() => toggleNormalize(track)}
							title={normalizedIds.has(track.id)
								? 'Remove normalization'
								: 'Normalize to -14 LUFS'}
						>
							<AudioLines size={10} />
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

	.normalize-btn {
		flex-shrink: 0;
		background: none;
		border: none;
		color: #555;
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
		color: #aaa;
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
