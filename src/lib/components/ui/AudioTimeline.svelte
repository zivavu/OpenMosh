<script lang="ts">
	import { Pause, Play, Repeat, X } from 'lucide-svelte';
	import { formatTime } from '../../audio/audio-utils';
	import type { SlideshowConfig } from '../../slideshow/types';
	import TimelineSegments from '../slideshow/TimelineSegments.svelte';

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
		loopEnabled?: boolean;
		onToggleLoop?: () => void;
		onRemoveTrack?: () => void;
		ariaLabel?: string;
		// Slideshow-only (segments)
		config?: SlideshowConfig;
		selectedSegmentId?: string | null;
		onConfigChange?: (c: SlideshowConfig) => void;
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
		loopEnabled = false,
		onToggleLoop,
		onRemoveTrack,
		ariaLabel = 'Timeline',
		config,
		selectedSegmentId = $bindable(null),
		onConfigChange,
	}: Props = $props();

	let timelineTrackEl = $state<HTMLDivElement | undefined>(undefined);

	function timeFromClientX(clientX: number): number {
		if (!timelineTrackEl) return 0;
		const rect = timelineTrackEl.getBoundingClientRect();
		const x = clientX - rect.left;
		const pct = Math.max(0, Math.min(1, x / rect.width));
		return pct * trackDuration;
	}

	function handleFromClientX(clientX: number): 'start' | 'end' | null {
		if (!timelineTrackEl || trackDuration === 0) return null;
		const rect = timelineTrackEl.getBoundingClientRect();
		const x = clientX - rect.left;
		const startX = (spanStart / trackDuration) * rect.width;
		const endX = (spanEnd / trackDuration) * rect.width;
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
			onSeek(timeFromClientX(e.clientX));
		}
	}

	function beginHandleDrag(handle: 'start' | 'end', startClientX: number) {
		function applyPosition(clientX: number) {
			const t = timeFromClientX(clientX);
			if (handle === 'start') {
				onSpanStartChange(Math.max(0, Math.min(t, spanEnd - 0.1)));
			} else {
				onSpanEndChange(Math.max(spanStart + 0.1, Math.min(trackDuration, t)));
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
	<div
		class="timeline-track-wrap"
		bind:this={timelineTrackEl}
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
				style="left: {(spanStart / trackDuration) * 100}%; width: {((spanEnd -
					spanStart) /
					trackDuration) *
					100}%"
			>
			</div>
			<div
				class="timeline-handle timeline-handle-start"
				style="left: {(spanStart / trackDuration) * 100}%"
				aria-hidden="true"
			></div>
			<div
				class="timeline-handle timeline-handle-end"
				style="left: {(spanEnd / trackDuration) * 100}%"
				aria-hidden="true"
			></div>
			<div
				class="timeline-playhead"
				style="left: {(trackCurrentTime / trackDuration) * 100}%"
				aria-hidden="true"
			></div>
		</div>
	</div>
	<span class="timeline-time">{formatTime(spanEnd)}</span>
	{#if onVolumeChange}
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
		<button class="track-inline-btn" onclick={onRemoveTrack} title="Remove track" aria-label="Remove track">
			<X size={12} />
		</button>
	{/if}
</div>

{#if config && onConfigChange}
	<TimelineSegments
		{config}
		{trackDuration}
		{onConfigChange}
		alignToEl={timelineTrackEl}
		bind:selectedSegmentId
		currentTime={trackCurrentTime}
		{onSeek}
	/>
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
		.volume-slider {
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
