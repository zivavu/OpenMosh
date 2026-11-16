<script lang="ts">
	import ContextMenu from "./ContextMenu.svelte";
	import { ChevronLeft, ChevronRight, Diamond } from "lucide-svelte";

	/** A slider's keyframe switch: a click adds or removes the key at the playhead,
	 * a right-click stops the animation or groups it. Faint until its row is
	 * hovered, unless the value is animated. With a previous/next pair once there
	 * are keys to step between. */
	interface Props {
		/** The setting's name, for screen readers. */
		label: string;
		keyed: boolean;
		/** A key sits at the playhead. */
		here: boolean;
		/** The tooltip before anything is keyed. */
		startHint: string;
		/** Why no key can be set right now, or null when one can. */
		blocked?: string | null;
		onToggle: (clear: boolean) => void;
		/** Null when there is no key that way. */
		prev?: (() => void) | null;
		next?: (() => void) | null;
		/** Right-click choices, such as the groups it can join. */
		menu?: { label: string; onSelect: () => void }[];
		/** The group it follows, shown as a tag in the group's colour. */
		group?: { name: string; color: string } | null;
	}

	let {
		label,
		keyed,
		here,
		startHint,
		blocked = null,
		onToggle,
		prev = null,
		next = null,
		menu = [],
		group = null,
	}: Props = $props();

	const STOP_LABEL = "Stop animating, keep this value";
	const REMOVE_HINT = "Remove the key here.";
	const ADD_HINT = "Add a key here with the value shown.";
	const MENU_HINT = " Right-click to stop animating or group it.";
	const GROUP_HINT =
		"In group {g}. It follows the group's keys within its own range.";

	let menuAt = $state<{ x: number; y: number } | null>(null);

	let items = $derived([
		...(keyed && !blocked
			? [{ label: STOP_LABEL, onSelect: () => onToggle(true) }]
			: []),
		...menu,
	]);

	function openMenu(e: MouseEvent) {
		if (items.length === 0) return;
		e.preventDefault();
		menuAt = { x: e.clientX, y: e.clientY };
	}
</script>

<span class="key-diamond" class:keyed>
	{#if group}
		<span
			class="group-tag"
			style="--group: {group.color}"
			title={GROUP_HINT.replace("{g}", group.name)}>{group.name}</span
		>
	{/if}
	{#if keyed}
		<button
			type="button"
			class="key-step"
			title="Previous key"
			aria-label="Previous key of {label}"
			disabled={!prev}
			onclick={() => prev?.()}
		>
			<ChevronLeft size={11} />
		</button>
	{/if}
	<button
		type="button"
		class="key-btn"
		class:here
		class:blocked
		aria-pressed={keyed}
		aria-disabled={!!blocked}
		title={blocked ??
			(!keyed ? startHint : (here ? REMOVE_HINT : ADD_HINT) + MENU_HINT)}
		aria-label={!keyed
			? `Animate ${label}`
			: here
				? `Remove the key on ${label}`
				: `Add a key on ${label}`}
		onclick={(e) => {
			if (!blocked) onToggle(e.shiftKey);
		}}
		oncontextmenu={openMenu}
		ondblclick={(e) => e.stopPropagation()}
	>
		<Diamond size={11} />
	</button>
	{#if keyed}
		<button
			type="button"
			class="key-step"
			title="Next key"
			aria-label="Next key of {label}"
			disabled={!next}
			onclick={() => next?.()}
		>
			<ChevronRight size={11} />
		</button>
	{/if}
</span>

{#if menuAt}
	<ContextMenu x={menuAt.x} y={menuAt.y} onClose={() => (menuAt = null)}>
		{#each items as item (item.label)}
			<button
				type="button"
				role="menuitem"
				onclick={() => {
					item.onSelect();
					menuAt = null;
				}}>{item.label}</button
			>
		{/each}
	</ContextMenu>
{/if}

<style>
	.group-tag {
		-webkit-user-select: none;
		user-select: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 14px;
		height: 14px;
		padding: 0 3px;
		margin-right: 2px;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		font-weight: 600;
		color: var(--ink);
		background: var(--group);
		border-radius: 3px;
	}

	.key-diamond {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		opacity: 0.3;
		transition: opacity var(--t-fast);
	}

	/* Faint until its row is hovered, and lit for good once the value animates. */
	:global(.param-row:hover) .key-diamond,
	:global(.row:hover) .key-diamond,
	.key-diamond:focus-within,
	.key-diamond.keyed {
		opacity: 1;
	}

	.key-btn,
	.key-step {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--r-1);
		color: var(--text-3);
		cursor: pointer;
	}

	.key-btn.blocked {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.key-step:disabled {
		opacity: 0.3;
		cursor: default;
	}

	.key-btn:hover,
	.key-step:not(:disabled):hover {
		color: var(--text);
	}

	.keyed .key-btn {
		color: var(--live);
	}

	.key-btn.here :global(svg) {
		fill: currentColor;
	}
</style>
