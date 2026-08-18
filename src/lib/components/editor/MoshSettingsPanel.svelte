<script lang="ts">
   import { CircleQuestionMark } from "lucide-svelte";
   import { DEFAULT_SETTINGS } from "../../editor/settings";
   import type { FreqBand } from "../../effects";
   import BpmControl from "../ui/BpmControl.svelte";
   import RangeSlider from "../ui/RangeSlider.svelte";

   /** Id of the row whose help popover is open, if any. */
   let openHelp = $state<string | null>(null);

   /** Mirrors the per-param Freq row on a linked effect. */
   const BANDS = [
      { id: "full", label: "Full", title: "Full spectrum (20–16k Hz)" },
      { id: "low", label: "Low", title: "Low (20–500 Hz)" },
      { id: "mid", label: "Mid", title: "Mid (500–4000 Hz)" },
      { id: "high", label: "High", title: "High (4k–16k Hz)" },
   ] as const satisfies { id: FreqBand; label: string; title: string }[];

   interface Props {
      moshMin: number;
      moshMax: number;
      randomizeOrder: boolean;
      moshAudioLink: boolean;
      moshAudioLinkStrength: number;
      moshLinkBand: FreqBand;
      autoRangeAmount: number;
      audioSmoothing: number;
      audioPunch: number;
      hasAudio: boolean;
      /** Name of the fx lane these settings belong to, when one is selected.
       * Null = the editor's own settings, which segments and single mode use. */
      targetLabel?: string | null;
      /** Sequence mode only: the tempo the AUTO segments re-roll against. */
      showTiming?: boolean;
      bpm?: number;
      bpmDetecting?: boolean;
      hasTrack?: boolean;
      onDetectBpm?: () => void;
      onBpmChange?: (bpm: number) => void;
   }

   let {
      moshMin = $bindable(),
      moshMax = $bindable(),
      randomizeOrder = $bindable(),
      moshAudioLink = $bindable(),
      moshAudioLinkStrength = $bindable(),
      moshLinkBand = $bindable(),
      autoRangeAmount = $bindable(),
      audioSmoothing = $bindable(),
      audioPunch = $bindable(),
      hasAudio,
      targetLabel = null,
      showTiming = false,
      bpm = 0,
      bpmDetecting = false,
      hasTrack = false,
      onDetectBpm,
      onBpmChange,
   }: Props = $props();

   /**
    * Double-clicking a row — its label, its slider, its checkbox — puts that
    * setting back to its default. Bound on the row rather than the control so
    * the label works too; text fields keep double-click-to-select-a-word.
    */
   function resetRow(e: MouseEvent, reset: () => void) {
      const t = e.target as HTMLElement | null;
      if (t?.closest("button, input[type='number'], input[type='text'], textarea"))
         return;
      reset();
   }
</script>

<svelte:window
   onkeydown={(e) => {
      if (e.key === "Escape") openHelp = null;
   }}
   onpointerdown={(e) => {
      if (!openHelp) return;
      // The toggle counts as "inside" only so its own click toggles rather than
      // fights this handler.
      if ((e.target as HTMLElement).closest?.(".help-toggle, .help-popover"))
         return;
      openHelp = null;
   }}
/>

