<script lang="ts">
	import ContextMenu from "./ContextMenu.svelte";
	import { ChevronLeft, ChevronRight, Diamond } from "lucide-svelte";

	/** A slider's keyframe switch: hidden until its row is hovered, unless the value
	 * is animated. With a previous/next pair once there are keys to step between. */
	interface Props {
		/** The setting's name, for screen readers. */
		label: string;
		keyed: boolean;
		/** A key sits at the playhead. */
		here: boolean;
		/** The tooltip before anything is keyed. */
		startHint: string;
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
		onToggle,
		prev = null,
		next = null,
		menu = [],
		group = null,
	}: Props = $props();

	let menuAt = $state<{ x: number; y: number } | null>(null);

	function openMenu(e: MouseEvent) {
		if (menu.length === 0) return;
		e.preventDefault();
		menuAt = { x: e.clientX, y: e.clientY };
	}

	const REMOVE_HINT =
		"Remove the key here. Shift-click stops the animation and keeps the value on screen.";
	const MENU_HINT = " Right-click to group it with other settings.";
	const GROUP_HINT =
		"In group {g}. It follows the group's keys within its own range.";
	const ADD_HINT =
		"Key the value shown here. Shift-click stops the animation and keeps the value on screen.";
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
		aria-pressed={keyed}
		title={(!keyed ? startHint : here ? REMOVE_HINT : ADD_HINT) +
			(menu.length > 0 ? MENU_HINT : "")}
		aria-label={!keyed
			? `Animate ${label}`
			: here
				? `Remove the key on ${label}`
				: `Add a key on ${label}`}
		onclick={(e) => onToggle(e.shiftKey)}
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
		{#each menu as item (item.label)}
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
		opacity: 0;
		transition: opacity var(--t-fast);
	}

	/* Out of the way until its row is hovered, and for good once the value animates. */
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
