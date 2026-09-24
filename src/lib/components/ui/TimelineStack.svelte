<script lang="ts">
	import { Crosshair, Pause, Play, Repeat, X } from "lucide-svelte";
	import { untrack, type Snippet } from "svelte";
	import { formatTime, formatTimeMs } from "../../audio/audio-utils";
	import {
		setTimelineStack,
		TimelineStackState,
	} from "../../editor/timeline-stack.svelte";
	import { draggedSourceId } from "../../editor/source-drag.svelte";
	import TimelineScrollbar from "./TimelineScrollbar.svelte";

	interface Props {
		/** The master clock every lane maps against. */
		trackDuration: number;
		currentTime: number;
		isPlaying?: boolean;
		/** Omit to leave the transport out. */
		onTogglePlay?: (() => void) | null;
		onSeek?: ((time: number) => void) | null;
		spanStart?: number;
		loopEnabled?: boolean;
		onToggleLoop?: (() => void) | null;
		/** The stretch the preview is going round, marked on the axis. */
		repeatRange?: { start: number; end: number } | null;
		onStopRepeat?: (() => void) | null;
		/** The lanes' own actions, one toolbar for the whole stack. */
		toolbar?: Snippet;
		selectionHint?: string | null;
		/** Tempo of the master track, when known: drags snap to its beats. */
		bpm?: number;
		/** The editor's dragged split, in px; omitted, the stack takes its own height. */
		height?: number | null;
		children: Snippet;
		/** Out: the axis this stack owns, for editors whose window-level shortcuts sit outside it. */
		axis?: TimelineStackState;
	}

	let {
		trackDuration,
		currentTime,
		isPlaying = false,
		onTogglePlay = null,
		onSeek = null,
		spanStart = 0,
		loopEnabled = false,
		onToggleLoop = null,
		repeatRange = null,
		onStopRepeat = null,
		toolbar,
		selectionHint = null,
		bpm = 0,
		height = null,
		children,
		axis = $bindable(),
	}: Props = $props();

	const stack = new TimelineStackState(
		() => trackDuration,
		() => currentTime,
		(t) => onSeek?.(t),
	);
	setTimelineStack(stack);
	axis = stack;

	$effect(() => {
		stack.bpm = bpm;
	});
	const vp = stack.vp;

	// Follow the track: a new duration opens the window onto the whole thing.
	let viewedDuration = 0;
	$effect(() => {
		const d = trackDuration;
		if (d <= 0 || d === viewedDuration) return;
		viewedDuration = d;
		vp.viewStart = 0;
		vp.viewEnd = d;
		stack.followPlayhead = true;
		// A new track opens on its own start marker, the span it was saved with.
		stack.staticTime = Math.max(0, Math.min(d, spanStart));
		stack.returnToStatic();
	});

	// Keep the playhead centred: the view slides under it, only while zoomed.
	$effect(() => {
		const t = currentTime;
		const d = trackDuration;
		if (d <= 0 || !stack.followPlayhead) return;
		// Untracked, pan included: panView reads the window it writes, so a tracked
		// call never settles.
		untrack(() => {
			if (!vp.isZoomed || vp.viewEnd <= 0) return;
			const centred = t - (vp.viewStart + vp.viewDuration / 2);
			// The clock is interpolated per frame, so let the playhead drift until it moves a pixel.
			const perPixel =
				stack.laneWidth > 0 ? vp.viewDuration / stack.laneWidth : 0;
			if (Math.abs(centred) >= perPixel) vp.panView(centred);
		});
	});

	// Drawn over the lanes rather than in a ruler row: the lines make two lanes readable.
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
	// Only while playing: stopped, the clock sits back on the static marker.
	let playheadVisible = $derived(
		isPlaying && trackDuration > 0 && playheadPct >= 0 && playheadPct <= 100,
	);

	let staticPct = $derived(vp.toPct(stack.staticTime));
	let staticVisible = $derived(
		trackDuration > 0 && staticPct >= 0 && staticPct <= 100,
	);

	/** Where to draw a marker standing at `pct` of the axis, pulled back by its own width. */
	function markerX(pct: number): string {
		return `translate3d(calc(${pct}% - ${(pct / 100).toFixed(4)}px), 0, 0)`;
	}

	// Owned by the stack rather than the lanes: the playhead is drawn once over the lot.
	let scrubbing = $state(false);
	let staticDragging = $state(false);

	// Ctrl-click splits or creates a clip, so the grab handles fall through while held.
	let modifierHeld = $state(false);
	function trackModifier(e: KeyboardEvent) {
		modifierHeld = e.ctrlKey || e.metaKey;
	}
	function releaseModifier() {
		modifierHeld = false;
	}

	// Stopping puts the clock back where playback started.
	let wasPlaying = false;
	$effect(() => {
		const playing = isPlaying;
		untrack(() => {
			if (wasPlaying && !playing) stack.returnToStatic();
			wasPlaying = playing;
		});
	});

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
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
	}

	/** Drag the static playhead: the clock goes with it, scrubbing while paused. */
	function beginStaticDrag(e: PointerEvent) {
		if (!onSeek || trackDuration <= 0 || e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		staticDragging = true;
		stack.seekStatic(vp.clientXToTime(e.clientX));
		const onMove = (ev: PointerEvent) => {
			ev.preventDefault();
			stack.seekStatic(vp.clientXToTime(ev.clientX));
		};
		const onUp = () => {
			staticDragging = false;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
	}
</script>

<!-- Blur too: a Ctrl+Tab away never sends the keyup. -->
<svelte:window
	onkeydown={trackModifier}
	onkeyup={trackModifier}
	onblur={releaseModifier}
/>

<div
	class="tl-stack"
	style:max-height={height === null ? null : `min(${height}px, var(--tl-cap))`}
>
	<div class="tl-toolbar">
		{#if onTogglePlay}
			<button
				class="tl-transport-btn"
				onclick={onTogglePlay}
				title={isPlaying ? "Pause" : "Play"}
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
				title={loopEnabled ? "Loop: on" : "Loop: off"}
				aria-pressed={loopEnabled}
			>
				<Repeat size={12} />
			</button>
		{/if}
		{#if repeatRange && onStopRepeat}
			<button
				class="tl-repeat-chip"
				onclick={onStopRepeat}
				title="The preview is repeating the marked stretch. Click to play on normally."
			>
				<Repeat size={11} /> Repeating <X size={11} />
			</button>
		{/if}
		<!-- Split so the milliseconds, which change every frame, read as subordinate. -->
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
					? "Following the playhead (C) — scroll or drag the scrollbar to look elsewhere"
					: "Follow the playhead again (C)"}
			>
				<Crosshair size={12} />
			</button>
		{/if}
	</div>

	<!-- Everything on the shared axis; the playhead and time grid are drawn once. -->
	<div class="tl-body">
		{@render children()}

		{#if trackDuration > 0}
			<div class="tl-grid-layer">
				{#each ticks as tick (tick.pct)}
					<span class="tl-tick" style="left: {tick.pct}%">
						<span class="tl-tick-label">{tick.label}</span>
					</span>
				{/each}
				{#if repeatRange}
					{@const left = vp.toPct(repeatRange.start)}
					<div
						class="tl-repeat"
						style="left: {left}%; width: {vp.toPct(repeatRange.end) - left}%"
					></div>
				{/if}
			</div>
		{/if}

		<!-- The band the tick labels sit in, doubling as a ruler: clicking here moves
		     the start marker. -->
		<div
			class="tl-scale"
			class:scrubbing={staticDragging}
			class:seekable={!!onSeek && trackDuration > 0}
			use:laneTrack
			role="slider"
			aria-label="Start marker"
			aria-valuenow={stack.staticTime}
			aria-valuemin={0}
			aria-valuemax={trackDuration}
			tabindex="-1"
			onpointerdown={beginStaticDrag}
		></div>

		{#if stack.snapGuide !== null}
			<!-- What the drag is snapped to, across every lane. -->
			<div class="tl-playhead-layer">
				<div
					class="tl-snap-guide"
					style="transform: {markerX(vp.toPct(stack.snapGuide))}"
				></div>
			</div>
		{/if}
		{#if playheadVisible || staticVisible}
			<!-- A source in the air falls through the grab handles, so a drop doesn't land on nothing. -->
			<div
				class="tl-playhead-layer"
				class:source-drag={draggedSourceId() !== null}
				class:fall-through={modifierHeld}
			>
				{#if playheadVisible}
					<!-- Full-width and moved by transform rather than `left`: a percentage
					     translate is of this element's own width. -->
					<div class="tl-playhead" style="transform: {markerX(playheadPct)}">
						<div class="tl-playhead-line"></div>
						{#if onSeek}
							<!-- The only part of the overlay that takes pointer events, and narrow. -->
							<div
								class="tl-playhead-grab"
								class:scrubbing
								role="presentation"
								onpointerdown={beginScrub}
							></div>
						{/if}
					</div>
				{/if}
				{#if staticVisible && onSeek}
					<!-- The static playhead: where playback starts from and where the clock is put back. -->
					<div
						class="tl-static-playhead"
						style="transform: {markerX(staticPct)}"
					>
						<div class="tl-static-line" class:sole={!isPlaying}></div>
						<div class="tl-static-handle"></div>
						<div
							class="tl-static-grab"
							class:scrubbing={staticDragging}
							role="presentation"
							title="Start marker — playback resumes from here; drag to move"
							onpointerdown={beginStaticDrag}
						></div>
					</div>
				{/if}
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

	<!-- Always mounted: rendering the selection bar only when something is selected
	     made every click resize the stack. -->
	<div class="tl-selbar">
		{#if stack.selectionBar}
			{@render stack.selectionBar()}
		{:else if selectionHint}
			<span class="tl-selbar-hint">{selectionHint}</span>
		{/if}
	</div>
</div>

<style>
	/* The row / gutter / lane classes are the contract every lane component renders
	   against, so they are global here. */
	.tl-stack {
		/* Wide enough for a lane's name beside its controls. */
		--tl-gutter: 158px;
		--tl-gap: 0.35rem;
		--tl-playhead: var(--live);
		--tl-static-playhead: var(--start);
		--tl-chrome-bg: var(--surface);
		/* Height of the band under the lanes that the tick labels sit in. */
		--tl-scale-h: 12px;
		/* The lane area has no natural ceiling; past this share the lanes scroll under
		   the axis. */
		--tl-cap: 45%;
		/* The clip lanes' look: one set of rules for every lane kind. */
		--clip-accent: var(--live);
		--clip-accent-dim: var(--live-dim);
		--clip-bg: #24384d;
		--clip-fg: #dce8f2;
		/* --tl-vscroll is set by the editor from what the lane list's scrollbar costs it. */
		flex-shrink: 0;
		max-height: var(--tl-cap);
		min-height: 0;
		/* The split grip hangs off the top edge without taking a row of its own. */
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0.4rem 0.5rem;
		border-top: 1px solid var(--line);
		background: var(--tl-chrome-bg);
		/* The whole stack is a drag surface: scrubbing otherwise sweeps a selection. */
		user-select: none;
	}

	/* ...except a field, where selecting is the point. */
	:global(.tl-stack input:not([type]), .tl-stack input[type="text"]),
	:global(.tl-stack input[type="number"], .tl-stack textarea) {
		user-select: text;
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

	/* A folded lane keeps its clips as bars but drops the text inside them. */
	:global(.tl-stack .tl-row.folded .clip-label) {
		display: none;
	}

	/* And the clips run edge to edge: the 3px inset would leave a 14px strip with a
	   6px bar in it. */
	:global(.tl-stack .tl-row.folded .clip) {
		top: 0;
		bottom: 0;
		border-radius: 3px;
	}

	/* A folded row is as short as its gutter lets it be, so the buttons' vertical
	   padding goes. */
	:global(.tl-stack .tl-row.folded .tl-gutter button) {
		padding-top: 0;
		padding-bottom: 0;
	}

	/* Shared by the fx, media and text rows; each renders into this column with
	   `display: contents` so one `order` per row interleaves them. */

	/* The row follows the pointer by re-ordering, not by moving, so this is the only
	   cue for which one is in hand. */
	:global(.tl-stack .tl-row.lifted) {
		opacity: 0.55;
	}

	:global(.tl-stack .lane-track) {
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--ink);
		overflow: hidden;
		touch-action: none;
	}

	:global(.tl-stack .clip) {
		position: absolute;
		top: 3px;
		bottom: 3px;
		display: flex;
		align-items: center;
		border: 1px solid var(--clip-accent-dim);
		border-radius: 3px;
		background: var(--clip-bg);
		color: var(--clip-fg);
		font-size: 0.68rem;
		cursor: grab;
		overflow: hidden;
		/* A clip is dragged with pointer events, so the browser's own drag is never wanted. */
		user-select: none;
		-webkit-user-drag: none;
	}

	:global(.tl-stack .clip.selected) {
		border-color: var(--clip-accent);
		background: var(--clip-accent-dim);
	}

	/* Which of a multi-selection the panel is editing. */
	:global(.tl-stack .clip.primary) {
		box-shadow: inset 0 0 0 1px var(--clip-accent);
	}

	:global(.tl-stack .clip.muted) {
		opacity: 0.4;
	}

	:global(.tl-stack .clip-label) {
		position: relative;
		flex: 1;
		min-width: 0;
		padding: 0 0.4rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}

	/* Width is set inline, against the clip's own width; see edgeWidth. Positioned
	   rather than laid out, or a narrow clip clips the end handle away. */
	:global(.tl-stack .clip-edge) {
		position: absolute;
		top: 0;
		bottom: 0;
		cursor: ew-resize;
	}

	:global(.tl-stack .clip-edge.start) {
		left: 0;
	}

	:global(.tl-stack .clip-edge.end) {
		right: 0;
	}

	:global(.tl-stack .clip-edge:hover) {
		background: var(--clip-accent);
	}

	:global(.tl-stack .clip-boundary) {
		position: absolute;
		top: 0;
		bottom: 0;
		transform: translateX(-50%);
		cursor: ew-resize;
		z-index: 3;
	}

	/* Centred in the grab area, which is wider than the line and sized inline. */
	:global(.tl-stack .clip-boundary::after) {
		content: "";
		position: absolute;
		top: 0;
		bottom: 0;
		left: 50%;
		width: 1px;
		transform: translateX(-50%);
		background: rgba(255, 255, 255, 0.3);
	}

	:global(.tl-stack .clip-boundary:hover::after) {
		width: 2px;
		background: var(--clip-accent);
	}

	/* A join with a transition to set reads as a handle, not just a seam. */
	:global(.tl-stack .clip-boundary.editable::before) {
		content: "";
		position: absolute;
		top: 50%;
		left: 50%;
		width: 6px;
		height: 6px;
		transform: translate(-50%, -50%) rotate(45deg);
		background: rgba(255, 255, 255, 0.35);
		pointer-events: none;
	}

	:global(.tl-stack .clip-boundary.selected::after),
	:global(.tl-stack .clip-boundary.selected::before) {
		width: 2px;
		background: var(--live);
	}

	:global(.tl-stack .clip-boundary.selected::before) {
		width: 8px;
		height: 8px;
	}

	:global(.tl-stack .join-ghost) {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 2px dashed var(--live);
		pointer-events: none;
		z-index: 4;
	}

	:global(.tl-stack .clip-marquee) {
		position: absolute;
		top: 0;
		bottom: 0;
		border: 1px dashed var(--live);
		background: color-mix(in srgb, var(--live) 12%, transparent);
		pointer-events: none;
		z-index: 4;
	}

	/* Rows that carry controls rather than time, always this tall so the lanes above
	   don't move when a selection is made. */
	.tl-selbar {
		display: flex;
		align-items: center;
		height: 30px;
		flex-shrink: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.tl-selbar::-webkit-scrollbar {
		display: none;
	}

	.tl-selbar-hint {
		margin: 0 auto;
		color: var(--text-4);
		font-size: 0.62rem;
		letter-spacing: 0.03em;
	}

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

	/* One toolbar for the whole stack: transport, lane actions, then Follow. Wraps. */
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

	/* Pushes Follow, and nothing else, to the far right. */
	.tl-follow {
		margin-left: auto;
	}

	/* A hairline between groups of lane actions, so the toolbar reads as sections. */
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

	.tl-repeat-chip {
		display: flex;
		align-items: center;
		gap: 4px;
		height: 22px;
		padding: 0 6px;
		border: 1px solid var(--live-dim);
		border-radius: 5px;
		background: none;
		color: var(--live);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
		flex-shrink: 0;
	}

	.tl-repeat-chip:hover {
		border-color: var(--live);
	}

	/* The repeated stretch: tinted through the lanes, solid along the ruler. */
	.tl-repeat {
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: 1px dashed var(--live-dim);
		border-right: 1px dashed var(--live-dim);
		background: linear-gradient(
			to top,
			var(--live-dim) 0 var(--tl-scale-h),
			rgba(255, 255, 255, 0.03) var(--tl-scale-h)
		);
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
		/* Lets the lanes give way to the stack's cap rather than pushing it open. */
		min-height: 0;
		flex: 0 1 auto;
		/* The band the tick labels live in: cheaper than a ruler row, and breathing room. */
		padding-bottom: var(--tl-scale-h);
	}

	/* Both overlays start where the lanes start, so a percentage inside is of the axis. */
	.tl-grid-layer,
	.tl-playhead-layer {
		position: absolute;
		top: 0;
		bottom: 0;
		left: calc(var(--tl-gutter) + var(--tl-gap));
		/* Clear of the lane scrollbar, or the playhead sits a scrollbar's width past its lane. */
		right: var(--tl-vscroll, 0px);
		pointer-events: none;
		/* A tick label on the last gridline would otherwise hang past the axis. */
		overflow: hidden;
	}

	.tl-grid-layer {
		z-index: 4;
	}

	.tl-playhead-layer {
		z-index: 5;
	}

	/* Over the lanes, not behind them: the lanes are opaque. */
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
		left: 0;
		width: 100%;
		will-change: transform;
	}

	/* Under the playheads, over the lanes. Dashed and faint: a hint, not a marker. */
	.tl-snap-guide {
		position: absolute;
		top: 0;
		bottom: var(--tl-scale-h);
		left: 0;
		width: 100%;
		border-left: 1px dashed var(--tl-playhead);
		opacity: 0.55;
		will-change: transform;
	}

	.tl-playhead-line {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
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

	.tl-playhead-layer.source-drag .tl-playhead-grab,
	.tl-playhead-layer.source-drag .tl-static-grab,
	.tl-playhead-layer.fall-through .tl-playhead-grab,
	.tl-playhead-layer.fall-through .tl-static-grab {
		pointer-events: none;
	}

	.tl-playhead-grab:hover,
	.tl-playhead-grab.scrubbing {
		background: rgba(110, 231, 192, 0.14);
	}

	.tl-static-playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 100%;
		will-change: transform;
	}

	/* Fainter than the live playhead, so the moving clock dominates. */
	.tl-static-line {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 1px;
		background: var(--tl-static-playhead);
		opacity: 0.45;
	}

	.tl-static-line.sole {
		opacity: 0.9;
	}

	/* A diamond cap marks the static playhead as a handle, not a clock. */
	.tl-static-handle {
		position: absolute;
		top: 1px;
		left: -3px;
		width: 7px;
		height: 7px;
		background: var(--tl-static-playhead);
		border-radius: 1px;
		transform: rotate(45deg);
	}

	.tl-static-grab {
		position: absolute;
		top: 0;
		bottom: 0;
		left: -5px;
		width: 11px;
		pointer-events: auto;
		cursor: col-resize;
		touch-action: none;
	}

	.tl-static-grab:hover,
	.tl-static-grab.scrubbing {
		background: rgba(240, 181, 104, 0.14);
	}

	/* Sits in the padding band under the lanes, over the tick labels. */
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
		/* No gutter: a third of a phone's width for a lane caption is the axis's to have. */
		.tl-stack {
			--tl-gutter: 0px;
			--tl-gap: 0px;
			padding: 0.4rem 8px;
		}

		:global(.tl-stack .tl-gutter) {
			display: none;
		}

		/* A wrapping selection bar needs the room; the fixed row clipped at this width. */
		.tl-selbar {
			height: auto;
			min-height: 30px;
		}
	}
</style>