{#snippet helpToggle(id: string, label: string)}
   <button
      class="help-toggle"
      class:active={openHelp === id}
      onclick={() => (openHelp = openHelp === id ? null : id)}
      aria-expanded={openHelp === id}
      aria-label={label}
   >
      <CircleQuestionMark size={13} />
   </button>
{/snippet}

{#snippet helpBody(id: string, paras: { term?: string; text: string }[])}
   {#if openHelp === id}
      <div class="help-popover" role="tooltip">
         {#each paras as p}
            <p>
               {#if p.term}<strong>{p.term}</strong>:
               {/if}{p.text}
            </p>
         {/each}
      </div>
   {/if}
{/snippet}

<div class="config-panel">
   {#if showTiming}
      <h3 class="panel-title">Timing</h3>
      <BpmControl
         id="seq-bpm"
         {bpm}
         onBpmChange={(v) => onBpmChange?.(v)}
         {bpmDetecting}
         {hasTrack}
         {onDetectBpm}
      />
      <h3 class="panel-title section-title">Mosh settings</h3>
   {:else}
      <h3 class="panel-title">Mosh settings</h3>
   {/if}
   {#if targetLabel}
      <p class="scope-note">
         Editing <strong>{targetLabel}</strong> — its own mosh and audio
         settings.
      </p>
   {/if}
   <!-- svelte-ignore a11y_no_static_element_interactions -->
   <div
      class="config-row"
      title="Double-click to reset"
      ondblclick={(e) =>
         resetRow(e, () => {
            moshMin = DEFAULT_SETTINGS.moshMin;
            if (moshMax < moshMin) moshMax = moshMin;
         })}
   >
      <label for="mosh-min">Min effects</label>
      <RangeSlider
         id="mosh-min"
         bind:value={moshMin}
         min={1}
         max={20}
         step={1}
         oninput={(v) => {
            if (moshMax < v) moshMax = v;
         }}
      />
      <span class="val">{moshMin}</span>
   </div>
   <!-- svelte-ignore a11y_no_static_element_interactions -->
   <div
      class="config-row"
      title="Double-click to reset"
      ondblclick={(e) =>
         resetRow(e, () => {
            moshMax = DEFAULT_SETTINGS.moshMax;
            if (moshMin > moshMax) moshMin = moshMax;
         })}
   >
      <label for="mosh-max">Max effects</label>
      <RangeSlider
         id="mosh-max"
         bind:value={moshMax}
         min={1}
         max={20}
         step={1}
         oninput={(v) => {
            if (moshMin > v) moshMin = v;
         }}
      />
      <span class="val">{moshMax}</span>
   </div>
   <!-- svelte-ignore a11y_no_static_element_interactions -->
   <div
      class="config-row"
      title="Double-click to reset"
      ondblclick={(e) =>
         resetRow(e, () => (randomizeOrder = DEFAULT_SETTINGS.randomizeOrder))}
   >
      <label for="mosh-shuffle">Shuffle effects order</label>
      <input id="mosh-shuffle" type="checkbox" bind:checked={randomizeOrder} />
   </div>
   {#if hasAudio}
      <h3 class="panel-title section-title">Random audio links</h3>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
         class="config-row"
         title="Double-click to reset"
         ondblclick={(e) =>
            resetRow(e, () => (moshAudioLink = DEFAULT_SETTINGS.moshAudioLink))}
      >
         <label for="mosh-audio-link">Link on mosh</label>
         <input
            id="mosh-audio-link"
            type="checkbox"
            bind:checked={moshAudioLink}
         />
      </div>
   {/if}
   {#if hasAudio && moshAudioLink}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
         class="config-row"
         title="Double-click to reset"
         ondblclick={(e) =>
            resetRow(
               e,
               () =>
                  (moshAudioLinkStrength = DEFAULT_SETTINGS.moshAudioLinkStrength),
            )}
      >
         <label for="mosh-audio-link-strength">Strength</label>
         <RangeSlider
            id="mosh-audio-link-strength"
            bind:value={moshAudioLinkStrength}
            min={0}
            max={1}
            step={0.05}
         />
         <span class="val">{Math.round(moshAudioLinkStrength * 100)}%</span>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
         class="config-row"
         title="Double-click to reset"
         ondblclick={(e) =>
            resetRow(e, () => (moshLinkBand = DEFAULT_SETTINGS.moshLinkBand))}
      >
         <span class="row-label">Freq</span>
         <div class="band-presets" role="group" aria-label="Link frequency band">
            {#each BANDS as band}
               <button
                  type="button"
                  class="band-btn"
                  class:active={moshLinkBand === band.id}
                  title={band.title}
                  onclick={() => (moshLinkBand = band.id)}>{band.label}</button
               >
            {/each}
         </div>
      </div>
   {/if}
   <!-- Not gated on moshAudioLink: these shape every link, hand-made ones too. -->
   {#if hasAudio}
      <h3 class="panel-title section-title">Audio response</h3>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
         class="config-row help-row"
         title="Double-click to reset"
         ondblclick={(e) =>
            resetRow(e, () => (autoRangeAmount = DEFAULT_SETTINGS.autoRangeAmount))}
      >
         <label for="auto-range-amount">Auto-range</label>
         {@render helpToggle("auto-range", "What is auto-range?")}
         <RangeSlider
            id="auto-range-amount"
            bind:value={autoRangeAmount}
            min={0}
            max={1}
            step={0.05}
         />
         <span class="val">{Math.round(autoRangeAmount * 100)}%</span>
         {@render helpBody("auto-range", [
            {
               text: "How far apart the quiet and loud parts of a track are pushed before effects see them.",
            },
            {
               term: "Low",
               text: "effects follow the real volume. Most music sits at a steady level, so they barely move.",
            },
            {
               term: "High",
               text: "the last few seconds get stretched across your whole range. Drops hit harder, but quiet parts come up too.",
            },
         ])}
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
         class="config-row help-row"
         title="Double-click to reset"
         ondblclick={(e) =>
            resetRow(e, () => (audioSmoothing = DEFAULT_SETTINGS.audioSmoothing))}
      >
         <label for="audio-smoothing">Smoothing</label>
         {@render helpToggle("smoothing", "What is smoothing?")}
         <RangeSlider
            id="audio-smoothing"
            bind:value={audioSmoothing}
            min={0}
            max={1}
            step={0.05}
         />
         <span class="val">{Math.round(audioSmoothing * 100)}%</span>
         {@render helpBody("smoothing", [
            {
               text: "How fast an effect drops back after a hit. Hits are always caught quickly, this is the fall.",
            },
            {
               term: "Low",
               text: "effects snap frame by frame. Sharp, but it flickers on busy music.",
            },
            {
               term: "High",
               text: "effects ease down over most of a second. Smoother, but close hits blur together.",
            },
         ])}
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
         class="config-row help-row"
         title="Double-click to reset"
         ondblclick={(e) =>
            resetRow(e, () => (audioPunch = DEFAULT_SETTINGS.audioPunch))}
      >
         <label for="audio-punch">Punch</label>
         {@render helpToggle("punch", "What is punch?")}
         <RangeSlider
            id="audio-punch"
            bind:value={audioPunch}
            min={0}
            max={1}
            step={0.05}
         />
         <span class="val">{Math.round(audioPunch * 100)}%</span>
         {@render helpBody("punch", [
            {
               text: "How the audio level maps onto the effect's value.",
            },
            {
               term: "Low",
               text: "quiet parts count too, so effects stay busy the whole track.",
            },
            {
               term: "High",
               text: "only the loud hits move an effect far. It rests near the bottom in between.",
            },
         ])}
      </div>
   {/if}
</div>

<style>
   .config-panel {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem;
      border-bottom: 1px solid var(--line);
      max-width: 100%;
   }

   .section-title {
      margin-top: 0.75rem;
   }

   .scope-note {
      margin: 0 0 0.35rem;
      font-size: 0.7rem;
      color: var(--text-3);
   }

   .scope-note strong {
      color: var(--live);
      font-weight: 600;
   }

   .panel-title {
      font-family: var(--font-mono);
      font-size: 0.62rem;
      font-weight: 600;
      letter-spacing: 0.16em;
      color: var(--text-3);
      text-transform: uppercase;
      margin-bottom: 0.25rem;
   }

   .config-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.78rem;
   }

   .config-row label,
   .config-row .row-label {
      min-width: 84px;
      color: var(--text-3);
      font-family: var(--font-mono);
      font-size: 0.62rem;
      font-weight: 500;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      /* The row's double-click resets the setting; without this it also
         selects the label text. */
      user-select: none;
   }

   .config-row input[type="checkbox"] {
      accent-color: var(--live);
   }

   .val {
      color: var(--text-2);
      font-family: var(--font-mono);
      font-size: 0.66rem;
      font-variant-numeric: tabular-nums;
   }

   .band-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 0.2rem;
   }

   .band-btn {
      padding: 0.1rem 0.5rem;
      font-family: var(--font-mono);
      font-size: 0.58rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text-3);
      background: none;
      border: 1px solid var(--line);
      border-radius: var(--r-pill);
      cursor: pointer;
      transition:
         color var(--t-fast),
         border-color var(--t-fast),
         background var(--t-fast);
   }

   .band-btn:hover {
      color: var(--text-2);
      border-color: var(--line-strong);
   }

   .band-btn.active {
      color: var(--live);
      border-color: var(--live-dim);
      background: rgba(110, 231, 192, 0.12);
   }

   .help-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: none;
      background: none;
      color: var(--text-3);
      cursor: pointer;
      flex-shrink: 0;
   }

   .help-toggle:hover,
   .help-toggle.active {
      color: var(--text-2);
   }

   .help-row {
      position: relative;
   }

   /* Spans the row and overlays downward: out of flow, so it can't resize the
      shrink-to-fit panel, and never wider than it, so MobileSheet can't clip it. */
   .help-popover {
      position: absolute;
      top: calc(100% + 0.4rem);
      left: 0;
      right: 0;
      z-index: 30;
      padding: 0.6rem 0.7rem;
      background: var(--raised);
      border: 1px solid var(--line-strong);
      border-radius: var(--r-2);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
      color: var(--text-2);
      font-size: 0.68rem;
      line-height: 1.5;
   }

   .help-popover p {
      margin: 0;
   }

   .help-popover p + p {
      margin-top: 0.45rem;
   }

   .help-popover strong {
      color: var(--text);
      font-weight: 600;
   }
</style>
