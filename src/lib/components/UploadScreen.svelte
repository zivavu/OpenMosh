<script lang="ts">
  interface Props {
    onfile: (file: File) => void;
  }

  let { onfile }: Props = $props();

  let dragging = $state(false);
  let fileInput: HTMLInputElement;

  const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'];

  function handleFile(file: File) {
    if (ACCEPTED_TYPES.includes(file.type)) {
      onfile(file);
    }
  }

  function onDrop(e: DragEvent) {
    dragging = false;
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  }

  function onDragOver(e: DragEvent) {
    dragging = true;
  }

  function onDragLeave(e: DragEvent) {
    if (e.currentTarget instanceof HTMLElement && !e.currentTarget.contains(e.relatedTarget as Node)) {
      dragging = false;
    }
  }

  function onInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleFile(file);
  }

  function openFilePicker() {
    fileInput.click();
  }
</script>

<div class="upload-screen">
  <div class="hero">
    <h1 class="title">OpenMosh</h1>
    <p class="subtitle">Open-source image & video glitching in the browser.</p>
  </div>

  <div
    class="drop-zone"
    class:dragging
    role="button"
    tabindex="0"
    ondrop={(e) => { e.preventDefault(); onDrop(e); }}
    ondragover={(e) => { e.preventDefault(); onDragOver(e); }}
    ondragleave={onDragLeave}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openFilePicker(); }}
  >
    <input
      bind:this={fileInput}
      type="file"
      accept={ACCEPTED_TYPES.join(',')}
      onchange={onInputChange}
      hidden
    />

    <button class="load-btn" onclick={openFilePicker}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      LOAD FILE
    </button>

    <div class="separator">
      <span class="line"></span>
      <span class="or">OR</span>
      <span class="line"></span>
    </div>

    <div class="drop-hint">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      DRAG AND DROP FILE HERE
    </div>
  </div>
</div>

<style>
  .upload-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 2.5rem;
    padding: 2rem;
  }

  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .title {
    font-size: clamp(2.5rem, 6vw, 4.5rem);
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #fff;
    line-height: 1;
  }

  .subtitle {
    font-size: 0.95rem;
    color: #666;
    font-weight: 400;
  }

  .drop-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    padding: 2.5rem 3rem;
    border: 1.5px dashed #333;
    border-radius: 12px;
    width: 100%;
    max-width: 520px;
    transition: border-color 0.2s, background-color 0.2s;
    cursor: pointer;
    outline: none;
  }

  .drop-zone:hover,
  .drop-zone:focus-visible {
    border-color: #555;
  }

  .drop-zone.dragging {
    border-color: #888;
    background-color: rgba(255, 255, 255, 0.03);
  }

  .load-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.7rem 2rem;
    border: 1.5px solid #444;
    border-radius: 999px;
    background: transparent;
    color: #ccc;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s, background-color 0.2s;
    font-family: inherit;
  }

  .load-btn:hover {
    border-color: #888;
    color: #fff;
    background-color: rgba(255, 255, 255, 0.05);
  }

  .separator {
    display: flex;
    align-items: center;
    gap: 1rem;
    width: 100%;
  }

  .line {
    flex: 1;
    height: 1px;
    background: #2a2a2a;
  }

  .or {
    font-size: 0.7rem;
    color: #555;
    letter-spacing: 0.05em;
    font-weight: 500;
  }

  .drop-hint {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: #555;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.08em;
  }
</style>
