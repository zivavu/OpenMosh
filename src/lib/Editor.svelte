<script lang="ts">
  import GlCanvas from './GlCanvas.svelte';
  import EffectsPanel from './EffectsPanel.svelte';
  import {
    EFFECT_DEFINITIONS,
    createEffectInstance,
    type EffectInstance,
  } from './effects';

  interface Props {
    file: File;
    onBack: () => void;
    onfile: (f: File) => void;
  }

  let { file, onBack, onfile }: Props = $props();
  let dragging = $state(false);

  let format: 'png' | 'jpg' = $state('png');
  let imageSrc = $derived(URL.createObjectURL(file));
  let canvasEl: HTMLCanvasElement | null = $state(null);
  let effects: EffectInstance[] = $state(
    EFFECT_DEFINITIONS.map(createEffectInstance),
  );

  function mosh() {
    const enableChance = 0.25 + Math.random() * 0.25;
    for (const effect of effects) {
      if (effect.locked) continue;
      const def = EFFECT_DEFINITIONS.find((d) => d.id === effect.defId);
      if (!def) continue;
      effect.enabled = Math.random() < enableChance;
      if (!effect.enabled) continue;
      for (const param of def.params) {
        if (param.type === 'range') {
          const range = param.max - param.min;
          const bias = 0.15 + Math.random() * 0.55;
          effect.values[param.key] =
            Math.round((param.min + bias * range) / param.step) * param.step;
        } else if (param.type === 'select') {
          const options = param.options;
          effect.values[param.key] =
            options[Math.floor(Math.random() * options.length)].value;
        }
      }
    }
  }

  function save() {
    if (!canvasEl) return;
    const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const ext = format === 'jpg' ? 'jpg' : 'png';
    canvasEl.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `openmosh-${Date.now()}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    }, mimeType, format === 'jpg' ? 0.92 : undefined);
  }
</script>

<div
  class="editor"
  class:drag-over={dragging}
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragenter={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={(e) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) dragging = false;
  }}
  ondrop={(e) => {
    e.preventDefault();
    dragging = false;
    const f = e.dataTransfer?.files[0];
    if (f && f.type.startsWith('image/')) onfile(f);
  }}
>
  <div class="main-area">
    <div class="toolbar">
      <button class="back-btn" onclick={onBack} title="Load different file">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      </button>
      <div class="format-group">
        <button
          class="format-btn"
          class:active={format === 'png'}
          onclick={() => (format = 'png')}
        >
          PNG
        </button>
        <button
          class="format-btn"
          class:active={format === 'jpg'}
          onclick={() => (format = 'jpg')}
        >
          JPG
        </button>
      </div>
    </div>

    <GlCanvas {imageSrc} {effects} bind:canvasEl />

    <div class="action-bar">
      <button class="action-btn mosh-btn" onclick={mosh}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        MOSH
      </button>
      <button class="action-btn save-btn" onclick={save}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        SAVE
      </button>
    </div>
  </div>

  <EffectsPanel bind:effects />

  {#if dragging}
    <div class="drop-overlay">
      <span>Drop image to replace</span>
    </div>
  {/if}
</div>

<style>
  .editor {
    display: flex;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    position: relative;
    min-width: 0;
  }

  /* Toolbar */
  .toolbar {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: rgba(30, 30, 30, 0.85);
    border: 1px solid #333;
    border-radius: 6px;
    color: #aaa;
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s;
  }

  .back-btn:hover {
    color: #fff;
    border-color: #555;
  }

  .format-group {
    display: flex;
    background: rgba(30, 30, 30, 0.85);
    border: 1px solid #333;
    border-radius: 6px;
    overflow: hidden;
  }

  .format-btn {
    padding: 0.35rem 0.9rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    font-family: inherit;
    background: none;
    border: none;
    color: #777;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .format-btn:not(:last-child) {
    border-right: 1px solid #333;
  }

  .format-btn.active {
    color: #ddd;
    background: rgba(255, 255, 255, 0.06);
  }

  .format-btn:hover {
    color: #ccc;
  }

  /* Action bar */
  .action-bar {
    display: flex;
    justify-content: center;
    gap: 0.75rem;
    padding: 1rem;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 2rem;
    border: 1.5px solid #444;
    border-radius: 999px;
    background: transparent;
    color: #ccc;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s, background 0.2s;
  }

  .action-btn:hover {
    border-color: #888;
    color: #fff;
    background: rgba(255, 255, 255, 0.04);
  }

  .mosh-btn:hover {
    border-color: #a89050;
    color: #f0d878;
  }

  .editor.drag-over::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 99;
    border: 2px dashed #888;
    border-radius: 8px;
    pointer-events: none;
  }

  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    pointer-events: none;
  }

  .drop-overlay span {
    font-size: 1.2rem;
    font-weight: 600;
    color: #ccc;
    letter-spacing: 0.04em;
  }
</style>
