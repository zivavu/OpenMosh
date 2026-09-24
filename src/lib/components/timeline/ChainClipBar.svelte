<script lang="ts">
	import type { Snippet } from "svelte";
	import { Dices, Eraser } from "lucide-svelte";
	import type { ChainClip } from "../../editor/chain-clip";
	import { BEAT_INTERVALS, type ChainMode } from "../../editor/sequence";
	import { loadPresets, type Preset } from "../../effects";

	/** The selection bar for any lane whose clips carry a chain: fill from a
	 * preset, roll a mosh, clear, and switch static/interval. Every action fans
	 * out over the selection; a value the selection disagrees on renders blank. */
	interface Props {
		/** Names the lane kind: the bar is shared, so it has to say which one. */
		title: string;
		selectedClips: ChainClip[];
		label: (clip: ChainClip) => string;
		bpm?: number;
		/** Without it the preset picker is left out. */
		onApplyPreset?: (clipIds: string[], preset: Preset) => void;
		onRoll?: (clipIds: string[]) => void;
		onClear?: (clipIds: string[]) => void;
		onModeChange?: (
			clipIds: string[],
			mode: ChainMode,
			intervalSec?: number,
			intervalBeats?: number | null,
		) => void;
		children?: Snippet;
		/** The lane kind's own actions, after the shared ones. */
		trailing?: Snippet;
	}

	let {
		title,
		selectedClips,
		label,
		bpm = 0,
		onApplyPreset,
		onRoll,
		onClear,
		onModeChange,
		children,
		trailing,
	}: Props = $props();

	let ids = $derived(selectedClips.map((c) => c.id));
	let many = $derived(selectedClips.length > 1);

	function commonValue<T>(values: T[]): T | undefined {
		return values.every((v) => v === values[0]) ? values[0] : undefined;
	}

	let commonMode = $derived(
		commonValue(selectedClips.map((c) => c.mode ?? "static")),
	);
	let commonIntervalSec = $derived(
		commonValue(selectedClips.map((c) => c.intervalSec)),
	);
	let commonIntervalBeats = $derived(
		commonValue(selectedClips.map((c) => c.intervalBeats)),
	);
	let hasInterval = $derived(
		selectedClips.every((c) => c.intervalSec !== undefined),
	);
	let intervalValue = $derived.by(() => {
		if (commonIntervalBeats) return `b${commonIntervalBeats}`;
		if (commonIntervalBeats === undefined || commonIntervalSec === undefined) {
			return "";
		}
		return String(commonIntervalSec);
	});

	/** Read on open, not at mount, so presets saved meanwhile show up. */
	let presetList = $state<Preset[]>([]);
	let selectedPresetIndex = $derived.by(() => {
		const name = commonValue(selectedClips.map((c) => c.presetName));
		if (!name) return -1;
		return presetList.findIndex((p) => p.name === name);
	});

	/** A clip with no spacing yet takes one beat, or a flat second without a BPM. */
	function switchToAuto() {
		if (hasInterval) onModeChange?.(ids, "interval");
		else if (bpm > 0) onModeChange?.(ids, "interval", 60 / bpm, 1);
		else onModeChange?.(ids, "interval", 1, null);
	}

	function onIntervalChange(v: string) {
		if (v === "") return;
		if (v.startsWith("b")) {
			const beats = Number(v.slice(1));
			onModeChange?.(ids, "interval", (60 / bpm) * beats, beats);
		} else {
			// Picking a plain duration drops the beat link, so a later BPM change
			// leaves it alone.
			onModeChange?.(ids, "interval", Number(v), null);
		}
	}
</script>

{#if selectedClips.length > 0}
	<div class="chain-bar">
		<span class="chain-title">{title}</span>
		<span class="tl-tool-label">
			{many ? `${selectedClips.length} clips` : label(selectedClips[0])}
		</span>

		{#if onApplyPreset}
			<div class="tl-tool-sep"></div>
			<span class="tl-tool-label">Fill</span>
			<select
				class="chain-select"
				value={selectedPresetIndex}
				onmousedown={() => (presetList = loadPresets())}
				onchange={(e) => {
					const preset = presetList[Number(e.currentTarget.value)];
					if (preset) onApplyPreset(ids, preset);
				}}
			>
				<option value={-1} disabled>Preset…</option>
				{#each presetList as p, i}
					<option value={i}>{p.name}</option>
				{/each}
			</select>
		{/if}
		<button
			class="tl-tool-btn"
			title={commonMode === "interval"
				? "New random seed"
				: many
					? "Random mosh for each selected clip"
					: "Random mosh for this clip"}
			onclick={() => onRoll?.(ids)}
		>
			<Dices size={12} /> Mosh
		</button>
		<button
			class="tl-tool-btn"
			title={many
				? "Clear the selected clips' effects"
				: "Clear this clip's effects"}
			onclick={() => onClear?.(ids)}
		>
			<Eraser size={12} /> Clear
		</button>

		<div class="tl-tool-sep"></div>
		<span class="tl-tool-label">Mode</span>
		<div class="chain-mode">
			<button
				class="tl-tool-btn"
				class:active={commonMode === "static"}
				onclick={() => onModeChange?.(ids, "static")}
			>
				Static
			</button>
			<button
				class="tl-tool-btn"
				class:active={commonMode === "interval"}
				onclick={switchToAuto}
			>
				Auto
			</button>
		</div>
		{@render children?.()}
		{#if commonMode === "interval"}
			<select
				class="chain-select"
				value={intervalValue}
				title="How often this clip re-rolls its mosh"
				onchange={(e) => onIntervalChange(e.currentTarget.value)}
			>
				{#if intervalValue === ""}
					<option value="" disabled>—</option>
				{/if}
				{#if bpm > 0}
					{#each BEAT_INTERVALS as opt}
						<option value={`b${opt.beats}`}>{opt.label}</option>
					{/each}
				{/if}
				{#each [0.125, 0.25, 0.5, 1, 2] as sec}
					<!-- String, not the number: the select's value is a string and Svelte
					     matches an option by strict equality, so a numeric value never matches. -->
					<option value={String(sec)}>every {sec}s</option>
				{/each}
			</select>
		{/if}
		{@render trailing?.()}
	</div>
{/if}

<style>
	/* Fills the stack's selection bar, centred as one run. */
	.chain-bar {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		padding: 0 0.25rem;
	}

	/* Too narrow for one row of everything: the controls wrap, with the captions
	   and dividers gone. */
	@media (max-width: 800px) {
		.chain-bar {
			flex-wrap: wrap;
			row-gap: 0.3rem;
			padding: 0.3rem 0;
		}

		.chain-bar > :global(.tl-tool-label),
		.chain-bar > :global(.tl-tool-sep) {
			display: none;
		}
	}

	.chain-title {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--mosh);
		white-space: nowrap;
	}

	.chain-mode {
		display: flex;
	}

	.chain-mode :global(.tl-tool-btn:first-child) {
		border-right-color: transparent;
		border-radius: 4px 0 0 4px;
	}

	.chain-mode :global(.tl-tool-btn:last-child) {
		border-radius: 0 4px 4px 0;
	}

	/* The lane's own accent, rather than the stack toolbar's blue. */
	.chain-mode :global(.tl-tool-btn.active) {
		border-color: var(--mosh);
		background: rgba(198, 162, 234, 0.12);
		color: var(--mosh);
	}

	.chain-select,
	.chain-bar :global(.chain-select) {
		max-width: 9rem;
		padding: 0.15rem 0.25rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text-2);
		font-size: 0.65rem;
		font-family: inherit;
	}
</style>
