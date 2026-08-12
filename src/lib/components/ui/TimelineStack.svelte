<script lang="ts">
	import { Crosshair, Pause, Play, Repeat } from 'lucide-svelte';
	import { untrack, type Snippet } from 'svelte';
	import { formatTime, formatTimeMs } from '../../audio/audio-utils';
	import {
		setTimelineStack,
		TimelineStackState,
	} from '../../editor/timeline-stack.svelte';
	import TimelineScrollbar from './TimelineScrollbar.svelte';

	interface Props {
		/** The master clock every lane maps against. */
		trackDuration: number;
		currentTime: number;
		isPlaying?: boolean;
		/** Omit to leave the transport out (a mode driven from elsewhere). */
		onTogglePlay?: (() => void) | null;
		onSeek?: ((time: number) => void) | null;
		loopEnabled?: boolean;
		onToggleLoop?: (() => void) | null;
		/** Matches the lanes stacked under it. */
		accent?: 'blue' | 'purple';
		/**
		 * The lanes' own actions — one toolbar for the whole stack rather than a
		 * header row per lane. The editors fill this; see Editor.svelte.
		 */
		toolbar?: Snippet;
		/** The lanes, top to bottom. */
		children: Snippet;
	}

	let {
		trackDuration,
		currentTime,
		isPlaying = false,
		onTogglePlay = null,
		onSeek = null,
		loopEnabled = false,
		onToggleLoop = null,
		accent = 'blue',
		toolbar,
		children,
	}: Props = $props();

	const stack = new TimelineStackState(
		() => trackDuration,
		() => currentTime,
		(t) => onSeek?.(t),
	);
	setTimelineStack(stack);
	const vp = stack.vp;

	// Follow the track: any new duration opens the window onto the whole thing.
	// The duration grows under us — a mode starts on the short record window and
	// only reaches the track length once a track loads — and the old window left
	// in place reads as a deep zoom into the new, far longer timeline.
	let viewedDuration = 0;
	$effect(() => {
		const d = trackDuration;
		if (d <= 0 || d === viewedDuration) return;
		viewedDuration = d;
		vp.viewStart = 0;
		vp.viewEnd = d;
		stack.followPlayhead = true;
	});

	// Pressing play hands the view back to the playhead: starting playback is the
	// moment the user wants to watch it again.
	let wasPlaying = false;
	$effect(() => {
		const playing = isPlaying;
		untrack(() => {
			if (playing && !wasPlaying) stack.followPlayhead = true;
			wasPlaying = playing;
		});
	});

	// Keep the playhead centred: the view slides under it rather than the other
	// way round. Only while zoomed — unzoomed the whole track is on screen and
	// there is nothing to scroll. panView clamps at the track ends, where the
	// window runs out of room and the playhead drifts off centre instead.
	$effect(() => {
		const t = currentTime;
		const d = trackDuration;
		if (d <= 0 || !stack.followPlayhead) return;
		// Untracked, pan included: panView reads the window it writes, so a
		// tracked call retriggers on its own pan — and at the track ends, where
		// the clamp means the correction never reaches zero, never settles.
		untrack(() => {
			if (!vp.isZoomed || vp.viewEnd <= 0) return;
			const centred = t - (vp.viewStart + vp.viewDuration / 2);
			if (centred !== 0) vp.panView(centred);
		});
	});

	// ── Time grid ────────────────────────────────────────────────────────────
	// Drawn over the lanes rather than in a ruler row of its own: the lines are
	// what makes two lanes readable against each other, and the labels only need
	// somewhere to sit, not a row to themselves.
	const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

	/** Coarsest step that still leaves at least a handful of ticks in the window. */
	function tickStep(viewDuration: number): number {
		for (const step of TICK_STEPS) {
			if (viewDuration / step <= 8) return step;
		}
		return TICK_STEPS[TICK_STEPS.length - 1];
	}

	let ticks = $derived.by(() => {
		if (trackDuration <= 0) return [];
		const step = tickStep(vp.viewDuration);
		const first = Math.ceil(vp.viewStart / step) * step;
		const out: { pct: number; label: string }[] = [];
		for (let t = first; t <= vp.viewEnd + 1e-6; t += step) {
			out.push({
				pct: vp.toPct(t),
				// Sub-second steps need the decimal; whole seconds read as m:ss.
				label: step < 1 ? `${t.toFixed(step < 0.25 ? 1 : 2)}s` : formatTime(t),
			});
		}
		return out;
	});

	let playheadPct = $derived(vp.toPct(currentTime));
	let playheadVisible = $derived(
		trackDuration > 0 && playheadPct >= 0 && playheadPct <= 100,
	);
