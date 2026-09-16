<script lang="ts">
	import { MousePointer2, X } from "lucide-svelte";

	interface ShortcutGroup {
		title: string;
		shortcuts: { keys: string[]; description: string }[];
	}

	interface Props {
		groups: ShortcutGroup[];
		onClose: () => void;
	}

	let { groups, onClose }: Props = $props();

	const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
	// The rows write "Ctrl/Cmd" once; the chip shows only the modifier this
	// machine actually has.
	const MODIFIERS: Record<string, string> = isMac
		? { "Ctrl/Cmd": "⌘", Shift: "⇧", Alt: "⌥" }
		: { "Ctrl/Cmd": "Ctrl" };
	const GESTURE = /click|drag|drop|scroll|solo/i;

	interface Chip {
		label: string;
		mouse: boolean;
	}

	/** One combo like "Ctrl/Cmd+Shift+Click" into its chips. A lone "+" is a
	 * key, not a separator. */
	function chips(combo: string): Chip[] {
		const parts = combo.length === 1 ? [combo] : combo.split("+");
		return parts.map((p) => ({
			label: MODIFIERS[p] ?? p,
			mouse: GESTURE.test(p),
		}));
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") onClose();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="shortcuts-overlay" onclick={onClose}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="shortcuts-modal" onclick={(e) => e.stopPropagation()}>
		<div class="header">
			<span class="title">Keyboard shortcuts</span>
			<span class="legend">
				<kbd class="key">Key</kbd>
				<kbd class="mouse"><MousePointer2 size={9} />Mouse</kbd>
			</span>
			<button class="close-btn" onclick={onClose} title="Close">
				<X size={14} />
			</button>
		</div>
		<div class="groups">
			{#each groups as group (group.title)}
				<div class="group">
					<div class="group-head">
						<span class="rack-label">{group.title}</span>
					</div>
					<ul class="shortcut-list">
						{#each group.shortcuts as shortcut (shortcut.description)}
							<li class="shortcut-row">
								<span class="keys">
									{#each shortcut.keys as combo, i (combo)}
										{#if i > 0}<span class="sep">/</span>{/if}
										<span class="combo">
											{#each chips(combo) as chip, j (j)}
												{#if j > 0}<span class="plus">+</span>{/if}
												<kbd class={chip.mouse ? "mouse" : "key"}>
													{#if chip.mouse}<MousePointer2 size={9} />{/if}
													{chip.label}
												</kbd>
											{/each}
										</span>
									{/each}
								</span>
								<span class="description">{shortcut.description}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	.shortcuts-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.shortcuts-modal {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		width: min(940px, 100vw - 2rem);
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		padding: 1.25rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
	}

	.header {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.title {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.legend {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin-left: auto;
	}

	.close-btn {
		background: none;
		border: none;
		color: var(--text-3);
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
	}

	.close-btn:hover {
		color: var(--text);
	}

	/* Groups pack like a magazine page: a short group sits under another short
	   one instead of leaving a tall empty column. */
	.groups {
		columns: 270px;
		column-gap: 1.75rem;
	}

	.group {
		break-inside: avoid;
		padding-bottom: 1.1rem;
	}

	/* A rack label with a hairline running off it, like the panel heads. */
	.group-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.35rem;
	}

	.group-head .rack-label {
		color: var(--text-2);
	}

	.group-head::after {
		content: "";
		flex: 1;
		height: 1px;
		background: var(--line-strong);
	}

	/* Keys in one fixed-width column, descriptions ragged-right beside them —
	   both left-aligned so the eye scans a straight edge. */
	.shortcut-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: fit-content(10.5rem) 1fr;
		column-gap: 0.75rem;
	}

	.shortcut-row {
		display: grid;
		grid-template-columns: subgrid;
		grid-column: 1 / -1;
		align-items: baseline;
		padding: 0.3rem 0;
		border-bottom: 1px solid var(--line);
	}

	.shortcut-row:last-child {
		border-bottom: none;
	}

	.keys {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.35rem;
	}

	.combo {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}

	.sep,
	.plus {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--text-4);
	}

	kbd {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 500;
		line-height: 1;
		padding: 0.22rem 0.4rem;
		border-radius: var(--r-1);
	}

	/* A real keycap: raised, with a lip. */
	kbd.key {
		color: var(--text);
		background: var(--raised);
		border: 1px solid var(--line-strong);
		box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.6);
	}

	/* A gesture is not a key, so no cap — an outline only. */
	kbd.mouse {
		color: var(--text-2);
		background: transparent;
		border: 1px solid var(--line);
		border-style: dashed;
	}

	.description {
		font-size: 0.75rem;
		color: var(--text-2);
		text-align: left;
	}
</style>
