<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children?: Snippet;
		settings?: Snippet;
		effectsPanel?: Snippet;
		/**
		 * Takes the top of the sidebar, above the settings — for an editor whose
		 * subject the user just picked and is working on now. On mobile it takes
		 * over the Effects tab, so the Settings tab is still one tap away.
		 */
		topPanel?: Snippet;
	}

	let { children, settings, effectsPanel, topPanel }: Props = $props();

	const SHEET_HEIGHT_VH = 70;
	let panelOpen = $state(false);
	let sheetDragOffset = $state(0);
	let sheetDragging = $state(false);
	let sheetHandleEl = $state<HTMLButtonElement>();
	let activeTab = $state<'settings' | 'effects'>('effects');

	export function openSheet() {
		panelOpen = true;
	}

	$effect(() => {
		const el = sheetHandleEl;
		if (!el) return;
		el.addEventListener('touchstart', onSheetTouchStart, { passive: false });
		return () => el.removeEventListener('touchstart', onSheetTouchStart);
	});

	function onSheetPointerDown(e: PointerEvent) {
		if (e.pointerType === 'touch') return;
		beginSheetDrag(e.clientY);
	}

	function onSheetTouchStart(e: TouchEvent) {
		e.preventDefault();
		const touch = e.touches[0];
		if (!touch) return;
		beginSheetDrag(touch.clientY);
	}

	function beginSheetDrag(startClientY: number) {
		const startY = startClientY;
		const startOpen = panelOpen;
		let moved = false;

		const maxTranslate = (window.innerHeight * SHEET_HEIGHT_VH) / 100 - 44;
		const currentTranslateY = startOpen ? 0 : maxTranslate;

		sheetDragOffset = currentTranslateY;
		sheetDragging = true;

		function onMove(ev: TouchEvent | PointerEvent) {
			const clientY =
				'touches' in ev ? (ev.touches[0]?.clientY ?? startY) : ev.clientY;
			const delta = clientY - startY;
			if (Math.abs(delta) > 4) moved = true;
			sheetDragOffset = Math.max(
				0,
				Math.min(maxTranslate, currentTranslateY + delta),
			);
		}

		function onUp(ev: TouchEvent | PointerEvent) {
			window.removeEventListener('touchmove', onMove as EventListener);
			window.removeEventListener('touchend', onUp as EventListener);
			window.removeEventListener('pointermove', onMove as EventListener);
			window.removeEventListener('pointerup', onUp as EventListener);
			sheetDragging = false;
			sheetDragOffset = 0;
			const clientY =
				'changedTouches' in ev
					? (ev.changedTouches[0]?.clientY ?? startY)
					: (ev as PointerEvent).clientY;
			const delta = clientY - startY;
			if (!moved) {
				panelOpen = !startOpen;
			} else {
				const threshold = 60;
				panelOpen = startOpen ? delta < threshold : delta < -threshold;
			}
		}

		window.addEventListener('touchmove', onMove as EventListener, {
			passive: false,
		});
		window.addEventListener('touchend', onUp as EventListener);
		window.addEventListener('pointermove', onMove as EventListener);
		window.addEventListener('pointerup', onUp as EventListener);
	}

	const hasTabs = $derived(!!(settings && effectsPanel));
</script>

