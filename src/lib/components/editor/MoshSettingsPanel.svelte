<script lang="ts">
   import { CircleQuestionMark, HelpCircle } from "lucide-svelte";
   import { DEFAULT_SETTINGS } from "../../editor/settings";
   import BpmControl from "../ui/BpmControl.svelte";
   import RangeSlider from "../ui/RangeSlider.svelte";

   let showAutoRangeHelp = $state(false);
   let helpBtnEl = $state<HTMLButtonElement | undefined>(undefined);
   let helpPopoverEl = $state<HTMLDivElement | undefined>(undefined);

   interface Props {
      moshMin: number;
      moshMax: number;
      randomizeOrder: boolean;
      moshAudioLink: boolean;
      moshAudioLinkStrength: number;
      autoRangeAmount: number;
      hasAudio: boolean;
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
      autoRangeAmount = $bindable(),
      hasAudio,
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
      if (e.key === "Escape" && showAutoRangeHelp) showAutoRangeHelp = false;
   }}
   onpointerdown={(e) => {
      if (!showAutoRangeHelp) return;
      const t = e.target as Node;
      // The button is "inside" only so its own click can toggle rather than
      // fight this handler.
      if (helpBtnEl?.contains(t) || helpPopoverEl?.contains(t)) return;
      showAutoRangeHelp = false;
   }}
/>

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
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
         class="config-row"
         title="Double-click to reset"
         ondblclick={(e) =>
            resetRow(e, () => (moshAudioLink = DEFAULT_SETTINGS.moshAudioLink))}
      >
         <label for="mosh-audio-link">Random audio links</label>
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
         <label for="mosh-audio-link-strength">Links strength</label>
         <RangeSlider
            id="mosh-audio-link-strength"
            bind:value={moshAudioLinkStrength}
            min={0}
            max={1}
            step={0.05}
         />
         <span class="val">{Math.round(moshAudioLinkStrength * 100)}%</span>
      </div>
   {/if}
   <!-- Not gated on moshAudioLink: this shapes every link, hand-made ones too. -->
   {#if hasAudio}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
         class="config-row auto-range-row"
         title="Double-click to reset"
         ondblclick={(e) =>
            resetRow(e, () => (autoRangeAmount = DEFAULT_SETTINGS.autoRangeAmount))}
      >
         <label for="auto-range-amount">Auto-range</label>
         <button
            bind:this={helpBtnEl}
            class="help-toggle"
            class:active={showAutoRangeHelp}
            onclick={() => (showAutoRangeHelp = !showAutoRangeHelp)}
            aria-expanded={showAutoRangeHelp}
            aria-label="What is auto-range?"
         >
            <CircleQuestionMark size={13} />
         </button>
         <RangeSlider
            id="auto-range-amount"
            bind:value={autoRangeAmount}
            min={0}
            max={1}
            step={0.05}
         />
         <span class="val">{Math.round(autoRangeAmount * 100)}%</span>
         {#if showAutoRangeHelp}
            <div bind:this={helpPopoverEl} class="help-popover" role="tooltip">
               <p>
                  Controls how much effects exaggerate the gap between the quiet
                  and loud parts of a track.
               </p>
               <p>
                  <strong>Low</strong>: effects follow the actual volume. Most
                  music sits at a steady level, so they only drift a little.
               </p>
               <p>
                  <strong>High</strong>: the quietest and loudest moments of the
                  last few seconds are stretched across the whole range you set.
                  Drops hit harder, but quiet parts get pushed up too.
               </p>
            </div>
         {/if}
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

   .config-row label {
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

   .auto-range-row {
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
