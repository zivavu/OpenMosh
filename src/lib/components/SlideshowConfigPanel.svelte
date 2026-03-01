<script lang="ts">
	import type { SlideshowConfig, BeatSubdivision } from '../slideshow/types';

	interface Props {
		config: SlideshowConfig;
		bpmDetecting: boolean;
		onDetectBpm: () => void;
		onConfigChange: (config: SlideshowConfig) => void;
	}

	let { config, bpmDetecting, onDetectBpm, onConfigChange }: Props = $props();

	function set<K extends keyof SlideshowConfig>(key: K, value: SlideshowConfig[K]) {
		onConfigChange({ ...config, [key]: value });
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
	</div>

	<div class="config-row">
		<label for="ss-subdiv">Beat division</label>
		<select
			id="ss-subdiv"
			value={config.subdivision}
			onchange={(e) => set('subdivision', +(e.currentTarget as HTMLSelectElement).value as BeatSubdivision)}
		>
			<option value={0.25}>1/4 beat</option>
			<option value={0.5}>1/2 beat</option>
			<option value={1}>Every beat</option>
			<option value={2}>Every 2 beats</option>
			<option value={4}>Every 4 beats</option>
		</select>
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
</style>
