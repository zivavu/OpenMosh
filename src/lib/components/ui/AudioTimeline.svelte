<script lang="ts">
	import { formatTime } from '../../audio/audio-utils';
	import type { SlideshowConfig } from '../../slideshow/types';
	import TimelineSegments from '../slideshow/TimelineSegments.svelte';

	interface Props {
		trackDuration: number;
		trackCurrentTime: number;
		spanStart: number;
		spanEnd: number;
		audioPlaying: boolean;
		outputVolume: number;
		onPlay: () => void;
		onPause: () => void;
		onSeek: (t: number) => void;
		onSpanStartChange: (t: number) => void;
		onSpanEndChange: (t: number) => void;
		onVolumeChange: (v: number) => void;
		onRemoveTrack: () => void;
		// Slideshow-only (segments)
		config?: SlideshowConfig;
		selectedSegmentId?: string | null;
		onConfigChange?: (c: SlideshowConfig) => void;
	}

	let {
		trackDuration,
		trackCurrentTime,
		spanStart,
		spanEnd,
		audioPlaying,
		outputVolume,
		onPlay,
		onPause,
		onSeek,
		onSpanStartChange,
		onSpanEndChange,
		onVolumeChange,
		onRemoveTrack,
		config,
		selectedSegmentId = $bindable(null),
		onConfigChange,
	}: Props = $props();

	let draggingHandle = $state<'start' | 'end' | null>(null);
	let timelineTrackEl = $state<HTMLDivElement | undefined>(undefined);

	function timeFromEvent(e: { clientX: number }): number {
		if (!timelineTrackEl) return 0;
		const rect = timelineTrackEl.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const pct = Math.max(0, Math.min(1, x / rect.width));
		return pct * trackDuration;
	}

	function onTimelinePointerDown(
		e: PointerEvent,
		handle: 'start' | 'end' | null,
	) {
		e.preventDefault();
		if (handle === 'start' || handle === 'end') {
			draggingHandle = handle;
			(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		} else {
			onSeek(timeFromEvent(e));
		}
	}

	$effect(() => {
		const handle = draggingHandle;
		if (handle === null) return;
		const move = (e: PointerEvent) => {
			if (!timelineTrackEl) return;
			const rect = timelineTrackEl.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const pct = Math.max(0, Math.min(1, x / rect.width));
			const t = pct * trackDuration;
			if (handle === 'start') {
				onSpanStartChange(Math.max(0, Math.min(t, spanEnd - 0.1)));
			} else {
				onSpanEndChange(Math.max(spanStart + 0.1, Math.min(trackDuration, t)));
			}
		};
		const up = () => {
			draggingHandle = null;
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		return () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
	});
</script>

<div class="timeline-bar">
	<span class="timeline-label">AUD</span>
	<button
		class="timeline-play-btn"
		onclick={audioPlaying ? onPause : onPlay}
		title={audioPlaying ? 'Pause' : 'Play'}
	>
		{#if audioPlaying}
			<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
				<rect x="6" y="4" width="4" height="16" />
				<rect x="14" y="4" width="4" height="16" />
			</svg>
		{:else}
			<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
				<polygon points="5 3 19 12 5 21 5 3" />
			</svg>
		{/if}
	</button>
	<span class="timeline-time">{formatTime(trackCurrentTime)}</span>
	<div
		class="timeline-track-wrap"
		bind:this={timelineTrackEl}
		role="slider"
		aria-label="Timeline"
		aria-valuenow={trackCurrentTime}
		aria-valuemin={0}
		aria-valuemax={trackDuration}
		tabindex="0"
		onpointerdown={(e) => onTimelinePointerDown(e, null)}
	>
		<div class="timeline-track">
			<div
				class="timeline-span"
				style="left: {(spanStart / trackDuration) * 100}%; width: {((spanEnd -
					spanStart) /
					trackDuration) *
					100}%"
			></div>
			<div
				class="timeline-playhead"
				style="left: {(trackCurrentTime / trackDuration) * 100}%"
				aria-hidden="true"
			></div>
			<button
				type="button"
				class="timeline-handle timeline-handle-start"
				style="left: {(spanStart / trackDuration) * 100}%"
				title="Span start"
				onpointerdown={(e) => {
					e.stopPropagation();
					onTimelinePointerDown(e, 'start');
				}}
			></button>
			<button
				type="button"
				class="timeline-handle timeline-handle-end"
				style="left: {(spanEnd / trackDuration) * 100}%"
				title="Span end"
				onpointerdown={(e) => {
					e.stopPropagation();
					onTimelinePointerDown(e, 'end');
				}}
			></button>
		</div>
	</div>
	<span class="timeline-time">{formatTime(spanEnd)}</span>
	<input
		type="range"
		class="volume-slider"
		min="0"
		max="1"
		step="0.01"
		value={outputVolume}
		oninput={(e) => onVolumeChange(+(e.currentTarget as HTMLInputElement).value)}
		title="Volume: {Math.round(outputVolume * 100)}%"
	/>
	<button class="track-inline-btn" onclick={onRemoveTrack} title="Remove track">
		<svg
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	</button>
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
	}

	.timeline-span {
		position: absolute;
		top: 0;
		bottom: 0;
		background: rgba(255, 255, 255, 0.12);
		border-radius: 4px;
		pointer-events: none;
	}

	.timeline-playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: #888;
		margin-left: -1px;
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
		cursor: ew-resize;
		transition:
			background 0.15s,
			border-color 0.15s;
	}

	.timeline-handle:hover {
		background: #555;
		border-color: #666;
	}

	.timeline-handle:focus-visible {
		outline: 1px solid #888;
		outline-offset: 1px;
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
