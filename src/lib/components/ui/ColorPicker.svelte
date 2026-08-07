<script lang="ts">
	import { untrack } from 'svelte';
	import { hexToHsv, hsvToHex, normalizeHex, type Hsv } from '../../color';

	interface Props {
		value: string;
		/** Used when the hex field holds something unparseable. */
		defaultValue: string;
		onChange: (hex: string) => void;
		id?: string;
	}

	let { value, defaultValue, onChange, id }: Props = $props();

	/** Fixed palette — the app's usual glitch primaries plus the neutrals. */
	const SWATCHES = [
		'#000000',
		'#ffffff',
		'#ff0000',
		'#ff7a00',
		'#ffe600',
		'#00ff66',
		'#00e5ff',
		'#0066ff',
		'#7a00ff',
		'#ff00c8',
	];

	let open = $state(false);
	let hsv = $state<Hsv>(untrack(() => hexToHsv(value, defaultValue)));
	let root = $state<HTMLElement | null>(null);

	// Click-away / Escape to close. Bound on pointerdown so a drag that starts
	// outside closes immediately, and capture-phase so a stopPropagation()
	// elsewhere in the panel can't strand the picker open.
	$effect(() => {
		if (!open) return;

		const onPointerDown = (e: PointerEvent) => {
			if (!root?.contains(e.target as Node)) open = false;
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			open = false;
			(root?.querySelector('.swatch') as HTMLElement | null)?.focus();
		};

		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	});

	// Re-sync from the outside (typed hex, preset load, undo) without clobbering
	// the hue while dragging through greys, where hex → hsv can't recover it.
	$effect(() => {
		const hex = normalizeHex(value, defaultValue);
		if (hex !== hsvToHex(hsv)) hsv = hexToHsv(hex, defaultValue);
	});

	const swatchColor = $derived(normalizeHex(value, defaultValue));
	const hueColor = $derived(hsvToHex({ h: hsv.h, s: 1, v: 1 }));

	function commit(next: Hsv) {
		hsv = next;
		onChange(hsvToHex(next));
	}

	function trackPointer(
		e: PointerEvent,
		update: (fx: number, fy: number) => void,
	) {
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		const apply = (ev: PointerEvent) => {
			const rect = el.getBoundingClientRect();
			const fx = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
			const fy = Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height));
			update(fx, fy);
		};
		apply(e);
		const onMove = (ev: PointerEvent) => apply(ev);
		const onUp = () => {
			el.removeEventListener('pointermove', onMove);
			el.removeEventListener('pointerup', onUp);
			el.removeEventListener('pointercancel', onUp);
		};
		el.addEventListener('pointermove', onMove);
		el.addEventListener('pointerup', onUp);
		el.addEventListener('pointercancel', onUp);
	}

	function onAreaKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.1 : 0.02;
		if (e.key === 'ArrowLeft') commit({ ...hsv, s: Math.max(0, hsv.s - step) });
		else if (e.key === 'ArrowRight')
			commit({ ...hsv, s: Math.min(1, hsv.s + step) });
		else if (e.key === 'ArrowUp') commit({ ...hsv, v: Math.min(1, hsv.v + step) });
		else if (e.key === 'ArrowDown')
			commit({ ...hsv, v: Math.max(0, hsv.v - step) });
		else return;
		e.preventDefault();
	}

	function onHueKey(e: KeyboardEvent) {
		const step = e.shiftKey ? 30 : 5;
		if (e.key === 'ArrowLeft') commit({ ...hsv, h: (hsv.h - step + 360) % 360 });
		else if (e.key === 'ArrowRight') commit({ ...hsv, h: (hsv.h + step) % 360 });
		else return;
		e.preventDefault();
	}
</script>

