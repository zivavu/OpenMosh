<script lang="ts" generics="C extends ChainClip">
	import type { Snippet } from "svelte";
	import type { AudioResponse } from "../../audio/auto-range";
	import type { ChainClip } from "../../editor/chain-clip";
	import { handBuiltLabel, isHandBuiltLabel } from "../../editor/sequence";
	import { LaneEffects } from "../../timeline/lane-effects.svelte";
	import type { SpectrumData } from "../../types";
	import EffectsPanel from "../ui/EffectsPanel.svelte";

	/** A layer clip's own effect chain, as the clip panels edit it: the mirror
	 * EffectsPanel needs, the write-back on every edit, and label upkeep. */
	interface Props {
		clip: C;
		onClipChange: (clip: C) => void;
		onBeforeEdit?: (coalesceKey?: string) => void;
		hasTrack?: boolean;
		beatSync?: boolean;
		spectrumData?: SpectrumData | null;
		response?: AudioResponse;
		/** What the chain runs on: "this clip's media", "this clip's text". */
		hint: string;
		/** Anything to say above the hint, e.g. a warning about the chain. */
		children?: Snippet;
		/** Whether edits here also reach the rest of a multi-selection. */
		note?: string | null;
	}

	let {
		clip,
		onClipChange,
		onBeforeEdit,
		hasTrack = false,
		beatSync = false,
		spectrumData = null,
		response = undefined,
		hint,
		children,
		note = null,
	}: Props = $props();

	// The clip's chain, mirrored for EffectsPanel to own and written back on every
	// edit: the chain on show is this mirror, so the editor has nothing to apply.
	const chain = new LaneEffects<C>(
		() => clip,
		(next) => onClipChange(next),
		(key) => onBeforeEdit?.(key),
	);
	$effect(() => chain.sync());

	/** A hand-edit to a preset-filled clip: the label gains a "*" and explicit
	 * preset overwrites stop clobbering it. An auto clip keeps its label. */
	function onChainEdited() {
		chain.commit();
		const next = $state.snapshot(clip) as C;
		if (next.mode === "interval") {
			if (next.presetName) next.modified = true;
		} else if (isHandBuiltLabel(next))
			next.label = handBuiltLabel(next.effects);
		else if (!next.modified) next.modified = true;
		if (next.label !== clip.label || next.modified !== clip.modified) {
			onClipChange({ ...clip, label: next.label, modified: next.modified });
		}
	}
</script>

{@render children?.()}
<p class="hint">
	{#if clip.mode === "interval"}
		These effects run on {hint} after the auto mosh, before it meets the frame.
	{:else}
		These effects only run on {hint}, before it meets the frame.
	{/if}
</p>
<EffectsPanel
	headless
	{note}
	bind:effects={() => chain.effects, (v) => (chain.effects = v)}
	{hasTrack}
	{beatSync}
	{spectrumData}
	{response}
	onVolumeLinkChange={(i, key, link) => {
		chain.linkChange(i, key, link);
		onChainEdited();
	}}
	onUserEdit={onChainEdited}
	onEffectsReplaced={() => chain.commit()}
	onPresetApplied={(preset) =>
		onClipChange({
			...clip,
			effects: $state.snapshot(chain.effects) as C["effects"],
			label: clip.mode === "interval" ? clip.label : preset.name,
			presetName: preset.name,
			modified: false,
		})}
	onBeforeUserEdit={onBeforeEdit}
/>
