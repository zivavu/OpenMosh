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

	// ── Scrubbing ────────────────────────────────────────────────────────────
	// Owned by the stack rather than the lanes: the playhead is drawn once over
	// the lot, so it is grabbable once over the lot too — a lane that spends its
	// pointer events on segments or span handles (the mosh lane, the audio lane)
	// can't be the only way to move the clock.
	let scrubbing = $state(false);

	/** Registers the scale strip with the shared axis, so it zooms with the
	 * lanes and can measure the axis even when no lane is mounted. */
	function laneTrack(node: HTMLElement) {
		return stack.lane(node);
	}

	function beginScrub(e: PointerEvent) {
		if (!onSeek || trackDuration <= 0 || e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		scrubbing = true;
		stack.seekTo(vp.clientXToTime(e.clientX));
		const onMove = (ev: PointerEvent) => {
			ev.preventDefault();
			stack.seekTo(vp.clientXToTime(ev.clientX));
		};
		const onUp = () => {
			scrubbing = false;
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}
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

		<!-- The band the tick labels sit in, doubling as a ruler: scrubbing here
		     works in every mode, whatever the lanes above do with a pointer. -->
		<div
			class="tl-scale"
			class:scrubbing
			class:seekable={!!onSeek && trackDuration > 0}
			use:laneTrack
			role="slider"
			aria-label="Seek"
			aria-valuenow={currentTime}
			aria-valuemin={0}
			aria-valuemax={trackDuration}
			tabindex="-1"
			onpointerdown={beginScrub}
		></div>

		{#if playheadVisible}
			<div class="tl-playhead-layer">
				<div class="tl-playhead" style="left: {playheadPct}%">
					{#if onSeek}
						<!-- The only part of the overlay that takes pointer events, and
						     narrow, so it doesn't shadow the lane under it. -->
						<div
							class="tl-playhead-grab"
							class:scrubbing
							role="presentation"
							onpointerdown={beginScrub}
						></div>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	{#if trackDuration > 0}
		<div class="tl-row">
			<div class="tl-gutter"></div>
			<TimelineScrollbar
				{vp}
				{trackDuration}
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
		--tl-gutter: 110px;
		--tl-gap: 0.35rem;
		--tl-playhead: var(--live);
		--tl-chrome-bg: var(--surface);
		/* Height of the band under the lanes that the tick labels sit in. */
		--tl-scale-h: 12px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0.4rem 0.5rem;
		border-top: 1px solid var(--line);
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
		font-family: var(--font-mono);
		font-size: 0.58rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		color: var(--text-3);
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
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		background: rgba(255, 255, 255, 0.03);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
	}

	:global(.tl-stack .tl-tool-btn:hover:not(:disabled)) {
		border-color: var(--text-4);
		color: var(--text);
	}

	:global(.tl-stack .tl-tool-btn:disabled) {
		opacity: 0.45;
		cursor: default;
	}

	:global(.tl-stack .tl-tool-btn.active) {
		border-color: var(--live-dim);
		color: var(--text);
	}

	:global(.tl-stack .tl-tool-btn.danger:hover) {
		border-color: var(--rec-dim);
		color: var(--rec);
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
		background: rgba(255, 255, 255, 0.05);
	}

	:global(.tl-stack .tl-tool-label) {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		color: var(--text-3);
		text-transform: uppercase;
	}

	.tl-transport-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 22px;
		border: 1px solid var(--line-strong);
		border-radius: 5px;
		background: rgba(30, 30, 30, 0.9);
		color: var(--text-2);
		cursor: pointer;
		flex-shrink: 0;
		transition:
			color 0.15s,
			border-color 0.15s,
			background 0.15s;
	}

	.tl-transport-btn:hover {
		color: var(--text);
		border-color: var(--text-4);
		background: rgba(255, 255, 255, 0.06);
	}

	.tl-transport-btn.loop-on {
		color: var(--text);
		border-color: var(--text-4);
		background: rgba(255, 255, 255, 0.12);
	}

	.tl-clock {
		padding: 0 0.2rem;
		color: var(--text-2);
		font-size: 0.72rem;
		/* Tabular, so the digits don't shuffle the toolbar every frame. */
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.tl-clock-ms {
		color: var(--text-3);
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
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.53rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.tl-playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--tl-playhead);
		box-shadow: 0 0 4px rgba(110, 231, 192, 0.6);
	}

	/* A grab zone wider than the 1px line, since nobody can hit 1px. */
	.tl-playhead-grab {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -5px;
		width: 11px;
		pointer-events: auto;
		cursor: col-resize;
		touch-action: none;
	}

	.tl-playhead-grab:hover,
	.tl-playhead-grab.scrubbing {
		background: rgba(110, 231, 192, 0.14);
	}

	/* Sits in the padding band under the lanes, over the tick labels — they are
	   in the grid layer, which takes no pointer events. */
	.tl-scale {
		position: absolute;
		bottom: 0;
		left: calc(var(--tl-gutter) + var(--tl-gap));
		right: 0;
		height: var(--tl-scale-h);
		z-index: 6;
		touch-action: none;
	}

	.tl-scale.seekable {
		cursor: col-resize;
	}

	.tl-scale.scrubbing {
		cursor: col-resize;
		background: rgba(255, 255, 255, 0.04);
	}

	@media (max-width: 800px) {
		.tl-stack {
			--tl-gutter: 96px;
			padding: 0.4rem 8px;
		}
	}
</style>
