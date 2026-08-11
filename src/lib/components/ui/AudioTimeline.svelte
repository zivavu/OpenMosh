<script lang="ts">
	import { Pause, Play, Repeat, Volume1, Volume2, VolumeX, X } from 'lucide-svelte';
	import { formatTime } from '../../audio/audio-utils';
	import { tryGetTimelineStack } from '../../editor/timeline-stack.svelte';
	import SpeedControl from './SpeedControl.svelte';

	interface Props {
		label: string;
		trackDuration: number;
		trackCurrentTime: number;
		spanStart: number;
		spanEnd: number;
		isPlaying: boolean;
		onPlay: () => void;
		onPause: () => void;
		onSeek: (t: number) => void;
		onSpanStartChange: (t: number) => void;
		onSpanEndChange: (t: number) => void;
		outputVolume?: number;
		onVolumeChange?: (v: number) => void;
		speed?: number;
		onSpeedChange?: (s: number) => void;
		loopEnabled?: boolean;
		onToggleLoop?: () => void;
		onRemoveTrack?: () => void;
		ariaLabel?: string;
		/**
		 * `lane` puts the track on the enclosing TimelineStack's shared axis: it
		 * zooms with every other lane, and the stack draws the playhead and owns
		 * the transport. `bar` is the self-contained strip, for a clock that is not
		 * the stack's master (a video playing under its own span while a track
		 * drives the timeline).
		 */
		layout?: 'bar' | 'lane';
	}

	let {
		label,
		trackDuration,
		trackCurrentTime,
		spanStart,
		spanEnd,
		isPlaying,
		onPlay,
		onPause,
		onSeek,
		onSpanStartChange,
		onSpanEndChange,
		outputVolume = 1,
		onVolumeChange,
		speed = 1,
		onSpeedChange,
		loopEnabled = false,
		onToggleLoop,
		onRemoveTrack,
		ariaLabel = 'Timeline',
		layout = 'bar',
	}: Props = $props();

	// Present whenever this is mounted inside a stack; used only in lane layout,
	// so a bar keeps its own axis even when it sits next to one.
	const enclosingStack = tryGetTimelineStack();
	let stack = $derived(layout === 'lane' ? enclosingStack : undefined);

	let timelineTrackEl = $state<HTMLDivElement | undefined>(undefined);
	let seekDragging = $state(false);

	let VolumeIcon = $derived(
		outputVolume === 0 ? VolumeX : outputVolume < 0.5 ? Volume1 : Volume2,
	);

	/** Registers the track with the shared axis; a no-op for a standalone bar. */
	function laneTrack(node: HTMLElement) {
		return stack?.lane(node);
	}

	/** Absolute time → percent across the track, through the shared view window
	 * when there is one and over the whole track when there isn't. Off-screen
	 * either side once the view is zoomed in, so anything drawn from it clamps. */
	function pct(time: number): number {
		if (stack) return stack.toPct(time);
		return trackDuration > 0 ? (time / trackDuration) * 100 : 0;
	}

	/** `pct` held inside the lane — a span that starts before the view window
	 * would otherwise draw its bar clean across the panel beside the timeline. */
	function clampPct(time: number): number {
		return Math.max(0, Math.min(100, pct(time)));
	}

	/** Whether a handle is inside the view at all; off-screen it isn't drawn. */
	function onScreen(time: number): boolean {
		const p = pct(time);
		return p >= 0 && p <= 100;
	}

	let spanL = $derived(clampPct(spanStart));
	let spanR = $derived(clampPct(spanEnd));

	function timeFromClientX(clientX: number): number {
		if (stack) return stack.timeAt(clientX);
		if (!timelineTrackEl) return 0;
		const rect = timelineTrackEl.getBoundingClientRect();
		const x = clientX - rect.left;
		const frac = Math.max(0, Math.min(1, x / rect.width));
		return frac * trackDuration;
	}

	function handleFromClientX(clientX: number): 'start' | 'end' | null {
		if (!timelineTrackEl || trackDuration === 0) return null;
		const rect = timelineTrackEl.getBoundingClientRect();
		const x = clientX - rect.left;
		const startX = (pct(spanStart) / 100) * rect.width;
		const endX = (pct(spanEnd) / 100) * rect.width;
		const radius = 14;
		if (Math.abs(x - startX) <= radius) return 'start';
		if (Math.abs(x - endX) <= radius) return 'end';
		return null;
	}

	function onTimelinePointerDown(e: PointerEvent) {
		if (e.pointerType === 'touch') return;
		e.preventDefault();
		const handle = handleFromClientX(e.clientX);
		if (handle) {
			beginHandleDrag(handle, e.clientX);
		} else {
			beginSeekDrag(e.clientX);
		}
	}

	// Scrub while the button stays down, so the playhead drags rather than jumps.
	function beginSeekDrag(startClientX: number) {
		onSeek(timeFromClientX(startClientX));
		seekDragging = true;
		const onMove = (ev: PointerEvent) => {
			ev.preventDefault();
			onSeek(timeFromClientX(ev.clientX));
		};
		const onUp = () => {
			seekDragging = false;
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('pointercancel', onUp);
	}

	function beginHandleDrag(initialHandle: 'start' | 'end', startClientX: number) {
		let handle: 'start' | 'end' = initialHandle;
		function applyPosition(clientX: number) {
			const t = timeFromClientX(clientX);
			if (handle === 'start') {
				if (t >= spanEnd) {
					// Swapped: start becomes the new end
					handle = 'end';
					onSpanEndChange(t);
				} else {
					onSpanStartChange(Math.max(0, t));
				}
			} else {
				if (t <= spanStart) {
					// Swapped: end becomes the new start
					handle = 'start';
					onSpanStartChange(t);
				} else {
					onSpanEndChange(Math.min(trackDuration, t));
				}
			}
		}

		const onMove = (ev: PointerEvent | TouchEvent) => {
			const clientX =
				'touches' in ev ? (ev.touches[0]?.clientX ?? startClientX) : ev.clientX;
			applyPosition(clientX);
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove as EventListener);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('touchmove', onMove as EventListener);
			window.removeEventListener('touchend', onUp);
		};
		window.addEventListener('pointermove', onMove as EventListener);
		window.addEventListener('pointerup', onUp);
		window.addEventListener('touchmove', onMove as EventListener, {
			passive: false,
		});
		window.addEventListener('touchend', onUp);
	}

	// Non-passive touchstart on timeline track — handles seek and handle drag via proximity
	$effect(() => {
		const trackEl = timelineTrackEl;
		if (!trackEl) return;

		let seeking = false;
		const onSeekMove = (ev: TouchEvent) => {
			if (!seeking) return;
			ev.preventDefault();
			const touch = ev.touches[0];
			if (touch) onSeek(timeFromClientX(touch.clientX));
		};
		const onSeekUp = () => {
			seeking = false;
			window.removeEventListener('touchmove', onSeekMove);
			window.removeEventListener('touchend', onSeekUp);
		};
		const onTrackTouch = (e: TouchEvent) => {
			e.preventDefault();
			const touch = e.touches[0];
			if (!touch) return;
			const handle = handleFromClientX(touch.clientX);
			if (handle) {
				beginHandleDrag(handle, touch.clientX);
			} else {
				seeking = true;
				onSeek(timeFromClientX(touch.clientX));
				window.addEventListener('touchmove', onSeekMove, { passive: false });
				window.addEventListener('touchend', onSeekUp);
			}
		};
		trackEl.addEventListener('touchstart', onTrackTouch, { passive: false });
		return () => {
			trackEl.removeEventListener('touchstart', onTrackTouch);
			window.removeEventListener('touchmove', onSeekMove);
			window.removeEventListener('touchend', onSeekUp);
		};
	});

