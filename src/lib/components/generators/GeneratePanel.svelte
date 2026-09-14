<script lang="ts">
	import { RefreshCw, Sparkles, X } from "lucide-svelte";
	import { onDestroy, onMount, untrack } from "svelte";
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
	import { pushModalKeyboard } from "../../modal-keyboard";
	import ButtonGroup from "../ui/ButtonGroup.svelte";

	interface Props {
		/** Single mode makes one image; the multi modes make a set. */
		single: boolean;
		/**
		 * Opened from inside an editor: render straight at its output size and
		 * skip the ratio choice.
		 */
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
	/** How many of the batch the strip shows. */
	const PREVIEW_MAX = 6;
	const PREVIEW_SHORT = 150;

	let seed = $state(randomSeed());
	let count = $state("16");
	let ratio = $state<RatioLabel>("16:9");
	let palette = $state<string>("");
	let variety = $state<Variety>("wild");
	let kind = $state<GeneratorKind>(untrack(() => (single ? "gradient" : "mix")));

	let total = $derived(single ? 1 : Number(count));
	let specs = $derived(
		planBatch(seed, { count: total, variety, kind, palette: palette || null }),
	);
	let target = $derived(size ?? ratioSize(ratio, GENERATED_SHORT_SIDE));
	let aspect = $derived(target.width / target.height);

	// ── Preview strip ──
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

	// ── Use ──
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

	onMount(() => pushModalKeyboard());

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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="overlay" onclick={() => !busy && onClose()}>
	<div
		class="panel"
		role="dialog"
		aria-modal="true"
		aria-label="Generate images"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="head">
			<span class="title"><Sparkles size={12} /> Generate</span>
			<span class="sub">{target.width} × {target.height}</span>
			<button
				class="close"
				onclick={onClose}
				disabled={busy}
				aria-label="Close"
			>
				<X size={14} />
			</button>
		</div>

		<div class="controls">
			<div class="ctrl">
				<span class="label">Field</span>
				<ButtonGroup
					buttons={KINDS}
					value={kind}
					onchange={(v) => (kind = v)}
				/>
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
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		width: 640px;
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 2rem);
		padding: 1rem 1.1rem 1.1rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
		overflow: auto;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.title {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--mosh);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.sub {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		color: var(--text-3);
		letter-spacing: 0.08em;
	}

	.close {
		margin-left: auto;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--r-1);
		background: transparent;
		color: var(--text-3);
		cursor: pointer;
	}
	.close:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.06);
	}

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

	.label {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-3);
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

	.btn {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.85rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		border-radius: var(--r-2);
		border: 1px solid var(--line-strong);
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-2);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}
	.btn:hover:not(:disabled) {
		color: var(--text);
		border-color: var(--text-3);
	}
	.btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.btn.use {
		color: var(--ink);
		background: var(--mosh);
		border-color: var(--mosh);
	}
	.btn.use:hover:not(:disabled) {
		filter: brightness(1.1);
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
