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
		/** The clip's words, for the hover preview. */
		text?: string;
		onChange: (cycle: FontCycle) => void;
	}

	let { cycle, fontFamily, bpm, text = "", onChange }: Props = $props();

	const PREVIEW_WIDTH = 240;
	const PREVIEW_MARGIN = 8;

	/** The chip being hovered, and where its preview floats. */
	let preview = $state<{
		family: string;
		label: string;
		left: number;
		top: number;
		below: boolean;
	} | null>(null);

	function showPreview(e: Event, family: string, label: string) {
		// A tap would only flash it.
		if (e instanceof PointerEvent && e.pointerType === "touch") return;
		void ensureFontLoaded(family);
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const left = Math.min(
			Math.max(r.left + r.width / 2 - PREVIEW_WIDTH / 2, PREVIEW_MARGIN),
			window.innerWidth - PREVIEW_WIDTH - PREVIEW_MARGIN,
		);
		// Under the chip when there's no room above it.
		const below = r.top < 140;
		const top = below ? r.bottom + PREVIEW_MARGIN : r.top - PREVIEW_MARGIN;
		preview = { family, label, left, top, below };
	}

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

	let allPicked = $derived(fonts.every((f) => cycle.fonts.includes(f.family)));

	/** All keeps the fonts already picked at the front, in their order. */
	function toggleAll() {
		if (allPicked) {
			onChange({ ...cycle, fonts: [] });
			return;
		}
		const rest = fonts
			.map((f) => f.family)
			.filter((f) => !cycle.fonts.includes(f));
		for (const f of rest) void ensureFontLoaded(f);
		onChange({ ...cycle, fonts: [...cycle.fonts, ...rest] });
	}

	function beatsLabel(beats: number): string {
		if (beats < 1) return `1/${Math.round(1 / beats)} beat`;
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

	<div class="row">
		<span class="fonts-label">Fonts ({cycle.fonts.length})</span>
		<button type="button" class="all-btn" onclick={toggleAll}>
			{allPicked ? "Clear" : "Select all"}
		</button>
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
				onpointerenter={(e) => showPreview(e, font.family, font.label)}
				onpointerleave={() => (preview = null)}
				onfocus={(e) => showPreview(e, font.family, font.label)}
				onblur={() => (preview = null)}
			>
				{#if at !== -1}<span class="n">{at + 1}</span>{/if}
				{font.label}
			</button>
		{/each}
	</div>

	{#if preview}
		<div
			class="font-preview"
			class:below={preview.below}
			style="left: {preview.left}px; top: {preview.top}px; width: {PREVIEW_WIDTH}px"
			aria-hidden="true"
		>
			<div class="sample" style="font-family: {preview.family}">
				{text.trim() || preview.label}
			</div>
			<div class="name">{preview.label}</div>
		</div>
	{/if}

	{#if cycle.fonts.length < 2}
		<p class="hint">Pick two or more fonts to switch between.</p>
	{:else if bpm === 0}
		<p class="warn">
			No BPM yet, so the font stays put until one is detected or set.
		</p>
	{/if}
{/if}

<style>
	.fonts-label {
		flex: 1;
		color: var(--text-2);
		font-size: 0.75rem;
	}

	.all-btn {
		padding: 2px 8px;
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		cursor: pointer;
	}

	.all-btn:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}

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

	.font-preview {
		position: fixed;
		z-index: 150;
		transform: translateY(-100%);
		padding: 0.6rem 0.7rem 0.45rem;
		background: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-2);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.font-preview.below {
		transform: none;
	}

	.sample {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		color: var(--text);
		font-size: 1.4rem;
		line-height: 1.2;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.name {
		margin-top: 0.35rem;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.6rem;
	}
</style>
