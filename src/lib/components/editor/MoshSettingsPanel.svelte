<script lang="ts">
	interface Props {
		moshMin: number;
		moshMax: number;
		randomizeOrder: boolean;
		moshAudioLink: boolean;
		moshAudioLinkStrength: number;
	}

	let {
		moshMin = $bindable(),
		moshMax = $bindable(),
		randomizeOrder = $bindable(),
		moshAudioLink = $bindable(),
		moshAudioLinkStrength = $bindable(),
	}: Props = $props();
</script>

<div class="config-panel">
	<h3 class="panel-title">Mosh settings</h3>
	<div class="config-row">
		<label for="mosh-min">Min effects</label>
		<input
			id="mosh-min"
			type="range"
			min="1"
			max="20"
			step="1"
			bind:value={moshMin}
			oninput={() => {
				if (moshMax < moshMin) moshMax = moshMin;
			}}
		/>
		<span class="val">{moshMin}</span>
	</div>
	<div class="config-row">
		<label for="mosh-max">Max effects</label>
		<input
			id="mosh-max"
			type="range"
			min="1"
			max="20"
			step="1"
			bind:value={moshMax}
			oninput={() => {
				if (moshMin > moshMax) moshMin = moshMax;
			}}
		/>
		<span class="val">{moshMax}</span>
	</div>
	<div class="config-row">
		<label for="mosh-shuffle">Shuffle order</label>
		<input id="mosh-shuffle" type="checkbox" bind:checked={randomizeOrder} />
	</div>
	<div class="config-row">
		<label for="mosh-audio-link">Random audio links</label>
		<input id="mosh-audio-link" type="checkbox" bind:checked={moshAudioLink} />
	</div>
	{#if moshAudioLink}
		<div class="config-row">
			<label for="mosh-audio-link-strength">Links strength</label>
			<input
				id="mosh-audio-link-strength"
				type="range"
				min="0"
				max="1"
				step="0.05"
				bind:value={moshAudioLinkStrength}
			/>
			<span class="val">{Math.round(moshAudioLinkStrength * 100)}%</span>
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

	.config-row input[type='range'] {
		flex: 1;
		height: 3px;
		appearance: none;
		background: #333;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.config-row input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
		transition: background 0.15s;
	}

	.config-row input[type='range']::-webkit-slider-thumb:hover {
		background: #ddd;
	}

	.config-row input[type='range']::-moz-range-thumb {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #aaa;
		border: none;
		cursor: pointer;
		transition: background 0.15s;
	}

	.config-row input[type='range']::-moz-range-thumb:hover {
		background: #ddd;
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
