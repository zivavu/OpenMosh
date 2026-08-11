<script lang="ts">
	import type { TimelineViewport } from '../../editor/timeline-viewport.svelte';

	interface Props {
		vp: TimelineViewport;
		trackDuration: number;
		/** Matches the timeline it sits under. */
		accent?: 'blue' | 'purple';
		/** Fires when a pan drag starts, for callers that treat a hand-panned view
		 * as taking over from an automatic one (e.g. playhead following). */
		onPanStart?: (() => void) | null;
	}

	let { vp, trackDuration, accent = 'blue', onPanStart = null }: Props = $props();

	let barEl = $state<HTMLElement | undefined>(undefined);
	let drag: {
		startClientX: number;
		startViewStart: number;
		barWidth: number;
	} | null = null;

	let left = $derived(
		trackDuration > 0 ? (vp.viewStart / trackDuration) * 100 : 0,
	);
	let width = $derived(
		trackDuration > 0
			? Math.max(2, (vp.viewDuration / trackDuration) * 100)
			: 100,
	);

	function onDown(e: PointerEvent) {
		// Unzoomed the thumb fills the bar: there is nowhere to pan, and the drag
		// shouldn't count as the user taking the view over either.
		if (e.button !== 0 || !vp.isZoomed) return;
		e.stopPropagation();
		const rect = barEl?.getBoundingClientRect();
		if (!rect) return;
		onPanStart?.();
		drag = {
			startClientX: e.clientX,
			startViewStart: vp.viewStart,
			barWidth: rect.width,
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onMove(e: PointerEvent) {
		if (!drag) return;
		const { startClientX, startViewStart, barWidth } = drag;
		const delta = ((e.clientX - startClientX) / barWidth) * trackDuration;
		vp.panView(startViewStart + delta - vp.viewStart);
	}

	function onUp(e: PointerEvent) {
		if (!drag) return;
		drag = null;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}
</script>

<!-- Always rendered, zoomed or not: showing it only while zoomed moved
     everything under it by a row on every zoom in and out. -->
<div class="scrollbar" bind:this={barEl}>
	<div
		class="scrollbar-thumb {accent}"
		class:full={!vp.isZoomed}
		style="left: {left}%; width: {width}%"
		role="presentation"
		title="Drag to pan the view"
		onpointerdown={onDown}
		onpointermove={onMove}
		onpointerup={onUp}
		onpointercancel={onUp}
	></div>
</div>

<style>
	.scrollbar {
		position: relative;
		flex: 1;
		height: 6px;
		border: 1px solid #2a2a2a;
		border-radius: 3px;
		background: #101010;
		touch-action: none;
	}

	.scrollbar-thumb {
		position: absolute;
		top: 0;
		height: 100%;
		min-width: 8px;
		border-radius: 3px;
		cursor: grab;
	}

	.scrollbar-thumb.blue {
		background: #3a5a7a;
	}

	.scrollbar-thumb.blue:hover {
		background: #4d76a0;
	}

	.scrollbar-thumb.blue:active {
		background: #7ab8f5;
		cursor: grabbing;
	}

	.scrollbar-thumb.purple {
		background: #5a4a6a;
	}

	.scrollbar-thumb.purple:hover {
		background: #7a5a9a;
	}

	.scrollbar-thumb.purple:active {
		background: #b08ad0;
		cursor: grabbing;
	}

	/* Unzoomed the thumb fills the bar — still visible, so the row never looks
	   empty, but inert. After the state rules so nothing lights it up. */
	.scrollbar-thumb.full,
	.scrollbar-thumb.full:hover,
	.scrollbar-thumb.full:active {
		cursor: default;
	}

	.scrollbar-thumb.blue.full,
	.scrollbar-thumb.blue.full:hover,
	.scrollbar-thumb.blue.full:active {
		background: #3a5a7a;
	}

	.scrollbar-thumb.purple.full,
	.scrollbar-thumb.purple.full:hover,
	.scrollbar-thumb.purple.full:active {
		background: #5a4a6a;
	}
</style>
