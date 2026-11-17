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
		repeatChainKeysEvery,
		setChainEaseAt,
		simplifyChainKeys,
	} from "../../effects/param-keys";
	import {
		CHAIN_OWNER,
		keyBox,
		keyFocus,
	} from "../../timeline/key-focus.svelte";
	import ClipKeys from "./ClipKeys.svelte";
	import { chainKeysAt } from "../../timeline/key-clipboard";
	import { chainKeyRows, keyedAt } from "../../timeline/key-rows";
	import { gridKeyTarget } from "../../timeline/key-grid.svelte";

	/** A selected clip's effect keys on its bar. */
	interface Props {
		clip: ChainClip;
		laneId: string;
		/** Unselected, the clip only shows that it animates. */
		selected: boolean;
		/** Off while the lane's setting rows are open: they show these keys instead. */
		summary?: boolean;
		bpm?: number;
		beatOffset?: number;
		onSeek?: (time: number) => void;
		/** The paused playhead, where the panel's sliders key; null while playing. */
		editAt?: number | null;
		onEdit: (
			edit: (effects: EffectInstance[]) => EffectInstance[],
			coalesceKey?: string,
		) => void;
	}

	let {
		clip,
		laneId,
		selected,
		summary = true,
		bpm = 0,
		beatOffset = 0,
		onSeek,
		editAt = null,
		onEdit,
	}: Props = $props();

	let length = $derived(clip.end - clip.start);
	let box = $derived.by(() => {
		const b = keyBox.current;
		return b?.laneId === laneId
			? { from: b.from - clip.start, to: b.to - clip.start, serial: b.serial }
			: null;
	});
	let target = $derived.by(() => {
		const at = gridKeyTarget(editAt, clip.start, clip.end);
		return at === null ? null : at - clip.start;
	});
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
		onRepeat={(times) => onEdit((e) => repeatChainKeys(e, length, times))}
		onCopy={(times) => chainKeysAt(clip.effects, times, clip.start)}
		describe={(t) => keyedAt(chainKeyRows(clip), t)}
		onRepeatEvery={(times, period) =>
			onEdit((e) => repeatChainKeysEvery(e, times, period, length))}
		{focus}
		{box}
		{target}
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