</script>

<div class="tl-stack">
	<div class="tl-toolbar">
		{#if onTogglePlay}
			<button
				class="tl-transport-btn"
				onclick={onTogglePlay}
				title={isPlaying ? 'Pause' : 'Play'}
			>
				{#if isPlaying}
					<Pause size={13} fill="currentColor" stroke="none" />
				{:else}
					<Play size={13} fill="currentColor" stroke="none" />
				{/if}
			</button>
		{/if}
		{#if onToggleLoop}
			<button
				class="tl-transport-btn"
				class:loop-on={loopEnabled}
				onclick={onToggleLoop}
				title={loopEnabled ? 'Loop: on' : 'Loop: off'}
				aria-pressed={loopEnabled}
			>
				<Repeat size={12} />
			</button>
		{/if}
		<!-- Split so the milliseconds, which change every frame, read as a
		     subordinate part of the number rather than competing with it. -->
		<span class="tl-clock">
			{formatTime(currentTime)}<span class="tl-clock-ms"
				>{formatTimeMs(currentTime).slice(-4)}</span
			>
		</span>

		{@render toolbar?.()}

		{#if trackDuration > 0}
			<button
				class="tl-tool-btn tl-follow"
				class:active={stack.followPlayhead}
				onclick={() => (stack.followPlayhead = !stack.followPlayhead)}
				title={stack.followPlayhead
					? 'Following the playhead — scroll or drag the scrollbar to look elsewhere'
					: 'Follow the playhead again'}
			>
				<Crosshair size={12} />
			</button>
		{/if}
	</div>

	<!-- Everything on the shared axis. The playhead and the time grid are each
	     drawn once, over the lot. -->
	<div class="tl-body">
		{@render children()}

		{#if trackDuration > 0}
			<div class="tl-grid-layer">
				{#each ticks as tick (tick.pct)}
					<span class="tl-tick" style="left: {tick.pct}%">
						<span class="tl-tick-label">{tick.label}</span>
					</span>
				{/each}
			</div>
		{/if}

		{#if playheadVisible}
			<div class="tl-playhead-layer">
				<div class="tl-playhead" style="left: {playheadPct}%"></div>
			</div>
		{/if}
	</div>

	{#if trackDuration > 0}
		<div class="tl-row">
			<div class="tl-gutter"></div>
			<TimelineScrollbar
				{vp}
				{trackDuration}
				{accent}
				onPanStart={() => (stack.followPlayhead = false)}
			/>
		</div>
	{/if}
</div>

<style>
	/* The row / gutter / lane classes are the contract every lane component
	   renders against, so they are global — scoped to this container, which is
	   the only place they mean anything. */
	.tl-stack {
		--tl-gutter: 150px;
		--tl-gap: 0.35rem;
		--tl-playhead: #e8b84b;
		--tl-chrome-bg: #121212;
		/* Height of the band under the lanes that the tick labels sit in. */
		--tl-scale-h: 12px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0.4rem 0.5rem;
		border-top: 1px solid #2a2a2a;
		background: var(--tl-chrome-bg);
	}

	:global(.tl-stack .tl-row) {
		display: flex;
		align-items: stretch;
		gap: var(--tl-gap);
	}

	:global(.tl-stack .tl-gutter) {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		width: var(--tl-gutter);
		flex-shrink: 0;
		overflow: hidden;
	}

	:global(.tl-stack .tl-lane) {
		position: relative;
		flex: 1;
		min-width: 0;
		touch-action: none;
	}

	/* Rows that carry controls rather than time. Opaque and above the overlays,
	   so neither the playhead nor the grid stripes them. */
	:global(.tl-stack .tl-chrome) {
		position: relative;
		z-index: 6;
		background: var(--tl-chrome-bg);
	}

	:global(.tl-stack .tl-gutter-label) {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #666;
		text-transform: uppercase;
		flex-shrink: 0;
	}

	/* One toolbar for the whole stack: the transport, then whatever the lanes
	   contribute, then Follow. Wraps rather than scrolling — a mode with a lot of
	   actions gets a second line instead of hiding half of them. */
	.tl-toolbar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.3rem;
		padding-bottom: 0.15rem;
	}

	:global(.tl-stack .tl-tool-btn) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.4rem;
		border: 1px solid #2e2e2e;
		border-radius: 4px;
		background: #191919;
		color: #bbb;
		font-size: 0.68rem;
		cursor: pointer;
	}

	:global(.tl-stack .tl-tool-btn:hover:not(:disabled)) {
		border-color: #555;
		color: #fff;
	}

	:global(.tl-stack .tl-tool-btn:disabled) {
		opacity: 0.45;
		cursor: default;
	}

	:global(.tl-stack .tl-tool-btn.active) {
		border-color: #4a6a8a;
		color: #fff;
	}

	:global(.tl-stack .tl-tool-btn.danger:hover) {
		border-color: #7a3a3a;
		color: #ff9a9a;
	}

	/* Pushes Follow — and nothing else — to the far right. */
	.tl-follow {
		margin-left: auto;
	}

	/* A hairline between groups of lane actions, so the toolbar reads as sections
	   rather than one long run of buttons. */
	:global(.tl-stack .tl-tool-sep) {
		width: 1px;
		align-self: stretch;
		margin: 0 0.15rem;
		background: #2a2a2a;
	}

	:global(.tl-stack .tl-tool-count) {
		padding: 0 4px;
		border-radius: 999px;
		background: #262626;
		color: #9a9a9a;
		font-size: 0.58rem;
		font-variant-numeric: tabular-nums;
	}

	:global(.tl-stack .tl-tool-label) {
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #5f5f5f;
		text-transform: uppercase;
	}

	.tl-transport-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 22px;
		border: 1px solid #444;
		border-radius: 5px;
		background: rgba(30, 30, 30, 0.9);
		color: #aaa;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			color 0.15s,
			border-color 0.15s,
			background 0.15s;
	}

	.tl-transport-btn:hover {
		color: #fff;
		border-color: #555;
		background: rgba(255, 255, 255, 0.06);
	}

	.tl-transport-btn.loop-on {
		color: #fff;
		border-color: #666;
		background: rgba(255, 255, 255, 0.12);
	}

	.tl-clock {
		padding: 0 0.2rem;
		color: #999;
		font-size: 0.72rem;
		/* Tabular, so the digits don't shuffle the toolbar every frame. */
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.tl-clock-ms {
		color: #6a6a6a;
		font-size: 0.64rem;
	}

	.tl-body {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
		/* The band the tick labels live in — cheaper than a ruler row, and it
		   doubles as breathing room above the scrollbar. */
		padding-bottom: var(--tl-scale-h);
	}

	/* Both overlays start where the lanes start, so a percentage inside them is a
	   percentage of the axis — the same mapping every lane uses. */
	.tl-grid-layer,
	.tl-playhead-layer {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(var(--tl-gutter) + var(--tl-gap));
		right: 0;
		pointer-events: none;
		/* A tick label sitting on the last gridline would otherwise hang past the
		   axis, over whatever panel is beside the timeline. */
		overflow: hidden;
	}

	.tl-grid-layer {
		z-index: 4;
	}

	.tl-playhead-layer {
		z-index: 5;
	}

	/* Over the lanes, not behind them — the lanes are opaque. Faint enough to
	   read as a grid rather than as content. */
	.tl-tick {
		position: absolute;
		top: 0;
		bottom: var(--tl-scale-h);
		width: 1px;
		background: rgba(255, 255, 255, 0.06);
	}

	.tl-tick-label {
		position: absolute;
		bottom: calc(-1 * var(--tl-scale-h));
		left: 3px;
		color: #5a5a5a;
		font-size: 0.55rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.tl-playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--tl-playhead);
		box-shadow: 0 0 3px rgba(232, 184, 75, 0.5);
	}

	@media (max-width: 800px) {
		.tl-stack {
			--tl-gutter: 96px;
			padding: 0.4rem 8px;
		}
	}
</style>
