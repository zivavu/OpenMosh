<script lang="ts">
	import { MousePointer2, X } from "lucide-svelte";
	import { onMount } from "svelte";
	import { pushModalKeyboard } from "../../modal-keyboard";

	interface ShortcutGroup {
		title: string;
		shortcuts: { keys: string[]; description: string }[];
	}

	interface Props {
		groups: ShortcutGroup[];
		onClose: () => void;
	}

	let { groups, onClose }: Props = $props();

	// The editor's own shortcuts stay off while the sheet has the keyboard —
	// pressing Space here is a question, not a transport command.
	onMount(() => pushModalKeyboard());

	const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
	const MOD_LABEL: Record<string, string> = isMac
		? { "Ctrl/Cmd": "⌘", Shift: "⇧", Alt: "⌥" }
		: { "Ctrl/Cmd": "Ctrl" };
	const GESTURE = /click|drag|drop|scroll|solo/i;

	interface Chip {
		label: string;
		mouse: boolean;
	}

	/** "Ctrl/Cmd+Shift+Click" into its chips. A lone "+" is a key, not glue. */
	function chips(combo: string): Chip[] {
		const parts = combo.length === 1 ? [combo] : combo.split("+");
		return parts.map((p) => ({
			label: MOD_LABEL[p] ?? p,
			mouse: GESTURE.test(p),
		}));
	}

	// ── Navigation ───────────────────────────────────────────────────────────
	let active = $state(0);
	let group = $derived(groups[Math.min(active, groups.length - 1)]);

	// ── Ask the sheet ────────────────────────────────────────────────────────
	// Press a key and the rows it belongs to light up; if none of them are in
	// the open group, the sheet turns to the first group that has one.
	const KEY_NAMES: Record<string, string> = {
		" ": "Space",
		Escape: "Esc",
		ArrowLeft: "←",
		ArrowRight: "→",
		"=": "+",
	};
	const MODIFIER_KEYS = new Set(["Control", "Meta", "Shift", "Alt"]);

	/** The rows a keypress names, as "group:row" ids. */
	function rowsFor(e: KeyboardEvent): Set<string> {
		const hits = new Set<string>();
		const heldMod = MODIFIER_KEYS.has(e.key);
		const name =
			KEY_NAMES[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
		const wantMod = e.ctrlKey || e.metaKey;
		groups.forEach((g, gi) => {
			g.shortcuts.forEach((row, ri) => {
				const matched = row.keys.some((combo) => {
					const parts = combo.length === 1 ? [combo] : combo.split("+");
					if (parts.some((p) => GESTURE.test(p))) return false;
					if (heldMod) {
						// A bare modifier: show everything it takes part in.
						const want =
							e.key === "Shift"
								? "Shift"
								: e.key === "Alt"
									? "Alt"
									: "Ctrl/Cmd";
						return parts.includes(want);
					}
					const key = parts[parts.length - 1];
					// "+" is Shift+= on most layouts, so Shift doesn't count against it.
					return (
						key.toUpperCase() === name &&
						parts.includes("Ctrl/Cmd") === wantMod &&
						(name === "+" || parts.includes("Shift") === e.shiftKey) &&
						parts.includes("Alt") === e.altKey
					);
				});
				if (matched) hits.add(`${gi}:${ri}`);
			});
		});
		return hits;
	}

	let lit = $state<Set<string>>(new Set());
	let litLabel = $state("");

	function onKeydown(e: KeyboardEvent) {
		e.preventDefault();
		if (e.key === "Escape") {
			onClose();
			return;
		}
		if (e.repeat) return;
		const digit = Number(e.key);
		if (!e.ctrlKey && !e.metaKey && !e.altKey) {
			if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) {
				active = (active + 1) % groups.length;
				return;
			}
			if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) {
				active = (active + groups.length - 1) % groups.length;
				return;
			}
			if (digit >= 1 && digit <= groups.length) {
				active = digit - 1;
				return;
			}
		}
		const hits = rowsFor(e);
		lit = hits;
		litLabel = hits.size > 0 ? "" : "nothing bound";
		const here = [...hits].some((id) => id.startsWith(`${active}:`));
		if (!here && hits.size > 0) {
			active = Number([...hits][0].split(":")[0]);
		}
	}

	function onKeyup() {
		lit = new Set();
		litLabel = "";
	}
</script>

