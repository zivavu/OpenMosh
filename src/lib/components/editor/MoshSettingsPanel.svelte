<script lang="ts">
	import RangeSlider from '../ui/RangeSlider.svelte';

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
		<RangeSlider
			id="mosh-min"
			bind:value={moshMin}
			min={1}
			max={20}
			step={1}
			oninput={(v) => { if (moshMax < v) moshMax = v; }}
		/>
		<span class="val">{moshMin}</span>
	</div>
	<div class="config-row">
		<label for="mosh-max">Max effects</label>
		<RangeSlider
			id="mosh-max"
			bind:value={moshMax}
			min={1}
			max={20}
			step={1}
			oninput={(v) => { if (moshMin > v) moshMin = v; }}
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
			<RangeSlider
				id="mosh-audio-link-strength"
				bind:value={moshAudioLinkStrength}
				min={0}
				max={1}
				step={0.05}
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
		max-width: 100%;
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
		min-width: 80px;
		color: #999;
		font-size: 0.75rem;
	}

	.config-row input[type='checkbox'] {
		accent-color: #888;
	}

	.val {
		color: #888;
		font-size: 0.75rem;
	}
</style>
