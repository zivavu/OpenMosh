<script lang="ts">
	import { RefreshCw, Palette } from "lucide-svelte";
	import { onDestroy, untrack } from "svelte";
	import {
		GENERATED_SHORT_SIDE,
		PALETTES,
		RATIOS,
		planBatch,
		randomSeed,
		ratioSize,
		renderSpec,
		specsToFiles,
		type GeneratedSpec,
		type GeneratorKind,
		type RatioLabel,
		type Variety,
	} from "../../generators";
	import ButtonGroup from "../ui/ButtonGroup.svelte";
	import PanelModal from "../ui/PanelModal.svelte";

	interface Props {
		/** Single mode makes one image; the multi modes make a set. */
		single: boolean;
		/** Opened from inside an editor: render straight at its output size and skip
		 * the ratio choice. */
		size?: { width: number; height: number } | null;
		onUse: (files: File[]) => void;
		onClose: () => void;
	}

	let { single, size = null, onUse, onClose }: Props = $props();

	const COUNTS = [
		{ label: "8", value: "8" },
		{ label: "16", value: "16" },
		{ label: "32", value: "32" },
		{ label: "64", value: "64" },
	];
	// Mix deals kinds across a batch; with one image it just hides a random pick.
	const KINDS: { label: string; value: GeneratorKind }[] = $derived([
		...(single ? [] : [{ label: "Mix", value: "mix" as const }]),
		{ label: "Gradient", value: "gradient" },
		{ label: "Voronoi", value: "voronoi" },
		{ label: "Stripes", value: "stripes" },
		{ label: "Plasma", value: "plasma" },
		{ label: "Rings", value: "rings" },
	]);
	const VARIETIES: { label: string; value: Variety }[] = [
		{ label: "Wild", value: "wild" },
		{ label: "Cohesive", value: "cohesive" },
	];
	const PREVIEW_MAX = 6;
	const PREVIEW_SHORT = 150;

	let seed = $state(randomSeed());
	let count = $state("16");
	let ratio = $state<RatioLabel>("16:9");
	let palette = $state<string>("");
	let variety = $state<Variety>("wild");
	let kind = $state<GeneratorKind>(
		untrack(() => (single ? "gradient" : "mix")),
	);

	let total = $derived(single ? 1 : Number(count));
	let specs = $derived(
		planBatch(seed, { count: total, variety, kind, palette: palette || null }),
	);
	let target = $derived(size ?? ratioSize(ratio, GENERATED_SHORT_SIDE));
	let aspect = $derived(target.width / target.height);

	let previews = $state<string[]>([]);
	let previewing = $state(false);

	$effect(() => {
		const shown = specs.slice(0, PREVIEW_MAX);
		const w = aspect >= 1 ? Math.round(PREVIEW_SHORT * aspect) : PREVIEW_SHORT;
		const h = aspect >= 1 ? PREVIEW_SHORT : Math.round(PREVIEW_SHORT / aspect);
		let cancelled = false;
		previewing = true;
		(async () => {
			const urls: string[] = [];
			for (const spec of shown) {
				const blob = await renderSpec(spec, w, h, "image/jpeg").catch(
					() => null,
				);
				if (cancelled) {
					urls.forEach((u) => URL.revokeObjectURL(u));
					return;
				}
				if (blob) urls.push(URL.createObjectURL(blob));
				// Show what's ready as it lands rather than all at the end.
				previews.forEach((u) => URL.revokeObjectURL(u));
				previews = [...urls];
			}
			previewing = false;
		})();
		return () => {
			cancelled = true;
		};
	});

	onDestroy(() => previews.forEach((u) => URL.revokeObjectURL(u)));

	let busy = $state(false);
	let done = $state(0);

	async function use() {
		if (busy) return;
		busy = true;
		done = 0;
		try {
			const files = await specsToFiles(
				specs as GeneratedSpec[],
				target.width,
				target.height,
				(n) => (done = n),
			);
			onUse(files);
		} finally {
			busy = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			if (!busy) onClose();
		} else if (
			e.key === " " &&
			!busy &&
			!(e.target instanceof HTMLButtonElement)
		) {
			e.preventDefault();
			seed = randomSeed();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<PanelModal
	title="Generate"
	label="Generate images"
	sub="{target.width} × {target.height}"
	{busy}
	{onClose}
>
	{#snippet icon()}<Palette size={12} />{/snippet}
	<div class="controls">
		<div class="ctrl">
			<span class="label">Field</span>
			<ButtonGroup buttons={KINDS} value={kind} onchange={(v) => (kind = v)} />
		</div>
		{#if !single}
			<div class="ctrl">
				<span class="label">Count</span>
				<ButtonGroup
					buttons={COUNTS}
					value={count}
					onchange={(v) => (count = v)}
				/>
			</div>
		{/if}
		{#if !size}
			<div class="ctrl">
				<span class="label">Ratio</span>
				<ButtonGroup
					buttons={RATIOS.map((r) => ({ label: r.label, value: r.label }))}
					value={ratio}
					onchange={(v) => (ratio = v)}
				/>
			</div>
		{/if}
		<div class="ctrl">
			<span class="label">Palette</span>
			<select bind:value={palette}>
				<option value="">Random</option>
				{#each Object.keys(PALETTES) as name}
					<option value={name}>{name}</option>
				{/each}
			</select>
		</div>
		{#if !single}
			<div class="ctrl">
				<span class="label">Variety</span>
				<ButtonGroup
					buttons={VARIETIES}
					value={variety}
					onchange={(v) => (variety = v)}
				/>
			</div>
		{/if}
	</div>

	<div class="strip" class:single style:--aspect={aspect}>
		{#each specs.slice(0, PREVIEW_MAX) as _, i (i)}
			<div class="cell">
				<div class="thumb" class:pending={!previews[i]}>
					{#if previews[i]}
						<img src={previews[i]} alt="" />
					{/if}
				</div>
			</div>
		{/each}
	</div>
	{#if !single && total > PREVIEW_MAX}
		<p class="hint">
			First {PREVIEW_MAX} of {total}. Reroll to see another set.
		</p>
	{/if}

	<div class="actions">
		<button
			class="btn"
			onclick={() => (seed = randomSeed())}
			disabled={busy}
			title="Reroll (Space)"
		>
			<RefreshCw size={12} class={previewing ? "spin" : ""} />
			Reroll
		</button>
		<span class="spacer"></span>
		<button class="btn" onclick={onClose} disabled={busy}>Cancel</button>
		<button class="btn use" onclick={use} disabled={busy}>
			{#if busy}
				Rendering {done}/{total}…
			{:else}
				Use {single ? "image" : `${total} images`}
			{/if}
		</button>
	</div>
</PanelModal>

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem 1.2rem;
	}

	.ctrl {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	select {
		background: var(--sunken);
		color: var(--text-2);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		padding: 0.3rem 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		cursor: pointer;
		outline: none;
	}

	/* Cells are fixed boxes so a ratio change never resizes the panel. */
	.strip {
		display: grid;
		--cell-h: 150px;
		grid-template-columns: repeat(3, 1fr);
		grid-auto-rows: var(--cell-h);
		gap: 0.4rem;
	}
	.strip.single {
		--cell-h: 260px;
		grid-template-columns: minmax(0, 420px);
		justify-content: center;
	}

	.cell {
		display: grid;
		place-items: center;
		min-width: 0;
		min-height: 0;
	}

	.thumb {
		aspect-ratio: var(--aspect);
		width: min(100%, calc(var(--cell-h) * var(--aspect)));
		border-radius: var(--r-2);
		overflow: hidden;
		background: var(--sunken);
		border: 1px solid var(--line);
	}
	.thumb.pending {
		animation: pulse 1.2s ease-in-out infinite;
	}
	.thumb img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	@keyframes pulse {
		50% {
			background: var(--raised);
		}
	}

	.hint {
		margin: -0.3rem 0 0;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		color: var(--text-3);
		letter-spacing: 0.06em;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.spacer {
		flex: 1;
	}

	:global(.spin) {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
