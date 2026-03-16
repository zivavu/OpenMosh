<script lang="ts">
  import { Music } from 'lucide-svelte';

  interface Props {
    onOpenPicker: () => void;
    hintText?: string;
  }

  let {
    onOpenPicker,
    hintText = 'Add music to sync transitions to the beat',
  }: Props = $props();

  const MUSIC_HINT_KEY = 'openmosh-music-hint-dismissed';

  let showMusicHint = $state(!localStorage.getItem(MUSIC_HINT_KEY));

  function dismissMusicHint() {
    localStorage.setItem(MUSIC_HINT_KEY, '1');
    showMusicHint = false;
  }
</script>

<div class="track-add-bar">
  <button class="track-add-btn" onclick={onOpenPicker}>
    <Music size={14} />
    Add audio track
  </button>
</div>
{#if showMusicHint}
  <div class="music-hint-callout">
    <span>{hintText}</span>
    <button
      class="music-hint-dismiss"
      onclick={dismissMusicHint}
      aria-label="Dismiss">&#x2715;</button
    >
  </div>
{/if}

<style>
  .track-add-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 0.35rem 0.75rem;
    background: rgba(18, 18, 18, 0.9);
    border-top: 1px solid #2a2a2a;
  }

  .track-add-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.7rem;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    font-family: inherit;
    background: none;
    border: 1px solid #333;
    border-radius: 5px;
    color: #666;
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .track-add-btn:hover {
    color: #aaa;
    border-color: #555;
  }

  .music-hint-callout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    background: rgba(255, 255, 255, 0.02);
    border-top: 1px solid #222;
    font-size: 0.68rem;
    color: #555;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .music-hint-dismiss {
    background: none;
    border: none;
    color: #444;
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0;
    flex-shrink: 0;
    line-height: 1;
  }

  .music-hint-dismiss:hover {
    color: #888;
  }
</style>
