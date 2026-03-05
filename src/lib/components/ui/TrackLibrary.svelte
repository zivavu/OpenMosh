<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { addTrack, deleteTrack, getAllTracks, type StoredTrack } from '../../audio/track-library';

  interface Props {
    activeTrackName: string | null;
    onLoadTrack: (file: File) => void;
  }

  let { activeTrackName, onLoadTrack }: Props = $props();

  const OPEN_KEY = 'openmosh-library-open';
  let open = $state(localStorage.getItem(OPEN_KEY) !== 'false');
  let tracks = $state<StoredTrack[]>([]);
  let previewId = $state<string | null>(null);
  let previewEl = $state<HTMLAudioElement | null>(null);
  let fileInput: HTMLInputElement;

  $effect(() => {
    localStorage.setItem(OPEN_KEY, String(open));
  });

  onMount(async () => {
    try {
      const loaded = await getAllTracks();
      tracks = loaded.sort((a, b) => a.addedAt - b.addedAt);
    } catch (e) {
      console.error('Failed to load tracks:', e);
    }
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
    onLoadTrack(new File([track.blob], track.name, { type: track.blob.type }));
  }

  function togglePreview(track: StoredTrack) {
    if (previewId === track.id) {
      stopPreview();
    } else {
      stopPreview();
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

<input bind:this={fileInput} type="file" accept="audio/*" onchange={onFileChange} hidden />

<div class="library" class:open>
  <button class="toggle" onclick={() => (open = !open)} title={open ? 'Close library' : 'Open track library'}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      {#if open}
        <polyline points="15 18 9 12 15 6" />
      {:else}
        <polyline points="9 18 15 12 9 6" />
      {/if}
    </svg>
  </button>

  {#if open}
    <div class="panel">
      <div class="header">
        <span class="title">Library</span>
        <button class="add-btn" onclick={() => fileInput.click()} title="Add track">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
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
              <button class="preview-btn" onclick={() => togglePreview(track)} title={isPreviewing ? 'Stop' : 'Preview'}>
                {#if isPreviewing}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="6" height="16"/><rect x="14" y="4" width="6" height="16"/></svg>
                {:else}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5,3 19,12 5,21"/></svg>
                {/if}
              </button>
              <button class="name-btn" onclick={() => onLoad(track)} title="Load track">
                {track.name}
              </button>
              <button class="delete-btn" onclick={() => onDelete(track.id)} title="Remove">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .library {
    position: relative;
    display: flex;
    flex-direction: row;
    flex-shrink: 0;
    border-right: 1px solid #2a2a2a;
    background: #141414;
    transition: width 0.15s ease;
    width: 28px;
  }

  .library.open {
    width: 220px;
  }

  .toggle {
    position: absolute;
    right: -1px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    width: 16px;
    height: 40px;
    background: #1e1e1e;
    border: 1px solid #2a2a2a;
    border-left: none;
    border-radius: 0 4px 4px 0;
    color: #666;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .toggle:hover {
    color: #aaa;
    background: #252525;
  }

  .panel {
    width: 220px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
    flex: 1;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.6rem 0.4rem;
    border-bottom: 1px solid #222;
    flex-shrink: 0;
  }

  .title {
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #888;
    text-transform: uppercase;
  }

  .add-btn {
    background: none;
    border: 1px solid #333;
    border-radius: 3px;
    color: #777;
    cursor: pointer;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .add-btn:hover {
    color: #ccc;
    border-color: #555;
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

  .preview-btn:hover { color: #aaa; }
  .delete-btn:hover { color: #e06060; }

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
