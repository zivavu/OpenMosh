<script lang="ts">
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

	function hzToBin(hz: number): number {
		return Math.floor((hz / sampleRate) * binCount * 2);
	}

	/** Map bar index to a frequency range: 3/4 of bars for 20–8000 Hz, 1/4 for 8000–20000 Hz. */
	function barFreqRange(i: number, bars: number): [number, number] {
		const split = Math.floor(bars * 0.75);
		let lo: number, hi: number;
		if (i < split) {
			lo = 20 + (i / split) * (8000 - 20);
			hi = 20 + ((i + 1) / split) * (8000 - 20);
		} else {
			const j = i - split;
			const highBars = bars - split;
			lo = 8000 + (j / highBars) * (20000 - 8000);
			hi = 8000 + ((j + 1) / highBars) * (20000 - 8000);
		}
		return [lo, hi];
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

		function draw() {
			if (!canvas || !ctx) return;
			ctx.fillStyle = '#1a1a1a';
			ctx.fillRect(0, 0, w, h);
			const minBin = Math.max(0, hzToBin(freqMin));
			const maxBin = Math.min(binCount - 1, hzToBin(freqMax));
			for (let i = 0; i < bars; i++) {
				const [loHz, hiHz] = barFreqRange(i, bars);
				const binStart = Math.max(0, hzToBin(loHz));
				const binEnd = Math.min(binCount - 1, hzToBin(hiHz));
				let sum = 0;
				const count = Math.max(1, binEnd - binStart + 1);
				for (let b = binStart; b <= binEnd; b++) sum += data[b];
				const avg = sum / count / 255;
				const inRange = binEnd >= minBin && binStart <= maxBin;
				ctx.fillStyle = inRange
					? 'rgba(120, 180, 255, 0.8)'
					: 'rgba(80, 80, 80, 0.9)';
				const barH = Math.max(2, avg * h * 0.9);
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