<div class="color-picker" bind:this={root}>
	<div class="color-row">
		<button
			{id}
			type="button"
			class="swatch"
			style="background: {swatchColor}"
			title={open ? 'Close picker' : 'Pick a color'}
			aria-label="Pick a color"
			aria-expanded={open}
			onclick={() => (open = !open)}
		></button>
		<input
			class="hex"
			type="text"
			spellcheck="false"
			{value}
			oninput={(e) => onChange(e.currentTarget.value)}
			onblur={(e) =>
				onChange(normalizeHex(e.currentTarget.value, defaultValue))}
		/>
	</div>

	{#if open}
		<div class="picker">
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="sv-area"
				role="slider"
				tabindex="0"
				aria-label="Saturation and brightness"
				aria-valuenow={Math.round(hsv.v * 100)}
				style="--hue: {hueColor}"
				onpointerdown={(e) =>
					trackPointer(e, (fx, fy) => commit({ ...hsv, s: fx, v: 1 - fy }))}
				onkeydown={onAreaKey}
			>
				<span
					class="sv-thumb"
					style="left: {hsv.s * 100}%; top: {(1 - hsv.v) * 100}%"
				></span>
			</div>

			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div
				class="hue-strip"
				role="slider"
				tabindex="0"
				aria-label="Hue"
				aria-valuenow={Math.round(hsv.h)}
				aria-valuemin={0}
				aria-valuemax={360}
				onpointerdown={(e) =>
					trackPointer(e, (fx) => commit({ ...hsv, h: fx * 360 }))}
				onkeydown={onHueKey}
			>
				<span class="hue-thumb" style="left: {(hsv.h / 360) * 100}%"></span>
			</div>

			<div class="swatches">
				{#each SWATCHES as hex (hex)}
					<button
						type="button"
						class="preset"
						class:active={hex === swatchColor}
						style="background: {hex}"
						title={hex}
						aria-label={hex}
						onclick={() => onChange(hex)}
					></button>
				{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.color-picker {
		flex: 1;
		min-width: 0;
	}

	.color-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.swatch {
		width: 24px;
		height: 20px;
		padding: 0;
		border: 1px solid #444;
		border-radius: 3px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.swatch:hover {
		border-color: #777;
	}

	.hex {
		width: 6.5rem;
		background: #1a1a1a;
		color: #ccc;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		font-size: 0.7rem;
		font-family: inherit;
		font-variant-numeric: tabular-nums;
		outline: none;
		min-width: 0;
	}

	.hex:focus {
		border-color: #555;
	}

	.picker {
		margin-top: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.sv-area {
		position: relative;
		width: 100%;
		height: 86px;
		border-radius: 4px;
		border: 1px solid #333;
		cursor: crosshair;
		touch-action: none;
		background:
			linear-gradient(to top, #000, rgba(0, 0, 0, 0)),
			linear-gradient(to right, #fff, rgba(255, 255, 255, 0)),
			var(--hue);
	}

	.sv-area:focus-visible,
	.hue-strip:focus-visible {
		outline: 1px solid #666;
		outline-offset: 1px;
	}

	.sv-thumb {
		position: absolute;
		width: 10px;
		height: 10px;
		margin: -5px 0 0 -5px;
		border-radius: 50%;
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.hue-strip {
		position: relative;
		width: 100%;
		height: 12px;
		border-radius: 4px;
		border: 1px solid #333;
		cursor: ew-resize;
		touch-action: none;
		background: linear-gradient(
			to right,
			#f00 0%,
			#ff0 17%,
			#0f0 33%,
			#0ff 50%,
			#00f 67%,
			#f0f 83%,
			#f00 100%
		);
	}

	.hue-thumb {
		position: absolute;
		top: -2px;
		bottom: -2px;
		width: 4px;
		margin-left: -2px;
		border-radius: 2px;
		background: #fff;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
	}

	.preset {
		width: 16px;
		height: 16px;
		padding: 0;
		border: 1px solid #333;
		border-radius: 3px;
		cursor: pointer;
	}

	.preset:hover {
		border-color: #888;
	}

	.preset.active {
		border-color: #ccc;
	}
</style>
