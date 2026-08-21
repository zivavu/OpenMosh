<script lang="ts">
	import {
		autoRangeLevel,
		DEFAULT_AUDIO_RESPONSE,
		dropAutoRangeScope,
		followerTaus,
		punchExponent,
		smoothBandLevel,
		type AudioResponse,
	} from '../../audio/auto-range';
	import { getLevelFromFrequencyRange } from '../../audio/audio-utils';
	import { FREQ_PRESETS, generateId } from '../../effects/types';

	interface Props {
		data: Uint8Array;
		sampleRate: number;
		binCount: number;
		freqMin: number;
		freqMax: number;
		/** The response this link is modulated through. Drives both how fast the
		 * bars move and the level read-out, so the display shows what the
		 * parameter actually rides rather than a generic spectrum. */
		response?: AudioResponse;
		width?: number;
		height?: number;
	}

	let {
		data,
		sampleRate,
		binCount,
		freqMin,
		freqMax,
		response = DEFAULT_AUDIO_RESPONSE,
		width = 200,
		height = 48,
	}: Props = $props();

	let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);

	// Capped at 16 kHz like the presets — above it is MP3/AAC lowpass dead zone.
	const AXIS_MIN_HZ = FREQ_PRESETS.full.min;
	const AXIS_MAX_HZ = FREQ_PRESETS.full.max;

	/**
	 * Envelope state for the read-out lives in the same keyed store the real
	 * modulation uses, under a scope of this display's own so it never steps the
	 * band a parameter is actually riding. Dropped on unmount.
	 */
	const previewScope = `spectrum-preview-${generateId()}`;

	function hzToBin(hz: number): number {
		return (hz / sampleRate) * binCount * 2;
	}

	/** Log axis: constant ratio per bar, so every octave gets equal width. */
	function barFreq(t: number): number {
		return AXIS_MIN_HZ * (AXIS_MAX_HZ / AXIS_MIN_HZ) ** t;
	}

	/** Inverse of barFreq, for placing the selected band on the axis. */
	function freqToX(hz: number, w: number): number {
		const t =
			Math.log(Math.max(hz, AXIS_MIN_HZ) / AXIS_MIN_HZ) /
			Math.log(AXIS_MAX_HZ / AXIS_MIN_HZ);
		return Math.max(0, Math.min(1, t)) * w;
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

	/**
	 * The number the linked parameter is riding this frame: band mean, envelope
	 * followed, auto-ranged, then shaped by Punch — the same chain and the same
	 * order `applyVolumeLinksToEffects` runs. Inversion is deliberately left
	 * off; it mirrors the same curve and showing it flipped would only make the
	 * display harder to read against the spectrum under it.
	 */
	function modulationLevel(dt: number): number {
		if (!sampleRate || !data.length) return 0;
		const key = `${previewScope}|${freqMin}:${freqMax}`;
		const measured = getLevelFromFrequencyRange(
			data,
			sampleRate,
			binCount * 2,
			freqMin,
			freqMax,
		);
		const smoothed = smoothBandLevel(key, measured, dt, response.smoothing);
		return autoRangeLevel(key, smoothed, dt) ** punchExponent(response.punch);
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
		// The analyser hands out raw bins (its smoothing moved into the shared
		// band level, so exports get it too), so the bars are damped here — on
		// the same asymmetric curve the band follower uses, so moving Smoothing
		// visibly changes how the display responds too.
		const shown = new Float32Array(bars);
		let lastFrame = performance.now();

		function draw() {
			if (!canvas || !ctx) return;
			const now = performance.now();
			const dt = Math.min((now - lastFrame) / 1000, 0.25);
			lastFrame = now;
			const { attack, release } = followerTaus(response.smoothing);
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
				const tau = peak > shown[i] ? attack : release;
				shown[i] += (peak - shown[i]) * (1 - Math.exp(-dt / tau));
				const level = shown[i] / 255;
				const inRange = hiHz >= freqMin && loHz <= freqMax;
				ctx.fillStyle = inRange
					? 'rgba(120, 180, 255, 0.8)'
					: 'rgba(80, 80, 80, 0.9)';
				const barH = Math.max(2, level * h * 0.9);
				ctx.fillRect(i * barW, h - barH, barW - 1, barH);
			}

			// The modulation read-out, over the band it is measured from. Drawn
			// last so it reads on top of the spectrum rather than behind it.
			const x0 = freqToX(freqMin, w);
			const x1 = freqToX(freqMax, w);
			const y = h - modulationLevel(dt) * h * 0.9;
			ctx.fillStyle = 'rgba(110, 231, 192, 0.16)';
			ctx.fillRect(x0, y, Math.max(1, x1 - x0), h - y);
			ctx.fillStyle = '#6ee7c0';
			ctx.fillRect(x0, Math.min(h - 2, y - 1), Math.max(1, x1 - x0), 2);

			rafId = requestAnimationFrame(draw);
		}
		rafId = requestAnimationFrame(draw);
		return () => cancelAnimationFrame(rafId);
	});

	$effect(() => () => dropAutoRangeScope(previewScope));
</script>

<canvas
	bind:this={canvasEl}
	class="spectrum-canvas"
	{width}
	{height}
	aria-label="Frequency spectrum and modulation level"
></canvas>

<style>
	.spectrum-canvas {
		display: block;
		border-radius: 4px;
		background: var(--surface);
	}
</style>
