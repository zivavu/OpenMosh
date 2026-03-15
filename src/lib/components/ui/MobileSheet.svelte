<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();

	const SHEET_HEIGHT_VH = 70;
	let panelOpen = $state(false);
	let sheetDragOffset = $state(0);
	let sheetDragging = $state(false);
	let sheetHandleEl = $state<HTMLButtonElement>();

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
			const clientY = 'touches' in ev ? ev.touches[0]?.clientY ?? startY : ev.clientY;
			const delta = clientY - startY;
			if (Math.abs(delta) > 4) moved = true;
			sheetDragOffset = Math.max(0, Math.min(maxTranslate, currentTranslateY + delta));
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
					? ev.changedTouches[0]?.clientY ?? startY
					: (ev as PointerEvent).clientY;
			const delta = clientY - startY;
			if (!moved) {
				panelOpen = !startOpen;
			} else {
				const threshold = 60;
				panelOpen = startOpen ? delta < threshold : delta < -threshold;
			}
		}

		window.addEventListener('touchmove', onMove as EventListener, { passive: false });
		window.addEventListener('touchend', onUp as EventListener);
		window.addEventListener('pointermove', onMove as EventListener);
		window.addEventListener('pointerup', onUp as EventListener);
	}
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
	{@render children()}
</div>

<style>
	.sheet-container {
		display: flex;
		flex-direction: column;
		border-left: 1px solid #2a2a2a;
		height: 100%;
		flex-shrink: 0;
		overflow: hidden;
	}

	.sheet-handle-row {
		display: none;
	}

	@media (max-width: 800px) {
		.sheet-container {
			position: fixed;
			bottom: 0;
			left: 0;
			right: 0;
			height: 70vh;
			border-left: none;
			border-top: 1px solid #2a2a2a;
			border-radius: 12px 12px 0 0;
			transform: translateY(calc(70vh - 44px));
			transition: transform 0.3s ease;
			z-index: 50;
			overflow-y: auto;
			background: #161616;
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
			background: #161616;
			border: none;
			cursor: pointer;
			padding: 0;
			touch-action: none;
		}

		.sheet-handle {
			width: 36px;
			height: 3px;
			border-radius: 2px;
			background: #555;
		}
	}
</style>
