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

	type Edit = (t: ClipTransition | undefined) => ClipTransition | undefined;

	/** How layer clips blend in from the clip before each. Several at once show a
	 * value only where they agree. */
	interface Props {
		transitions: (ClipTransition | undefined)[];
		/** Whether a clip touches the start; without one it blends in from nothing. */
		follows: boolean;
		idPrefix: string;
		/** Applied to every target's transition. */
		onChange: (edit: Edit) => void;
	}

	let { transitions, follows, idPrefix, onChange }: Props = $props();

	/** The one value every target shares, else undefined. */
	function common<T>(
		read: (t: ClipTransition | undefined) => T,
	): T | undefined {
		const values = transitions.map(read);
		return values.every((v) => v === values[0]) ? values[0] : undefined;
	}

	let type = $derived(common((t) => t?.type ?? "cut"));
	let duration = $derived(common((t) => t?.durationSec));
	let direction = $derived(common((t) => t?.direction ?? 0));
	let density = $derived(common((t) => t?.density ?? 1));
	let anyOn = $derived(transitions.some((t) => !!t));
	/** The controls a mixed selection shows are the ones any of its types has. */
	let metas = $derived(
		transitions.map((t) =>
			TRANSITION_OPTIONS.find((o) => o.value === (t?.type ?? "cut")),
		),
	);

	function setType(next: TransitionType) {
		onChange((t) =>
			next === "cut"
				? undefined
				: t
					? { ...t, type: next }
					: createTransition(next),
		);
	}

	function patch(p: Partial<ClipTransition>) {
		onChange((t) => (t ? { ...t, ...p } : t));
	}
</script>

<div
	class="row"
	title={follows
		? "How the clip blends in from the clip right before it"
		: "How the clip blends in. Nothing plays right before it, so it arrives out of nothing."}
>
	<label for="{idPrefix}-transition">Transition</label>
	<select
		id="{idPrefix}-transition"
		value={type ?? ""}
		onchange={(e) => {
			const v = (e.currentTarget as HTMLSelectElement).value;
			if (v) setType(v as TransitionType);
		}}
	>
		{#if type === undefined}
			<option value="" disabled>&#8212;</option>
		{/if}
		{#each TRANSITION_OPTIONS as o (o.value)}
			<option value={o.value}>{o.value === "cut" ? "none" : o.label}</option>
		{/each}
	</select>
</div>

{#if anyOn}
	<div class="row" title="How long the blend runs from the clip's start">
		<label for="{idPrefix}-transition-len">Length</label>
		<select
			id="{idPrefix}-transition-len"
			value={duration ?? ""}
			onchange={(e) => {
				const v = (e.currentTarget as HTMLSelectElement).value;
				if (v) patch({ durationSec: Number(v) });
			}}
		>
			{#if duration === undefined}
				<option value="" disabled>&#8212;</option>
			{:else if !TRANSITION_DURATIONS.includes(duration)}
				<option value={duration}>{duration}s</option>
			{/if}
			{#each TRANSITION_DURATIONS as sec (sec)}
				<option value={sec}>{sec}s</option>
			{/each}
		</select>
	</div>

	{#if metas.some((m) => m?.hasDirection)}
		<div class="row" title="Which way the blend travels">
			<label for="{idPrefix}-transition-dir">Direction</label>
			<select
				id="{idPrefix}-transition-dir"
				value={direction ?? ""}
				onchange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					if (v) patch({ direction: Number(v) });
				}}
			>
				{#if direction === undefined}
					<option value="" disabled>&#8212;</option>
				{/if}
				<option value={0}>&#8594;</option>
				<option value={1}>&#8592;</option>
				<option value={2}>&#8595;</option>
				<option value={3}>&#8593;</option>
				<option value={RANDOM_DIRECTION}>random</option>
			</select>
		</div>
	{/if}

	{#if metas.some((m) => m?.hasDensity)}
		<div class="row" title="Size of the shards">
			<label for="{idPrefix}-transition-cells">Cells</label>
			<select
				id="{idPrefix}-transition-cells"
				value={density ?? ""}
				onchange={(e) => {
					const v = (e.currentTarget as HTMLSelectElement).value;
					if (v) patch({ density: Number(v) });
				}}
			>
				{#if density === undefined}
					<option value="" disabled>&#8212;</option>
				{/if}
				<option value={0}>coarse</option>
				<option value={1}>med</option>
				<option value={2}>fine</option>
			</select>
		</div>
	{/if}

	{#if metas.some((m) => m?.hasSeed)}
		<div class="row">
			<span class="label-spacer"></span>
			<button
				class="reroll"
				title="Roll a new layout for the blend, and a new pick when it's random"
				onclick={() => onChange((t) => (t ? { ...t, seed: randomSeed() } : t))}
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