{#if panelOpen}
	<button
		class="sheet-backdrop"
		onclick={() => (panelOpen = false)}
		aria-label="Close panel"
	></button>
{/if}
<div
	class="sheet-container"
	class:sheet-open={panelOpen && !sheetDragging}
	class:sheet-dragging={sheetDragging}
	style={sheetDragging ? `transform: translateY(${sheetDragOffset}px)` : ''}
>
	<button
		class="sheet-handle-row"
		bind:this={sheetHandleEl}
		onpointerdown={onSheetPointerDown}
		aria-label="Toggle panel"
		aria-expanded={panelOpen}
	>
		<div class="sheet-handle"></div>
	</button>

	{#if hasTabs}
		<!-- Mobile tab bar (only rendered when both snippets provided) -->
		<div class="tab-bar">
			<button
				class="tab-btn"
				class:active={activeTab === 'settings'}
				onclick={() => (activeTab = 'settings')}>Settings</button
			>
			<button
				class="tab-btn"
				class:active={activeTab === 'effects'}
				onclick={() => (activeTab = 'effects')}>Effects</button
			>
		</div>
		<div class="tab-content">
			{#if activeTab === 'settings'}
				{@render settings!()}
			{:else if topPanel}
				{@render topPanel()}
			{:else}
				{@render effectsPanel!()}
			{/if}
		</div>
		<!-- Desktop: render both stacked normally -->
		<!-- The sidebar scrolls as one region. Its sections are a single column
		     — the clip panel, the settings, the chain — and a section that
		     scrolls on its own strands whatever follows it at the bottom of the
		     window, behind a scrollbar the user has to find first. -->
		<div class="desktop-content">
			{#if topPanel}
				{@render topPanel()}
			{/if}
			{@render settings!()}
			{@render effectsPanel!()}
		</div>
	{:else if children}
		{@render children()}
	{/if}
</div>

<style>
	/* Fixed width rather than sized by whatever is inside it: the sidebar swaps
	   panels as the selection changes, and letting the content decide made it
	   jump between widths on every click. */
	.sheet-container {
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--line);
		height: 100%;
		width: var(--sidebar-w);
		flex-shrink: 0;
		overflow: hidden;
	}

	.sheet-handle-row {
		display: none;
	}

	.tab-bar {
		display: none;
	}

	.desktop-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		/* Firefox has no ::-webkit-scrollbar to narrow, so without this its
		   full-width scrollbar takes a slice out of the column and the panels
		   overflow sideways behind a second, horizontal one. */
		scrollbar-width: thin;
	}

	/* Every section keeps its natural height and the column scrolls past it.
	   Grow as well as shrink: the chain asks for `flex: 1` so it can own the
	   sidebar's height on its own, and left to it would fill this column and
	   scroll inside it — a second scrollbox, which is the one thing this
	   column exists to avoid. */
	.desktop-content > :global(*) {
		flex: 0 0 auto;
		/* The scrollbar takes its width out of this column, so the panels fill
		   what is left rather than insisting on the full sidebar width. */
		max-width: 100%;
	}

	.desktop-content::-webkit-scrollbar {
		width: 4px;
	}

	.desktop-content::-webkit-scrollbar-track {
		background: transparent;
	}

	.desktop-content::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.07);
		border-radius: 2px;
	}

	.desktop-content::-webkit-scrollbar-thumb:hover {
		background: #555;
	}

	.tab-content {
		display: none;
	}

	@media (max-width: 800px) {
		.sheet-container {
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			width: auto;
			height: 50svh;
			border-left: none;
			border-top: 1px solid var(--line);
			border-radius: 12px 12px 0 0;
			transform: translateY(calc(50svh - 44px));
			transition: transform 0.3s ease;
			z-index: 50;
			overflow-y: auto;
			background: var(--surface);
		}

		.sheet-container.sheet-open {
			transform: translateY(0);
		}

		.sheet-container.sheet-dragging {
			transition: none;
		}

		.sheet-backdrop {
			position: fixed;
			inset: 0;
			background: rgba(0, 0, 0, 0.5);
			z-index: 49;
			border: none;
			cursor: default;
			padding: 0;
		}

		.sheet-handle-row {
			display: flex;
			align-items: center;
			justify-content: center;
			height: 44px;
			flex-shrink: 0;
			width: 100%;
			background: var(--surface);
			border: none;
			cursor: pointer;
			padding: 0;
			touch-action: none;
		}

		.sheet-handle {
			width: 36px;
			height: 3px;
			border-radius: 2px;
			background: var(--text-4);
		}

		.tab-bar {
			display: flex;
			flex-shrink: 0;
			border-bottom: 1px solid var(--line);
		}

		.tab-btn {
			flex: 1;
			padding: 0.55rem;
			background: none;
			border: none;
			color: var(--text-4);
			font-size: 0.72rem;
			font-weight: 600;
			letter-spacing: 0.05em;
			cursor: pointer;
			font-family: inherit;
			transition: color 0.15s;
		}

		.tab-btn.active {
			color: var(--text);
			border-bottom: 2px solid var(--text-4);
		}

		.tab-btn:hover:not(.active) {
			color: var(--text-3);
		}

		.tab-content {
			display: flex;
			flex-direction: column;
			flex: 1;
			min-height: 0;
			overflow-y: auto;
		}

		.desktop-content {
			display: none;
		}
	}
</style>
