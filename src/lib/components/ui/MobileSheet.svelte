<script lang="ts">
	import type { Snippet } from "svelte";

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
		/**
		 * The top panel renders `settings` itself, so the sidebar shouldn't. For
		 * a panel that ends in an effect chain of its own, which the settings
		 * have to sit above. Mobile is unaffected: its tabs never show both.
		 */
		settingsInTopPanel?: boolean;
		/** Tab names. The first tab is the top panel's while one is showing. */
		settingsLabel?: string;
		effectsLabel?: string;
		topPanelLabel?: string;
	}

	let {
		children,
		settings,
		effectsPanel,
		topPanel,
		settingsInTopPanel = false,
		settingsLabel = "Settings",
		effectsLabel = "Chain",
		topPanelLabel = "Layer",
	}: Props = $props();

	const SHEET_HEIGHT_VH = 70;
	let panelOpen = $state(false);
	let sheetDragOffset = $state(0);
	let sheetDragging = $state(false);
	let sheetHandleEl = $state<HTMLButtonElement>();
	let activeTab = $state<"settings" | "effects">("effects");

	// Picking a clip is asking for its panel, whichever tab was open.
	$effect(() => {
		if (topPanel) activeTab = "effects";
	});

	export function openSheet() {
		panelOpen = true;
	}

	$effect(() => {
		const el = sheetHandleEl;
		if (!el) return;
		el.addEventListener("touchstart", onSheetTouchStart, { passive: false });
		return () => el.removeEventListener("touchstart", onSheetTouchStart);
	});

	function onSheetPointerDown(e: PointerEvent) {
		if (e.pointerType === "touch") return;
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
				"touches" in ev ? (ev.touches[0]?.clientY ?? startY) : ev.clientY;
			const delta = clientY - startY;
			if (Math.abs(delta) > 4) moved = true;
			sheetDragOffset = Math.max(
				0,
				Math.min(maxTranslate, currentTranslateY + delta),
			);
		}

		function onUp(ev: TouchEvent | PointerEvent) {
			window.removeEventListener("touchmove", onMove as EventListener);
			window.removeEventListener("touchend", onUp as EventListener);
			window.removeEventListener("pointermove", onMove as EventListener);
			window.removeEventListener("pointerup", onUp as EventListener);
			sheetDragging = false;
			sheetDragOffset = 0;
			const clientY =
				"changedTouches" in ev
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

		window.addEventListener("touchmove", onMove as EventListener, {
			passive: false,
		});
		window.addEventListener("touchend", onUp as EventListener);
		window.addEventListener("pointermove", onMove as EventListener);
		window.addEventListener("pointerup", onUp as EventListener);
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
	style={sheetDragging ? `transform: translateY(${sheetDragOffset}px)` : ""}
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
		<!-- One tab at a time, on every width. The chain is the working
		     surface, so it gets the full height; the settings are one tab
		     away rather than a block it has to scroll past. -->
		<div class="tab-bar" role="tablist">
			<button
				class="tab-btn"
				class:active={activeTab === "effects"}
				role="tab"
				aria-selected={activeTab === "effects"}
				onclick={() => (activeTab = "effects")}
				>{topPanel ? topPanelLabel : effectsLabel}</button
			>
			<button
				class="tab-btn"
				class:active={activeTab === "settings"}
				role="tab"
				aria-selected={activeTab === "settings"}
				onclick={() => (activeTab = "settings")}>{settingsLabel}</button
			>
		</div>
		<div class="tab-content">
			{#if activeTab === "settings"}
				{@render settings!()}
			{:else if topPanel}
				{@render topPanel()}
			{:else}
				{@render effectsPanel!()}
			{/if}
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
		display: flex;
		flex-shrink: 0;
		padding: 0.4rem 0.5rem 0;
		gap: 0.25rem;
		border-bottom: 1px solid var(--line);
	}

	/* A rack label per tab; the live bar under the open one. */
	.tab-btn {
		position: relative;
		padding: 0.5rem 0.6rem 0.6rem;
		background: none;
		border: none;
		color: var(--text-4);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		cursor: pointer;
		transition: color var(--t);
	}

	.tab-btn::after {
		content: "";
		position: absolute;
		left: 0.6rem;
		right: 0.6rem;
		bottom: -1px;
		height: 2px;
		border-radius: 1px;
		background: var(--live);
		transform: scaleX(0);
		transition: transform var(--t);
	}

	.tab-btn.active {
		color: var(--text);
	}

	.tab-btn.active::after {
		transform: scaleX(1);
	}

	.tab-btn:hover:not(.active) {
		color: var(--text-2);
	}

	.tab-content {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	.tab-content > :global(*) {
		flex: 0 0 auto;
		max-width: 100%;
	}

	/* The chain owns the tab's height and scrolls inside it. */
	.tab-content > :global(.effects-panel) {
		flex: 1 1 auto;
		min-height: 0;
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
			justify-content: center;
		}

		.tab-btn {
			flex: 1;
		}
	}
</style>
