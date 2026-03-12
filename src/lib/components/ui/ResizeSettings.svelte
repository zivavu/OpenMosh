<script lang="ts">
	const MAX_RESIZE = 10000;

	const RATIO_PRESETS = [
		{ label: 'Free', value: 'free', ratio: null },
		{ label: '1:1', value: '1:1', ratio: 1 },
		{ label: '4:3', value: '4:3', ratio: 4 / 3 },
		{ label: '16:9', value: '16:9', ratio: 16 / 9 },
		{ label: '9:16', value: '9:16', ratio: 9 / 16 },
		{ label: '21:9', value: '21:9', ratio: 21 / 9 },
	] as const;

	type RatioValue = (typeof RATIO_PRESETS)[number]['value'];

	interface Props {
		naturalWidth: number | undefined;
		naturalHeight: number | undefined;
		width: number;
		height: number;
	}

	let {
		naturalWidth,
		naturalHeight,
		width = $bindable(0),
		height = $bindable(0),
	}: Props = $props();

	let selectedRatio = $state<RatioValue>('free');
	let lockAspect = $state(true);

	function getPresetRatio(): number | null {
		return RATIO_PRESETS.find((p) => p.value === selectedRatio)?.ratio ?? null;
	}

	function setWidth(w: number) {
		const val = Math.min(MAX_RESIZE, Math.max(1, Math.round(w)));
		const presetRatio = getPresetRatio();
		if (presetRatio !== null) {
			width = val;
			height = Math.min(MAX_RESIZE, Math.max(1, Math.round(val / presetRatio)));
		} else if (lockAspect && height > 0) {
			const currentRatio = width / height;
			width = val;
			height = Math.min(
				MAX_RESIZE,
				Math.max(1, Math.round(val / currentRatio)),
			);
		} else {
			width = val;
		}
	}

	function setHeight(h: number) {
		const val = Math.min(MAX_RESIZE, Math.max(1, Math.round(h)));
		const presetRatio = getPresetRatio();
		if (presetRatio !== null) {
			height = val;
			width = Math.min(MAX_RESIZE, Math.max(1, Math.round(val * presetRatio)));
		} else if (lockAspect && width > 0) {
			const currentRatio = width / height;
			height = val;
			width = Math.min(MAX_RESIZE, Math.max(1, Math.round(val * currentRatio)));
		} else {
			height = val;
		}
	}

	function selectRatio(value: RatioValue) {
		selectedRatio = value;
		if (value !== 'free') lockAspect = false;
		const preset = RATIO_PRESETS.find((p) => p.value === value);
		if (preset?.ratio !== null && preset?.ratio !== undefined && width > 0) {
			height = Math.min(
				MAX_RESIZE,
				Math.max(1, Math.round(width / preset.ratio)),
			);
		}
	}

	function resetResize() {
		if (naturalWidth != null && naturalHeight != null) {
			width = naturalWidth;
			height = naturalHeight;
		}
		selectedRatio = 'free';
		lockAspect = false;
	}
</script>

<div class="ratio-row">
	{#each RATIO_PRESETS as preset}
		<button
			class="ratio-btn"
			class:active={selectedRatio === preset.value}
			onclick={() => selectRatio(preset.value)}
		>
			{preset.label}
		</button>
	{/each}
</div>
<div class="size-row">
	<label for="rs-width">Width</label>
	<input
		id="rs-width"
		class="size-input"
		type="number"
		min="1"
		max={MAX_RESIZE}
		step="1"
		value={width}
		oninput={(e) => setWidth(+(e.currentTarget as HTMLInputElement).value)}
	/>
	<button
		class="lock-btn"
		class:active={lockAspect}
		onclick={() => {
			lockAspect = !lockAspect;
			if (lockAspect) selectedRatio = 'free';
		}}
		title={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
	>
		{#if lockAspect}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="11"
				height="11"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path
					d="M7 11V7a5 5 0 0 1 10 0v4"
				/></svg
			>
		{:else}
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="11"
				height="11"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path
					d="M7 11V7a5 5 0 0 1 9.9-1"
				/></svg
			>
		{/if}
	</button>
</div>

<div class="size-row">
	<label for="rs-height">Height</label>
	<input
		id="rs-height"
		class="size-input"
		type="number"
		min="1"
		max={MAX_RESIZE}
		step="1"
		value={height}
		oninput={(e) => setHeight(+(e.currentTarget as HTMLInputElement).value)}
	/>
</div>
<button
	class="reset-btn"
	onclick={resetResize}
	title="Reset to original size"
	disabled={naturalWidth == null || naturalHeight == null}
>
	Reset to original
</button>

<style>
	.ratio-row {
		display: flex;
		gap: 2px;
		background: #111;
		border: 1px solid #333;
		border-radius: 5px;
		overflow: hidden;
		margin-bottom: 0.15rem;
	}

	.ratio-btn {
		flex: 1;
		padding: 0.25rem 0;
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		font-family: inherit;
		background: none;
		border: none;
		color: #666;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
		white-space: nowrap;
	}

	.ratio-btn:not(:last-child) {
		border-right: 1px solid #2a2a2a;
	}

	.ratio-btn.active {
		color: #ddd;
		background: rgba(255, 255, 255, 0.07);
	}

	.ratio-btn:hover:not(.active) {
		color: #bbb;
	}

	.size-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.size-row label {
		font-size: 0.7rem;
		color: #888;
		min-width: 72px;
		flex-shrink: 0;
	}

	.size-input {
		width: 4.5rem;
		background: #1a1a1a;
		color: #aaa;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		font-size: 0.7rem;
		font-family: inherit;
		outline: none;
	}

	.size-input:focus {
		border-color: #555;
	}

	.lock-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.4rem;
		height: 1.4rem;
		flex-shrink: 0;
		background: none;
		border: 1px solid #333;
		border-radius: 4px;
		color: #555;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
		padding: 0;
	}

	.lock-btn:hover {
		color: #aaa;
		border-color: #555;
	}

	.lock-btn.active {
		color: #ccc;
		border-color: #666;
	}

	.reset-btn {
		margin-top: 0.25rem;
		padding: 0.35rem 0.75rem;
		border: 1px solid #444;
		border-radius: 6px;
		background: none;
		color: #888;
		font-size: 0.7rem;
		font-family: inherit;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.reset-btn:hover {
		color: #ccc;
		border-color: #666;
	}

	.reset-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
</style>
