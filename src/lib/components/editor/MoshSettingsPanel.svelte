<script lang="ts">
   import { HelpCircle } from "lucide-svelte";
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
   }

   let {
      moshMin = $bindable(),
      moshMax = $bindable(),
      randomizeOrder = $bindable(),
      moshAudioLink = $bindable(),
      moshAudioLinkStrength = $bindable(),
      autoRangeAmount = $bindable(),
      hasAudio,
   }: Props = $props();
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
   <h3 class="panel-title">Mosh settings</h3>
   <div class="config-row">
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
   <div class="config-row">
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
   <div class="config-row">
      <label for="mosh-shuffle">Shuffle order</label>
      <input id="mosh-shuffle" type="checkbox" bind:checked={randomizeOrder} />
   </div>
   {#if hasAudio}
      <div class="config-row">
         <label for="mosh-audio-link">Random audio links</label>
         <input
            id="mosh-audio-link"
            type="checkbox"
            bind:checked={moshAudioLink}
         />
      </div>
   {/if}
   {#if hasAudio && moshAudioLink}
      <div class="config-row">
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
      <div class="config-row auto-range-row">
         <label for="auto-range-amount">Auto-range</label>
         <button
            bind:this={helpBtnEl}
            class="help-toggle"
            class:active={showAutoRangeHelp}
            onclick={() => (showAutoRangeHelp = !showAutoRangeHelp)}
            aria-expanded={showAutoRangeHelp}
            aria-label="What is auto-range?"
         >
            <HelpCircle size={13} />
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
                  <strong>Low</strong>: effects follow the actual volume. Most music
                  sits at a steady level, so they only drift a little.
               </p>
               <p>
                  <strong>High</strong>: the quietest and loudest moments of the last
                  few seconds are stretched across the whole range you set. Drops
                  hit harder, but quiet parts get pushed up too.
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
      border-bottom: 1px solid #2a2a2a;
      max-width: 100%;
   }

   .panel-title {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: #888;
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
      min-width: 80px;
      color: #999;
      font-size: 0.75rem;
   }

   .config-row input[type="checkbox"] {
      accent-color: #888;
   }

   .val {
      color: #888;
      font-size: 0.75rem;
   }

   .help-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: none;
      background: none;
      color: #666;
      cursor: pointer;
      flex-shrink: 0;
   }

   .help-toggle:hover,
   .help-toggle.active {
      color: #bbb;
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
      background: #202020;
      border: 1px solid #383838;
      border-radius: 6px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
      color: #9a9a9a;
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
      color: #ccc;
      font-weight: 600;
   }
</style>
