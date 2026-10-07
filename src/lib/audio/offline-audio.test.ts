import { describe, expect, test } from "bun:test";
import { analyzeFrames, FFT_SIZE } from "./offline-audio";

function sineBuffer(hz: number, sampleRate = 48000): AudioBuffer {
	const pcm = new Float32Array(sampleRate);
	for (let i = 0; i < pcm.length; i++) {
		pcm[i] = 0.05 * Math.sin((2 * Math.PI * hz * i) / sampleRate);
	}
	return {
		numberOfChannels: 1,
		sampleRate,
		length: pcm.length,
		getChannelData: () => pcm,
	} as unknown as AudioBuffer;
}

describe("analyzeFrames", () => {
	test("a pure tone peaks at its own bin and leaves the far bins silent", async () => {
		for (const hz of [100, 1000, 8000]) {
			const [frame] = await analyzeFrames(sineBuffer(hz), [0.5]);
			const bins = frame.frequencyData;
			const expected = Math.round(hz / (48000 / FFT_SIZE));
			const peak = bins.indexOf(Math.max(...bins));
			expect(Math.abs(peak - expected)).toBeLessThanOrEqual(1);
			const far = expected > bins.length / 2 ? 10 : bins.length - 10;
			expect(bins[far]).toBe(0);
		}
	});
});
