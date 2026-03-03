<script lang="ts">
	import type { SlideshowConfig, BeatSubdivision, TransitionType } from '../slideshow/types';
	import { TRANSITION_LABELS } from '../gl/transition-shaders';

	interface Props {
		config: SlideshowConfig;
		bpmDetecting: boolean;
		onDetectBpm: () => void;
		onConfigChange: (config: SlideshowConfig) => void;
		/** Playhead time in seconds; beat division row shows the segment at this time. */
		trackCurrentTime?: number;
		trackDuration?: number;
	}

	let { config, bpmDetecting, onDetectBpm, onConfigChange, trackCurrentTime = 0, trackDuration = 0 }: Props = $props();

	// Segment that contains the playhead (so sidebar shows that segment's beat division)
	let currentSegment = $derived.by(() => {
		const t = trackCurrentTime;
		if (config.segments.length === 0) return null;
		const sorted = [...config.segments].sort((a, b) => a.startTime - b.startTime);
		for (let i = 0; i < sorted.length; i++) {
			const nextStart = i < sorted.length - 1 ? sorted[i + 1].startTime : trackDuration;
			if (t >= sorted[i].startTime && t < nextStart) return sorted[i];
		}
		return null;
	});

	function set<K extends keyof SlideshowConfig>(key: K, value: SlideshowConfig[K]) {
		onConfigChange({ ...config, [key]: value });
	}

	// Tap BPM state
	let tapTimes: number[] = $state([]);
	let tapResetTimer: ReturnType<typeof setTimeout> | null = null;
	const TAP_RESET_MS = 2000;

	function handleTap() {
		const now = performance.now();
		if (tapResetTimer) clearTimeout(tapResetTimer);
		tapResetTimer = setTimeout(() => { tapTimes = []; }, TAP_RESET_MS);

		tapTimes = [...tapTimes, now];
		if (tapTimes.length < 2) return;

		// Keep last 8 taps for a stable average
		if (tapTimes.length > 8) tapTimes = tapTimes.slice(-8);

		const intervals: number[] = [];
		for (let i = 1; i < tapTimes.length; i++) {
			intervals.push(tapTimes[i] - tapTimes[i - 1]);
		}
		const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
		const bpm = Math.round((60000 / avgMs) * 2) / 2; // round to nearest 0.5
		set('bpm', Math.min(300, Math.max(20, bpm)));
	}

	const transitionTypes = Object.keys(TRANSITION_LABELS) as TransitionType[];

	function toggleTransition(type: TransitionType) {
		const current = config.enabledTransitions;
		const next = current.includes(type)
			? current.filter((t) => t !== type)
			: [...current, type];
		set('enabledTransitions', next);
	}
</script>

