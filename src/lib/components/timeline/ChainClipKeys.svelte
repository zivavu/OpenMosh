<script lang="ts">
	import type { ChainClip } from "../../editor/chain-clip";
	import type { EffectInstance } from "../../effects/types";
	import {
		chainEaseAt,
		chainHasKeys,
		chainKeyTimes,
		moveChainKeys,
		removeChainKeysAt,
		repeatChainKeys,
		setChainEaseAt,
	} from "../../effects/param-keys";
	import ClipKeys from "./ClipKeys.svelte";

	/** A selected clip's effect keys on its bar. */
	interface Props {
		clip: ChainClip;
		/** Unselected, the clip only shows that it animates. */
		selected: boolean;
		bpm?: number;
		beatOffset?: number;
		onSeek?: (time: number) => void;
		onEdit: (
			edit: (effects: EffectInstance[]) => EffectInstance[],
			coalesceKey?: string,
		) => void;
	}

	let {
		clip,
		selected,
		bpm = 0,
		beatOffset = 0,
		onSeek,
		onEdit,
	}: Props = $props();

	let length = $derived(clip.end - clip.start);
</script>

{#if !chainHasKeys(clip.effects)}
	<!-- nothing keyed -->
{:else if !selected}
	<span class="animated" aria-hidden="true"></span>
{:else}
	<ClipKeys
		times={chainKeyTimes(clip.effects)}
		{length}
		start={clip.start}
		easeAt={(t) => chainEaseAt(clip.effects, t)}
		beatSec={bpm > 0 ? 60 / bpm : 0}
		{beatOffset}
		onSeek={(t) => onSeek?.(t)}
		onMove={(from, to, key) => onEdit((e) => moveChainKeys(e, from, to), key)}
		onEase={(t, ease) => onEdit((e) => setChainEaseAt(e, t, ease))}
		onDelete={(t) => onEdit((e) => removeChainKeysAt(e, t))}
		onRepeat={() => onEdit((e) => repeatChainKeys(e, length))}
	/>
{/if}

<style>
	.animated {
		position: absolute;
		right: 5px;
		bottom: 4px;
		width: 5px;
		height: 5px;
		background: var(--live);
		transform: rotate(45deg);
		pointer-events: none;
	}
</style>
