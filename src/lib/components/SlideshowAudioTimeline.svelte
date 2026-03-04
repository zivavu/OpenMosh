<script lang="ts">
	import { formatTime } from '../audio/audio-utils';
	import type { SlideshowConfig } from '../slideshow/types';
	import TimelineSegments from './TimelineSegments.svelte';

	interface Props {
		trackDuration: number;
		trackCurrentTime: number;
		spanStart: number;
		spanEnd: number;
		audioPlaying: boolean;
		outputVolume: number;
		config: SlideshowConfig;
		selectedSegmentId?: string | null;
		onConfigChange: (c: SlideshowConfig) => void;
		onPlay: () => void;
		onPause: () => void;
		onSeek: (t: number) => void;
		onSpanStartChange: (t: number) => void;
		onSpanEndChange: (t: number) => void;
		onVolumeChange: (v: number) => void;
		onRemoveTrack: () => void;
	}

	let {
		trackDuration,
		trackCurrentTime,
		spanStart,
		spanEnd,
		audioPlaying,
		outputVolume,
		config,
		selectedSegmentId = $bindable(null),
		onConfigChange,
		onPlay,
		onPause,
		onSeek,
		onSpanStartChange,
		onSpanEndChange,
		onVolumeChange,
		onRemoveTrack,
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
				style="left: {(spanStart / trackDuration) *
					100}%; width: {((spanEnd - spanStart) / trackDuration) * 100}%"
			></div>
			<div
				class="timeline-playhead"
				style="left: {(trackCurrentTime / trackDuration) * 100}%"
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
<TimelineSegments
	{config}
	{trackDuration}
	{onConfigChange}
	alignToEl={timelineTrackEl}
	bind:selectedSegmentId
	currentTime={trackCurrentTime}
	onSeek={onSeek}
/>

<style>
	.timeline-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.35rem 0.75rem;
		border-top: 1px solid #2a2a2a;
		font-size: 0.7rem;
	}

	.timeline-label {
		color: #555;
		font-weight: 600;
		letter-spacing: 0.05em;
		min-width: 24px;
	}

	.timeline-play-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		background: transparent;
		color: #999;
		cursor: pointer;
		border-radius: 4px;
	}

	.timeline-play-btn:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.05);
	}

	.timeline-time {
		color: #666;
		font-variant-numeric: tabular-nums;
		min-width: 36px;
	}

	.timeline-track-wrap {
		flex: 1;
		height: 24px;
		display: flex;
		align-items: center;
		cursor: pointer;
		outline: none;
	}

	.timeline-track {
		position: relative;
		width: 100%;
		height: 4px;
		background: #2a2a2a;
		border-radius: 2px;
	}

	.timeline-span {
		position: absolute;
		top: 0;
		height: 100%;
		background: rgba(255, 255, 255, 0.12);
		border-radius: 2px;
	}

	.timeline-playhead {
		position: absolute;
		top: -4px;
		width: 2px;
		height: 12px;
		background: #fff;
		border-radius: 1px;
		transform: translateX(-1px);
		pointer-events: none;
	}

	.timeline-handle {
		position: absolute;
		top: -6px;
		width: 8px;
		height: 16px;
		background: #888;
		border: none;
		border-radius: 2px;
		cursor: ew-resize;
		transform: translateX(-4px);
		padding: 0;
	}

	.timeline-handle:hover {
		background: #ccc;
	}

	.volume-slider {
		width: 60px;
		accent-color: #888;
	}

	.track-inline-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border: none;
		background: transparent;
		color: #555;
		cursor: pointer;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.track-inline-btn:hover {
		color: #aaa;
		background: rgba(255, 255, 255, 0.05);
	}
</style>
