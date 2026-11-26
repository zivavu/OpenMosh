<script lang="ts">
	import { Magnet } from "lucide-svelte";
	import { KEY_GRID_DIVISIONS } from "../../key-grid";
	import { keyGridTempoKnown } from "../../timeline/key-grid.svelte";
	import { uiPrefs } from "../../ui-prefs.svelte";

	/** The timeline's switch for putting keys on the song's beat grid, with the
	 * grid's spacing beside it while it's on. */
	let known = $derived(keyGridTempoKnown());
	let on = $derived(uiPrefs.keyGrid && known);
</script>

<span class="key-grid">
	<button
		class="tl-tool-btn"
		class:active={on}
		aria-pressed={on}
		disabled={!known}
		title={!known
			? "Set the BPM to put keys on the beat"
			: on
				? "Keys you add or drag land on the beat grid; Alt-drag places one freely. Click to turn it off."
				: "Put keys you add or drag on the song's beat grid"}
		onclick={() => (uiPrefs.keyGrid = !uiPrefs.keyGrid)}
	>
		<Magnet size={12} /> Keys on beat
	</button>
	{#if on}
		<select
			class="division"
			aria-label="Key grid spacing"
			title="Space between grid lines"
			value={uiPrefs.keyGridBeats}
			onchange={(e) => (uiPrefs.keyGridBeats = Number(e.currentTarget.value))}
		>
			{#each KEY_GRID_DIVISIONS as d (d.beats)}
				<option value={d.beats}>{d.label}</option>
			{/each}
		</select>
	{/if}
</span>

<style>
	.key-grid {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	/* Longhands only: the global select rule keeps its chevron in padding-right
	   and background-image. Sized as the toolbar buttons beside it. */
	.division {
		/* A pixel lower than even: Chrome sits a select's capitals about 1px high. */
		padding-block: calc(0.15rem + 1px) calc(0.15rem - 1px);
		padding-left: 0.4rem;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-2);
		background-color: rgba(255, 255, 255, 0.03);
		border-radius: var(--r-1);
	}
</style>
