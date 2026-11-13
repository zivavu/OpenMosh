<script lang="ts">
	import type { ChainClip } from "../../editor/chain-clip";
	import type { EffectInstance } from "../../effects/types";
	import {
		chainEaseAt,
		chainHasKeys,
		chainKeyTimes,
		clearChainKeys,
		moveChainKeys,
		removeChainKeysAt,
		repeatChainKeys,
		setChainEaseAt,
		simplifyChainKeys,
	} from "../../effects/param-keys";
	import { CHAIN_OWNER, keyFocus } from "../../timeline/key-focus.svelte";
	import ClipKeys from "./ClipKeys.svelte";

	/** A selected clip's effect keys on its bar. */
	interface Props {
		clip: ChainClip;
		/** Unselected, the clip only shows that it animates. */
		selected: boolean;
		/** Off while the lane's setting rows are open: they show these keys instead. */
		summary?: boolean;
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
		summary = true,
		bpm = 0,
		beatOffset = 0,
		onSeek,
		onEdit,
	}: Props = $props();

	let length = $derived(clip.end - clip.start);
	let focus = $derived(
		keyFocus.current?.owner === CHAIN_OWNER ? keyFocus.current : null,
	);
</script>

{#if !chainHasKeys(clip.effects)}
	<!-- nothing keyed -->
{:else if !selected || !summary}
	<span class="animated" aria-hidden="true"></span>
{:else}
	<ClipKeys
		scope="clip"
		times={chainKeyTimes(clip.effects)}
		{length}
		start={clip.start}
		easeAt={(t) => chainEaseAt(clip.effects, t)}
		beatSec={bpm > 0 ? 60 / bpm : 0}
		{beatOffset}
		onSeek={(t) => onSeek?.(t)}
		onMove={(times, delta, key) =>
			onEdit((e) => moveChainKeys(e, times, delta), key)}
		onEase={(times, ease) => onEdit((e) => setChainEaseAt(e, times, ease))}
		onDelete={(times) => onEdit((e) => removeChainKeysAt(e, times))}
		onDeleteAll={() => onEdit(clearChainKeys)}
		onSimplify={() => onEdit(simplifyChainKeys)}
		onRepeat={() => onEdit((e) => repeatChainKeys(e, length))}
		{focus}
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
