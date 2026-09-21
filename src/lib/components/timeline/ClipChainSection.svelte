<script lang="ts" generics="C extends ChainClip">
	import type { Snippet } from "svelte";
	import type { AudioResponse } from "../../audio/auto-range";
	import type { ChainClip } from "../../editor/chain-clip";
	import { handBuiltLabel, isHandBuiltLabel } from "../../editor/sequence";
	import { LaneEffects } from "../../timeline/lane-effects.svelte";
	import type { SpectrumData } from "../../types";
	import EffectsPanel from "../ui/EffectsPanel.svelte";

	/**
	 * A layer clip's own effect chain, as the clip panels edit it: the mirror
	 * EffectsPanel needs, the write-back on every edit, and the label upkeep
	 * that follows a hand edit.
	 */
	interface Props {
		clip: C;
		onClipChange: (clip: C) => void;
		onBeforeEdit?: (coalesceKey?: string) => void;
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		/** Forwarded to the chain for its spectrum read-out. */
		response?: AudioResponse;
		/** What the chain runs on: "this clip's media", "this clip's text". */
		hint: string;
		/** Anything to say above the hint — a warning about the chain. */
		children?: Snippet;
	}

	let {
		clip,
		onClipChange,
		onBeforeEdit,
		hasTrack = false,
		spectrumData = null,
		response = undefined,
		hint,
		children,
	}: Props = $props();

	// The clip's chain, mirrored for EffectsPanel to own and written back on
	// every edit. Handled here rather than by the editor: the chain on show is
	// this mirror, so the editor has nothing to apply an edit to.
	const chain = new LaneEffects<C>(
		() => clip,
		(next) => onClipChange(next),
		(key) => onBeforeEdit?.(key),
	);
	$effect(() => chain.sync());

	/** A hand-edit to a preset-filled clip: the label gains a "*" and explicit
	 * preset overwrites stop clobbering it. A hand-built chain takes its name
	 * from what it switches on instead. */
	function onChainEdited() {
		chain.commit();
		const next = $state.snapshot(clip) as C;
		if (isHandBuiltLabel(next)) next.label = handBuiltLabel(next.effects);
		else if (!next.modified) next.modified = true;
		if (next.label !== clip.label || next.modified !== clip.modified) {
			onClipChange({ ...clip, label: next.label, modified: next.modified });
		}
	}
</script>

{@render children?.()}
<p class="hint">These effects only run on {hint}, before it meets the frame.</p>
<EffectsPanel
	headless
	bind:effects={() => chain.effects, (v) => (chain.effects = v)}
	rolledNote={clip.mode === "interval"
		? "Auto clip re-rolls its own mosh on an interval, so the switches follow it. Hide an effect to keep it out of the roll, or switch the clip to Static in the clip bar to build a chain by hand."
		: null}
	rolledChain={clip.mode === "interval"}
	{hasTrack}
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
			label: preset.name,
			presetName: preset.name,
			modified: false,
		})}
	onBeforeUserEdit={onBeforeEdit}
/>
