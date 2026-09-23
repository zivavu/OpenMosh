<script lang="ts">
	import { Dices } from "lucide-svelte";
	import { randomSeed } from "../../rng";
	import {
		createTransition,
		RANDOM_DIRECTION,
		TRANSITION_DURATIONS,
		TRANSITION_OPTIONS,
		type ClipTransition,
		type TransitionType,
	} from "../../media/transition";

	/** How a layer clip blends in from the clip before it. */
	interface Props {
		transition: ClipTransition | undefined;
		/** Whether a clip touches this one's start; without one it blends in from nothing. */
		follows: boolean;
		onChange: (transition: ClipTransition | undefined) => void;
	}

	let { transition, follows, onChange }: Props = $props();

	let meta = $derived(
		TRANSITION_OPTIONS.find((o) => o.value === (transition?.type ?? "cut")),
	);

	function setType(type: TransitionType) {
		if (type === "cut") return onChange(undefined);
		onChange(transition ? { ...transition, type } : createTransition(type));
	}

	function patch(p: Partial<ClipTransition>) {
		if (transition) onChange({ ...transition, ...p });
	}
</script>

<div
	class="row"
	title={follows
		? "How this clip blends in from the clip right before it"
		: "How this clip blends in. Nothing plays right before it, so it arrives out of nothing."}
>
	<label for="mc-transition">Transition</label>
	<select
		id="mc-transition"
		value={transition?.type ?? "cut"}
		onchange={(e) =>
			setType((e.currentTarget as HTMLSelectElement).value as TransitionType)}
	>
		{#each TRANSITION_OPTIONS as o (o.value)}
			<option value={o.value}>{o.value === "cut" ? "none" : o.label}</option>
		{/each}
	</select>
</div>

{#if transition}
	<div class="row" title="How long the blend runs from the clip's start">
		<label for="mc-transition-len">Length</label>
		<select
			id="mc-transition-len"
			value={transition.durationSec}
			onchange={(e) =>
				patch({
					durationSec: Number((e.currentTarget as HTMLSelectElement).value),
				})}
		>
			{#if !TRANSITION_DURATIONS.includes(transition.durationSec)}
				<option value={transition.durationSec}>{transition.durationSec}s</option
				>
			{/if}
			{#each TRANSITION_DURATIONS as sec (sec)}
				<option value={sec}>{sec}s</option>
			{/each}
		</select>
	</div>

	{#if meta?.hasDirection}
		<div class="row" title="Which way the blend travels">
			<label for="mc-transition-dir">Direction</label>
			<select
				id="mc-transition-dir"
				value={transition.direction ?? 0}
				onchange={(e) =>
					patch({
						direction: Number((e.currentTarget as HTMLSelectElement).value),
					})}
			>
				<option value={0}>&#8594;</option>
				<option value={1}>&#8592;</option>
				<option value={2}>&#8595;</option>
				<option value={3}>&#8593;</option>
				<option value={RANDOM_DIRECTION}>random</option>
			</select>
		</div>
	{/if}

	{#if meta?.hasDensity}
		<div class="row" title="Size of the shards">
			<label for="mc-transition-cells">Cells</label>
			<select
				id="mc-transition-cells"
				value={transition.density ?? 1}
				onchange={(e) =>
					patch({
						density: Number((e.currentTarget as HTMLSelectElement).value),
					})}
			>
				<option value={0}>coarse</option>
				<option value={1}>med</option>
				<option value={2}>fine</option>
			</select>
		</div>
	{/if}

	{#if meta?.hasSeed}
		<div class="row">
			<span class="label-spacer"></span>
			<button
				class="reroll"
				title="Roll a new layout for the blend, and a new pick when it's random"
				onclick={() => patch({ seed: randomSeed() })}
			>
				<Dices size={11} /> Re-roll
			</button>
		</div>
	{/if}
{/if}

<style>
	.label-spacer {
		flex-shrink: 0;
		min-width: 84px;
	}

	.reroll {
		flex: 1;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 0.25rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		background: var(--ink);
		color: var(--text-2);
		font-size: 0.7rem;
		cursor: pointer;
	}

	.reroll:hover {
		color: var(--text);
		border-color: var(--live);
	}
</style>
