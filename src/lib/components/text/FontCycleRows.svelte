<script lang="ts">
	import Checkbox from "../ui/Checkbox.svelte";
	import {
		customFonts,
		ensureFontLoaded,
		FONT_OPTIONS,
	} from "../../text-overlay";
	import {
		FONT_CYCLE_BEATS,
		type FontCycle,
		type FontCycleOrder,
	} from "../../text/types";

	interface Props {
		cycle: FontCycle;
		/** The lane's own font, the first one picked when the cycle is switched on. */
		fontFamily: string;
		/** Undefined where the host doesn't know it; 0 means no tempo yet. */
		bpm?: number;
		onChange: (cycle: FontCycle) => void;
	}

	let { cycle, fontFamily, bpm, onChange }: Props = $props();

	let fonts = $derived([
		...FONT_OPTIONS.map((f) => ({ family: f.family, label: f.label })),
		...customFonts().map((f) => ({ family: f.family, label: f.name })),
	]);

	function setEnabled(enabled: boolean) {
		const picked =
			enabled && cycle.fonts.length === 0 ? [fontFamily] : cycle.fonts;
		onChange({ ...cycle, enabled, fonts: picked });
	}

	/** Picking appends, so the order fonts were picked in is the order they cycle in. */
	function toggleFont(family: string) {
		const has = cycle.fonts.includes(family);
		if (!has) void ensureFontLoaded(family);
		onChange({
			...cycle,
			fonts: has
				? cycle.fonts.filter((f) => f !== family)
				: [...cycle.fonts, family],
		});
	}

	function beatsLabel(beats: number): string {
		if (beats === 0.5) return "½ beat";
		return beats === 1 ? "1 beat" : `${beats} beats`;
	}
</script>

<div
	class="row"
	title="Switch the font on the beat, through the fonts you pick below"
>
	<label for="tc-font-beat">Font on beat</label>
	<Checkbox
		id="tc-font-beat"
		checked={cycle.enabled}
		onchange={(e) => setEnabled((e.currentTarget as HTMLInputElement).checked)}
	/>
</div>

{#if cycle.enabled}
	<div class="row" title="How long each font holds before the next one">
		<label for="tc-font-every">Change every</label>
		<select
			id="tc-font-every"
			value={String(cycle.everyBeats)}
			onchange={(e) =>
				onChange({
					...cycle,
					everyBeats: Number((e.currentTarget as HTMLSelectElement).value),
				})}
		>
			{#each FONT_CYCLE_BEATS as beats}
				<option value={String(beats)}>{beatsLabel(beats)}</option>
			{/each}
		</select>
	</div>

	<div
		class="row"
		title="In the order picked, or shuffled: each font once per round, never the same twice in a row"
	>
		<label for="tc-font-order">Order</label>
		<select
			id="tc-font-order"
			value={cycle.order}
			onchange={(e) =>
				onChange({
					...cycle,
					order: (e.currentTarget as HTMLSelectElement).value as FontCycleOrder,
				})}
		>
			<option value="cycle">As picked</option>
			<option value="shuffle">Shuffle</option>
		</select>
	</div>

	<div class="font-chips" role="group" aria-label="Fonts to switch between">
		{#each fonts as font (font.family)}
			{@const at = cycle.fonts.indexOf(font.family)}
			<button
				type="button"
				class="chip"
				class:on={at !== -1}
				aria-pressed={at !== -1}
				onclick={() => toggleFont(font.family)}
			>
				{#if at !== -1}<span class="n">{at + 1}</span>{/if}
				{font.label}
			</button>
		{/each}
	</div>

	{#if cycle.fonts.length < 2}
		<p class="hint">Pick two or more fonts to switch between.</p>
	{:else if bpm === 0}
		<p class="warn">
			No BPM yet, so the font stays put until one is detected or set.
		</p>
	{/if}
{/if}

<style>
	.font-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		max-height: 150px;
		overflow-y: auto;
		padding: 4px;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--sunken);
	}

	.chip {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 6px;
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		cursor: pointer;
	}

	.chip:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}

	.chip.on {
		color: var(--live);
		border-color: var(--live-dim);
	}

	.n {
		font-weight: 700;
	}
</style>
