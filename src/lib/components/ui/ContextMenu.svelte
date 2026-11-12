<script lang="ts">
	import type { Snippet } from "svelte";

	/** A right-click menu at the pointer. It lives on the page's body, so a panel
	 * that clips or makes its own frame for fixed children can't cut it off, and it
	 * moves in from an edge it would run past. */
	interface Props {
		x: number;
		y: number;
		onClose: () => void;
		children: Snippet;
	}

	let { x, y, onClose, children }: Props = $props();

	/** Room kept between the menu and the window's edge. */
	const MARGIN = 8;

	let el: HTMLDivElement | undefined = $state();
	let left = $state(0);
	let top = $state(0);

	$effect(() => {
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		left = Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN));
		top = Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN));
	});

	function toBody(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	$effect(() => {
		const close = (e: Event) => {
			if (e instanceof KeyboardEvent && e.key !== "Escape") return;
			onClose();
		};
		window.addEventListener("pointerdown", close);
		window.addEventListener("keydown", close);
		window.addEventListener("resize", onClose);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("keydown", close);
			window.removeEventListener("resize", onClose);
		};
	});
</script>

<div
	bind:this={el}
	use:toBody
	class="context-menu"
	role="menu"
	tabindex="-1"
	style="left: {left}px; top: {top}px"
	onpointerdown={(e) => e.stopPropagation()}
	oncontextmenu={(e) => e.preventDefault()}
>
	{@render children()}
</div>

<style>
	.context-menu {
		position: fixed;
		z-index: 1000;
		min-width: 160px;
		max-width: calc(100vw - 16px);
		padding: 0.25rem;
		display: flex;
		flex-direction: column;
		background: var(--raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-2);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
	}

	.context-menu :global(button) {
		padding: 0.3rem 0.5rem;
		text-align: left;
		font-size: 0.72rem;
		color: var(--text-2);
		background: none;
		border: none;
		border-radius: var(--r-1);
		cursor: pointer;
		white-space: nowrap;
	}

	.context-menu :global(button:hover) {
		background: var(--sunken);
		color: var(--text);
	}

	.context-menu :global(button.active) {
		color: var(--live);
	}

	.context-menu :global(button.danger:hover) {
		color: var(--rec);
	}

	.context-menu :global(hr) {
		width: 100%;
		margin: 0.2rem 0;
		border: none;
		border-top: 1px solid var(--line);
	}
</style>
