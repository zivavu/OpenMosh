<script lang="ts">
	import BpmControl from '../ui/BpmControl.svelte';
	import RangeSlider from '../ui/RangeSlider.svelte';
	import type { BeatSubdivision, SlideshowConfig } from '../../slideshow/types';

	interface Props {
		config: SlideshowConfig;
		bpmDetecting: boolean;
		hasTrack?: boolean;
		onDetectBpm: () => void;
		onConfigChange: (config: SlideshowConfig) => void;
		/** Playhead time in seconds; beat division row shows the segment at this time. */
		trackCurrentTime?: number;
		trackDuration?: number;
	}

	let {
		config,
		bpmDetecting,
		hasTrack = false,
		onDetectBpm,
		onConfigChange,
		trackCurrentTime = 0,
		trackDuration = 0,
	}: Props = $props();

	// Segment that contains the playhead (so sidebar shows that segment's beat division)
	let currentSegment = $derived.by(() => {
		const t = trackCurrentTime;
		if (config.segments.length === 0) return null;
		const sorted = [...config.segments].sort(
			(a, b) => a.startTime - b.startTime,
		);
		for (let i = 0; i < sorted.length; i++) {
			const nextStart =
				i < sorted.length - 1 ? sorted[i + 1].startTime : trackDuration;
			if (t >= sorted[i].startTime && t < nextStart) return sorted[i];
		}
		return null;
	});

	function set<K extends keyof SlideshowConfig>(
		key: K,
		value: SlideshowConfig[K],
	) {
		onConfigChange({ ...config, [key]: value });
	}

</script>

<div class="config-panel">
	<h3 class="panel-title">Timing</h3>

	<BpmControl
		id="ss-bpm"
		bpm={config.bpm}
		onBpmChange={(v) => set('bpm', v)}
		{bpmDetecting}
		{hasTrack}
		{onDetectBpm}
	/>

	<div class="config-row">
		<label for="ss-subdiv">Beat division</label>
		<select
			id="ss-subdiv"
			value={currentSegment ? currentSegment.subdivision : config.subdivision}
			onchange={(e) => {
				const val = +(e.currentTarget as HTMLSelectElement)
					.value as BeatSubdivision;
				if (currentSegment) {
					onConfigChange({
						...config,
						segments: config.segments.map((s) =>
							s.id === currentSegment!.id ? { ...s, subdivision: val } : s,
						),
					});
				} else {
					set('subdivision', val);
				}
			}}
		>
			<option value={0.03125}>1/32 beat</option>
			<option value={0.0625}>1/16 beat</option>
			<option value={0.125}>1/8 beat</option>
			<option value={0.25}>1/4 beat</option>
			<option value={0.5}>1/2 beat</option>
			<option value={1}>Every beat</option>
			<option value={2}>Every 2 beats</option>
			<option value={4}>Every 4 beats</option>
			<option value={0}>Stop</option>
		</select>
	</div>

	<h3 class="panel-title section-title">Mosh</h3>

	<div class="config-row">
		<label for="ss-mode">Mosh mode</label>
		<select
			id="ss-mode"
			value={config.moshMode}
			onchange={(e) =>
				set(
					'moshMode',
					(e.currentTarget as HTMLSelectElement)
						.value as SlideshowConfig['moshMode'],
				)}
		>
			<option value="random">Random</option>
			<option value="consistent">Consistent</option>
			<option value="smooth">Smooth</option>
			<option value="per-image">Per-image preset</option>
		</select>
	</div>

	{#if config.moshMode === 'random' || config.moshMode === 'smooth'}
		<div class="config-row">
			<label for="ss-mosh-min">Min effects</label>
			<RangeSlider
				id="ss-mosh-min"
				value={config.moshMin}
				min={1}
				max={20}
				step={1}
				oninput={(v) => {
					set('moshMin', v);
					if (config.moshMax < v) set('moshMax', v);
				}}
			/>
			<span class="val">{config.moshMin}</span>
		</div>
		<div class="config-row">
			<label for="ss-mosh-max">Max effects</label>
			<RangeSlider
				id="ss-mosh-max"
				value={config.moshMax}
				min={1}
				max={20}
				step={1}
				oninput={(v) => {
					set('moshMax', v);
					if (config.moshMin > v) set('moshMin', v);
				}}
			/>
			<span class="val">{config.moshMax}</span>
		</div>
	{/if}

	{#if config.moshMode === 'smooth'}
		<div class="config-row">
			<label for="ss-smooth-speed">Change rate</label>
			<RangeSlider
				id="ss-smooth-speed"
				value={config.smoothSpeed ?? 1}
				min={1}
				max={5}
				step={1}
				oninput={(v) => set('smoothSpeed', v)}
			/>
			<span class="val">{config.smoothSpeed ?? 1}</span>
		</div>
	{/if}

	{#if hasTrack && (config.moshMode === 'random' || config.moshMode === 'smooth')}
		<div class="config-row">
			<label for="ss-audio-link">Random audio links</label>
			<input
				id="ss-audio-link"
				type="checkbox"
				checked={config.moshAudioLink}
				onchange={(e) =>
					set('moshAudioLink', (e.currentTarget as HTMLInputElement).checked)}
			/>
		</div>

		{#if config.moshAudioLink}
			<div class="config-row">
				<label for="ss-audio-link-strength">Link strength</label>
				<RangeSlider
					id="ss-audio-link-strength"
					value={config.moshAudioLinkStrength}
					min={0}
					max={1}
					step={0.05}
					oninput={(v) => set('moshAudioLinkStrength', v)}
				/>
				<span class="val">{Math.round(config.moshAudioLinkStrength * 100)}%</span>
			</div>
		{/if}
	{/if}

	<h3 class="panel-title section-title">Playback</h3>

	<div class="config-row">
		<label for="ss-loop">Loop images</label>
		<input
			id="ss-loop"
			type="checkbox"
			checked={config.loop}
			onchange={(e) =>
				set('loop', (e.currentTarget as HTMLInputElement).checked)}
		/>
	</div>

</div>

<style>
	.config-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border-bottom: 1px solid #2a2a2a;
	}

	.panel-title {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #888;
		text-transform: uppercase;
		margin-bottom: 0.25rem;
	}

	.section-title {
		margin-top: 0.25rem;
		padding-top: 0.75rem;
		border-top: 1px solid #2a2a2a;
	}

	.config-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
	}

	.config-row label {
		flex-shrink: 0;
		min-width: 80px;
		color: #999;
		font-size: 0.75rem;
	}

	.config-row select {
		flex: 1;
		padding: 0.2rem 0.3rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #1a1a1a;
		color: #e0e0e0;
		font-size: 0.75rem;
		font-family: inherit;
	}

	.config-row input[type='checkbox'] {
		accent-color: #888;
	}

	.val {
		min-width: 24px;
		text-align: right;
		color: #888;
		font-size: 0.75rem;
	}

</style>