</script>

<!-- The track itself, identical either way: only the chrome around it differs.
     The playhead is the stack's job in lane layout — it draws one line through
     every lane rather than one per row. -->
{#snippet trackBody()}
	<div
		class="timeline-track-wrap"
		class:seeking={seekDragging}
		class:tl-lane={layout === 'lane'}
		bind:this={timelineTrackEl}
		use:laneTrack
		role="slider"
		aria-label={ariaLabel}
		aria-valuenow={trackCurrentTime}
		aria-valuemin={0}
		aria-valuemax={trackDuration}
		tabindex="0"
		onpointerdown={(e) => onTimelinePointerDown(e)}
	>
		<div class="timeline-track">
			<div
				class="timeline-span"
				style="left: {spanL}%; width: {Math.max(0, spanR - spanL)}%"
			></div>
			{#if onScreen(spanStart)}
				<div
					class="timeline-handle timeline-handle-start"
					style="left: {spanL}%"
					aria-hidden="true"
				></div>
			{/if}
			{#if onScreen(spanEnd)}
				<div
					class="timeline-handle timeline-handle-end"
					style="left: {spanR}%"
					aria-hidden="true"
				></div>
			{/if}
			{#if layout === 'bar'}
				<div
					class="timeline-playhead"
					style="left: {pct(trackCurrentTime)}%"
					aria-hidden="true"
				></div>
			{/if}
		</div>
	</div>
{/snippet}

{#if layout === 'lane'}
	<div class="tl-row">
		<div class="tl-gutter audio-gutter">
			<span class="tl-gutter-label">{label}</span>
			{#if onVolumeChange}
				<span class="volume-icon" title="Volume">
					<VolumeIcon size={13} />
				</span>
				<input
					type="range"
					class="volume-slider lane-volume"
					min="0"
					max="1"
					step="0.01"
					value={outputVolume}
					oninput={(e) =>
						onVolumeChange(+(e.currentTarget as HTMLInputElement).value)}
					title="Volume: {Math.round(outputVolume * 100)}%"
				/>
			{/if}
			{#if onRemoveTrack}
				<button
					class="track-inline-btn"
					onclick={onRemoveTrack}
					title="Remove track"
					aria-label="Remove track"
				>
					<X size={12} />
				</button>
			{/if}
		</div>
		{@render trackBody()}
	</div>
{:else}
	<div class="timeline-bar">
		<span class="timeline-label">{label}</span>
		<button
			class="timeline-play-btn"
			onclick={isPlaying ? onPause : onPlay}
			title={isPlaying ? 'Pause' : 'Play'}
		>
			{#if isPlaying}
				<Pause size={14} fill="currentColor" stroke="none" />
			{:else}
				<Play size={14} fill="currentColor" stroke="none" />
			{/if}
		</button>
		{#if onToggleLoop}
			<button
				class="timeline-play-btn timeline-loop-btn"
				class:loop-on={loopEnabled}
				onclick={onToggleLoop}
				title={loopEnabled ? 'Loop: on' : 'Loop: off'}
				aria-pressed={loopEnabled}
			>
				<Repeat size={13} />
			</button>
		{/if}
		<span class="timeline-time">{formatTime(trackCurrentTime)}</span>
		{@render trackBody()}
		<span class="timeline-time">{formatTime(spanEnd)}</span>
		{#if onSpeedChange}
			<SpeedControl {speed} {onSpeedChange} />
		{/if}
		{#if onVolumeChange}
			<span class="volume-icon" title="Volume">
				<VolumeIcon size={13} />
			</span>
			<input
				type="range"
				class="volume-slider"
				min="0"
				max="1"
				step="0.01"
				value={outputVolume}
				oninput={(e) =>
					onVolumeChange(+(e.currentTarget as HTMLInputElement).value)}
				title="Volume: {Math.round(outputVolume * 100)}%"
			/>
		{/if}
		{#if onRemoveTrack}
			<button
				class="track-inline-btn"
				onclick={onRemoveTrack}
				title="Remove track"
				aria-label="Remove track"
			>
				<X size={12} />
			</button>
		{/if}
	</div>
{/if}

<style>
	.timeline-bar {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		background: rgba(18, 18, 18, 0.9);
		border-top: 1px solid #2a2a2a;
		user-select: none;
	}

	.timeline-label {
		font-size: 0.55rem;
		font-weight: 700;
		letter-spacing: 0.07em;
		color: #555;
		min-width: 1.6rem;
		text-align: center;
		flex-shrink: 0;
	}

	.timeline-play-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 1px solid #444;
		border-radius: 6px;
		background: rgba(30, 30, 30, 0.9);
		color: #aaa;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s,
			background 0.15s;
		flex-shrink: 0;
	}

	.timeline-play-btn:hover {
		color: #fff;
		border-color: #555;
		background: rgba(255, 255, 255, 0.06);
	}

	.timeline-loop-btn.loop-on {
		color: #fff;
		border-color: #666;
		background: rgba(255, 255, 255, 0.12);
	}

	.timeline-time {
		font-size: 0.7rem;
		color: #666;
		min-width: 2.2rem;
		font-variant-numeric: tabular-nums;
	}

	.timeline-track-wrap {
		flex: 1;
		min-width: 0;
		cursor: pointer;
		outline: none;
	}

	/* A lane is a window onto a zoomed axis, so nothing may paint outside it.
	   The standalone bar always spans its whole track and keeps the visible
	   overflow its handles are drawn with. */
	.timeline-track-wrap.tl-lane {
		overflow: hidden;
		border-radius: 4px;
	}

	.timeline-track-wrap.seeking {
		cursor: grabbing;
	}

	.timeline-track-wrap:focus-visible {
		outline: 1px solid #555;
		outline-offset: 2px;
	}

	.timeline-track {
		position: relative;
		height: 20px;
		background: #222;
		border-radius: 4px;
		overflow: visible;
		user-select: none;
	}

	.timeline-span {
		position: absolute;
		top: 0;
		bottom: 0;
		background: rgba(255, 255, 255, 0.12);
		border-radius: 4px;
		pointer-events: none;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
	}

.timeline-playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: #888;
		margin-left: -1px;
		z-index: 2;
		pointer-events: none;
	}

	.timeline-handle {
		position: absolute;
		top: 50%;
		width: 10px;
		height: 16px;
		margin: -8px 0 0 -5px;
		border: 1px solid #555;
		border-radius: 3px;
		background: #444;
		pointer-events: none;
	}

	.volume-icon {
		display: flex;
		align-items: center;
		color: #666;
		flex-shrink: 0;
		margin-right: -0.2rem;
	}

	/* The gutter is a fixed column, so anything short of 150px leaves slack. Let
	   the slider take it — a longer throw is a finer volume — with the × pinned
	   to the far edge. */
	.audio-gutter {
		gap: 0.4rem;
	}

	.volume-slider.lane-volume {
		flex: 1;
		width: auto;
		min-width: 28px;
	}

	.audio-gutter .track-inline-btn {
		margin-left: auto;
	}

	.volume-slider {
		width: 60px;
		height: 4px;
		appearance: none;
		background: #333;
		border-radius: 2px;
		cursor: pointer;
		flex-shrink: 0;
	}
	.volume-slider::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
	}
	.volume-slider::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #aaa;
		border: none;
		cursor: pointer;
	}
	.volume-slider:hover::-webkit-slider-thumb {
		background: #fff;
	}
	.volume-slider:hover::-moz-range-thumb {
		background: #fff;
	}

	@media (max-width: 800px) {
		.volume-slider,
		.volume-icon {
			display: none;
		}

		.timeline-bar {
			gap: 0.25rem;
		}
	}

	.track-inline-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: 4px;
		background: none;
		color: #555;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.track-inline-btn:hover {
		color: #ccc;
		background: rgba(255, 255, 255, 0.06);
	}
</style>
