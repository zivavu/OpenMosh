<script lang="ts">
	import { FREQ_PRESETS } from '../../effects/types';

	interface Props {
		data: Uint8Array;
		sampleRate: number;
		binCount: number;
		freqMin: number;
		freqMax: number;
		width?: number;
		height?: number;
	}

	let {
		data,
		sampleRate,
		binCount,
		freqMin,
		freqMax,
		width = 200,
		height = 48,
	}: Props = $props();

	let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);

	// Capped at 16 kHz like the presets — above it is MP3/AAC lowpass dead zone.
	const AXIS_MIN_HZ = FREQ_PRESETS.full.min;
	const AXIS_MAX_HZ = FREQ_PRESETS.full.max;

	function hzToBin(hz: number): number {
		return (hz / sampleRate) * binCount * 2;
	}

	/** Log axis: constant ratio per bar, so every octave gets equal width. */
	function barFreq(t: number): number {
		return AXIS_MIN_HZ * (AXIS_MAX_HZ / AXIS_MIN_HZ) ** t;
	}

	/** Interpolated bin value, for bars narrower than one bin. */
	function sampleBin(pos: number): number {
		const clamped = Math.max(0, Math.min(binCount - 1, pos));
		const i = Math.floor(clamped);
		const frac = clamped - i;
		const a = data[i] ?? 0;
		const b = data[Math.min(binCount - 1, i + 1)] ?? 0;
		return a + (b - a) * frac;
	}

	$effect(() => {
		const canvas = canvasEl;
		if (!canvas || !data.length) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const w = width;
		const h = height;
		const bars = 64;
		const barW = w / bars;
		let rafId: number;
		// The analyser hands out raw bins now (its smoothing moved into the
		// shared band level, so exports get it too), so the bars are damped here
		// instead. Display-only: nothing downstream reads these.
		const shown = new Float32Array(bars);
		let lastFrame = performance.now();

		function draw() {
			if (!canvas || !ctx) return;
			const now = performance.now();
			const dt = Math.min((now - lastFrame) / 1000, 0.25);
			lastFrame = now;
			const damp = 1 - Math.exp(-dt / 0.075);
			ctx.fillStyle = '#1a1a1a';
			ctx.fillRect(0, 0, w, h);
			for (let i = 0; i < bars; i++) {
				const loHz = barFreq(i / bars);
				const hiHz = barFreq((i + 1) / bars);
				const b0 = hzToBin(loHz);
				const b1 = hzToBin(hiHz);
				const first = Math.floor(b0);
				const last = Math.min(binCount - 1, Math.floor(b1));
				// Peak, not mean: high bars span hundreds of bins and averaging
				// buries every transient in the noise floor around it.
				let peak: number;
				if (last <= first) {
					peak = sampleBin((b0 + b1) / 2);
				} else {
					peak = 0;
					for (let b = Math.max(0, first); b <= last; b++) {
						if (data[b] > peak) peak = data[b];
					}
				}
				shown[i] += (peak - shown[i]) * damp;
				const level = shown[i] / 255;
				const inRange = hiHz >= freqMin && loHz <= freqMax;
				ctx.fillStyle = inRange
					? 'rgba(120, 180, 255, 0.8)'
					: 'rgba(80, 80, 80, 0.9)';
				const barH = Math.max(2, level * h * 0.9);
				ctx.fillRect(i * barW, h - barH, barW - 1, barH);
			}
			rafId = requestAnimationFrame(draw);
		}
		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	});
</script>

<canvas
	bind:this={canvasEl}
	class="spectrum-canvas"
	{width}
	{height}
	aria-label="Frequency spectrum"
></canvas>

<style>
	.spectrum-canvas {
		display: block;
		border-radius: 4px;
		background: #1a1a1a;
	}
</style>