<svelte:window onkeydowncapture={onKeydown} onkeyupcapture={onKeyup} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="overlay" onclick={onClose}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sheet" onclick={(e) => e.stopPropagation()}>
		<nav class="rail">
			<span class="rail-title rack-label">Shortcuts</span>
			{#each groups as g, i (g.title)}
				<button
					class="tab"
					class:active={i === active}
					class:has-lit={[...lit].some((id) => id.startsWith(`${i}:`))}
					onclick={() => (active = i)}
				>
					<span class="tab-n">{i + 1}</span>
					<span class="tab-name">{g.title}</span>
				</button>
			{/each}
			<p class="rail-hint">
				Press any key to find what it does. Hold a modifier to see all of its
				combos.
			</p>
		</nav>

		<section class="pane">
			<header class="pane-head">
				<h2 class="pane-title">{group.title}</h2>
				<span class="pane-status" class:live={lit.size > 0}>
					{lit.size > 0 ? `${lit.size} bound` : litLabel}
				</span>
				<button class="close-btn" onclick={onClose} title="Close">
					<X size={14} />
				</button>
			</header>
			{#key active}
				<ul class="rows">
					{#each group.shortcuts as row, ri (row.description)}
						<li
							class="row"
							class:lit={lit.has(`${active}:${ri}`)}
							class:dim={lit.size > 0 && !lit.has(`${active}:${ri}`)}
							style="--i: {ri}"
						>
							<span class="keys">
								{#each row.keys as combo, i (combo)}
									{#if i > 0}<span class="or">or</span>{/if}
									<span class="combo">
										{#each chips(combo) as chip, j (j)}
											{#if chip.mouse}
												<span class="mouse"
													><MousePointer2 size={10} />{chip.label}</span
												>
											{:else}
												<kbd>{chip.label}</kbd>
											{/if}
										{/each}
									</span>
								{/each}
							</span>
							<span class="description">{row.description}</span>
						</li>
					{/each}
				</ul>
			{/key}
		</section>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.sheet {
		display: grid;
		grid-template-columns: 172px 1fr;
		width: min(780px, 100vw - 2rem);
		height: min(520px, 100vh - 2rem);
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
		overflow: hidden;
		animation: sheet-in 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	@keyframes sheet-in {
		from {
			opacity: 0;
			transform: translateY(10px) scale(0.985);
		}
	}

	/* ── Rail ─────────────────────────────────────────────────────────────── */
	.rail {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 1rem 0.6rem;
		background: var(--sunken);
		border-right: 1px solid var(--line);
	}

	.rail-title {
		padding: 0 0.6rem 0.75rem;
		color: var(--text);
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.5rem 0.6rem;
		background: none;
		border: none;
		border-radius: var(--r-2);
		color: var(--text-3);
		font-family: var(--font-ui);
		font-size: 0.8rem;
		text-align: left;
		cursor: pointer;
		position: relative;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.tab:hover {
		color: var(--text-2);
		background: var(--raised);
	}

	.tab.active {
		color: var(--text);
		background: var(--raised);
	}

	/* The lit channel: a live bar down the left edge. */
	.tab::before {
		content: "";
		position: absolute;
		left: 0;
		top: 25%;
		height: 50%;
		width: 2px;
		border-radius: 1px;
		background: var(--live);
		transform: scaleY(0);
		transition: transform var(--t);
	}

	.tab.active::before,
	.tab.has-lit::before {
		transform: scaleY(1);
	}

	.tab.has-lit:not(.active) {
		color: var(--live);
	}

	.tab-n {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--text-4);
		width: 0.6rem;
	}

	.tab.active .tab-n {
		color: var(--live);
	}

	.rail-hint {
		margin: auto 0 0;
		padding: 0.75rem 0.6rem 0;
		font-size: 0.68rem;
		line-height: 1.45;
		color: var(--text-4);
		text-wrap: pretty;
	}

	/* ── Pane ─────────────────────────────────────────────────────────────── */
	.pane {
		display: flex;
		flex-direction: column;
		min-width: 0;
		padding: 1rem 1.25rem 1.25rem;
		overflow-y: auto;
	}

	.pane-head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.pane-title {
		margin: 0;
		font-family: var(--font-ui);
		font-size: 1.35rem;
		font-weight: 600;
		letter-spacing: -0.015em;
		color: var(--text);
	}

	.pane-status {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-4);
		transition: color var(--t-fast);
	}

	.pane-status.live {
		color: var(--live);
	}

	.close-btn {
		margin-left: auto;
		align-self: center;
		display: flex;
		padding: 4px;
		background: none;
		border: none;
		border-radius: var(--r-1);
		color: var(--text-3);
		cursor: pointer;
	}

	.close-btn:hover {
		color: var(--text);
		background: var(--raised);
	}

	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: fit-content(12rem) 1fr;
		column-gap: 1rem;
	}

	.row {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
		align-items: center;
		padding: 0.38rem 0.5rem;
		margin: 0 -0.5rem;
		border-radius: var(--r-2);
		animation: row-in 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) both;
		animation-delay: calc(var(--i) * 22ms);
		transition:
			opacity var(--t-fast),
			background var(--t-fast);
	}

	@keyframes row-in {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}

	.row.lit {
		background: color-mix(in srgb, var(--live) 9%, transparent);
	}

	.row.dim {
		opacity: 0.35;
	}

	.keys {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem 0.4rem;
	}

	.combo {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}

	.or {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		color: var(--text-4);
	}

	kbd {
		display: inline-flex;
		align-items: center;
		min-width: 1.5rem;
		justify-content: center;
		padding: 0.22rem 0.42rem;
		font-family: var(--font-mono);
		font-size: 0.64rem;
		font-weight: 500;
		line-height: 1;
		white-space: nowrap;
		color: var(--text);
		background: var(--raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.6);
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			box-shadow var(--t-fast);
	}

	.row.lit kbd {
		color: var(--live);
		border-color: var(--live);
		box-shadow:
			inset 0 -1px 0 rgba(0, 0, 0, 0.6),
			0 0 0 1px color-mix(in srgb, var(--live) 30%, transparent);
	}

	/* A gesture is not a key: mono text with a cursor, no cap. */
	.mouse {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-family: var(--font-mono);
		font-size: 0.64rem;
		white-space: nowrap;
		color: var(--text-2);
	}

	.description {
		font-size: 0.78rem;
		color: var(--text-2);
		text-wrap: pretty;
	}

	.row.lit .description {
		color: var(--text);
	}

	@media (max-width: 640px) {
		.sheet {
			grid-template-columns: 1fr;
			grid-template-rows: auto 1fr;
			height: min(620px, 100vh - 2rem);
		}

		.rail {
			flex-direction: row;
			flex-wrap: wrap;
			padding: 0.6rem;
			border-right: none;
			border-bottom: 1px solid var(--line);
		}

		.rail-title,
		.rail-hint,
		.tab-n {
			display: none;
		}

		.tab {
			width: auto;
			padding: 0.35rem 0.6rem;
		}

		.tab::before {
			display: none;
		}
	}
</style>