<div class="config-panel">
	<h3 class="panel-title">Slideshow</h3>

	<div class="config-row">
		<label for="ss-bpm">BPM</label>
		<input
			id="ss-bpm"
			type="number"
			min="20"
			max="300"
			step="0.5"
			value={config.bpm}
			oninput={(e) => set('bpm', +(e.currentTarget as HTMLInputElement).value)}
		/>
		<button
			class="detect-btn"
			onclick={onDetectBpm}
			disabled={bpmDetecting}
		>
			{bpmDetecting ? 'Detecting...' : 'Detect'}
		</button>
		<button
			class="detect-btn"
			onclick={handleTap}
		>
			Tap{tapTimes.length >= 2 ? ` (${tapTimes.length})` : ''}
		</button>
	</div>

	<div class="config-row">
		<label for="ss-subdiv">Beat division</label>
		<select
			id="ss-subdiv"
			value={currentSegment ? currentSegment.subdivision : config.subdivision}
			onchange={(e) => {
				const val = +(e.currentTarget as HTMLSelectElement).value as BeatSubdivision;
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
			<option value={0.0625}>1/16 beat</option>
			<option value={0.125}>1/8 beat</option>
			<option value={0.25}>1/4 beat</option>
			<option value={0.5}>1/2 beat</option>
			<option value={1}>Every beat</option>
			<option value={2}>Every 2 beats</option>
			<option value={4}>Every 4 beats</option>
		</select>
		{#if currentSegment}
			<span class="val" title="Segment at playhead">here</span>
		{:else if config.segments.length > 0}
			<span class="val" title="Overridden by timeline segments">default</span>
		{/if}
	</div>

	<div class="config-row">
		<label for="ss-mode">Mosh mode</label>
		<select
			id="ss-mode"
			value={config.moshMode}
			onchange={(e) => set('moshMode', (e.currentTarget as HTMLSelectElement).value as SlideshowConfig['moshMode'])}
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
			<input
				id="ss-mosh-min"
				type="range"
				min="1"
				max="20"
				step="1"
				value={config.moshMin}
				oninput={(e) => {
					const v = +(e.currentTarget as HTMLInputElement).value;
					set('moshMin', v);
					if (config.moshMax < v) set('moshMax', v);
				}}
			/>
			<span class="val">{config.moshMin}</span>
		</div>
		<div class="config-row">
			<label for="ss-mosh-max">Max effects</label>
			<input
				id="ss-mosh-max"
				type="range"
				min="1"
				max="20"
				step="1"
				value={config.moshMax}
				oninput={(e) => {
					const v = +(e.currentTarget as HTMLInputElement).value;
					set('moshMax', v);
					if (config.moshMin > v) set('moshMin', v);
				}}
			/>
			<span class="val">{config.moshMax}</span>
		</div>
	{/if}

	<div class="config-row">
		<label for="ss-audio-link">Audio links</label>
		<input
			id="ss-audio-link"
			type="checkbox"
			checked={config.moshAudioLink}
			onchange={(e) => set('moshAudioLink', (e.currentTarget as HTMLInputElement).checked)}
		/>
	</div>

	<div class="config-row">
		<label for="ss-loop">Loop images</label>
		<input
			id="ss-loop"
			type="checkbox"
			checked={config.loop}
			onchange={(e) => set('loop', (e.currentTarget as HTMLInputElement).checked)}
		/>
	</div>

	<h3 class="panel-title" style="margin-top: 0.5rem">Transitions</h3>

	<div class="transition-grid">
		{#each transitionTypes as type}
			<label class="transition-check">
				<input
					type="checkbox"
					checked={config.enabledTransitions.includes(type)}
					onchange={() => toggleTransition(type)}
				/>
				{TRANSITION_LABELS[type]}
			</label>
		{/each}
	</div>

	{#if config.enabledTransitions.length > 0}
		<div class="config-row">
			<label for="ss-trans-dur">Duration</label>
			<input
				id="ss-trans-dur"
				type="range"
				min="0.1"
				max="0.8"
				step="0.05"
				value={config.transitionDuration}
				oninput={(e) => set('transitionDuration', +(e.currentTarget as HTMLInputElement).value)}
			/>
			<span class="val">{Math.round(config.transitionDuration * 100)}%</span>
		</div>
	{/if}
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

	.config-row input[type='number'] {
		width: 64px;
		padding: 0.2rem 0.4rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #1a1a1a;
		color: #e0e0e0;
		font-size: 0.78rem;
		font-family: inherit;
	}

	.config-row input[type='range'] {
		flex: 1;
		accent-color: #888;
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

	.detect-btn {
		padding: 0.15rem 0.6rem;
		border: 1px solid #444;
		border-radius: 4px;
		background: transparent;
		color: #ccc;
		font-size: 0.7rem;
		cursor: pointer;
		font-family: inherit;
		white-space: nowrap;
	}

	.detect-btn:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
	}

	.detect-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.transition-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.2rem 0.5rem;
	}

	.transition-check {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.72rem;
		color: #999;
		cursor: pointer;
	}

	.transition-check input {
		accent-color: #888;
	}
</style>
