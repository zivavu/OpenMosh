import { describe, expect, test } from "bun:test";
import { FREQ_PRESETS, type EffectInstance, type VolumeLink } from "./types";
import { bandOfLink, setAllLinkBands, sharedLinkBand } from "./link-bands";

function effect(volumeLinks?: Record<string, VolumeLink>): EffectInstance {
	return {
		instanceId: "x",
		defId: "x",
		enabled: true,
		locked: false,
		expanded: false,
		values: {},
		volumeLinks,
	};
}

const low = { min: 0, max: 1, ...pick("low") };
const custom = { min: 0, max: 1, freqMin: 120, freqMax: 900 };

function pick(band: "low" | "mid" | "high") {
	return { freqMin: FREQ_PRESETS[band].min, freqMax: FREQ_PRESETS[band].max };
}

describe("link bands", () => {
	test("reads a link's band", () => {
		expect(bandOfLink({ min: 0, max: 1 })).toBe("full");
		expect(bandOfLink(low)).toBe("low");
		expect(bandOfLink(custom)).toBeNull();
	});

	test("rewrites every link and keeps its range and inversion", () => {
		const chain = [
			effect({ a: { ...low, inverted: true }, b: custom }),
			effect(),
			effect({ c: { min: 0.2, max: 0.8 } }),
		];
		const next = setAllLinkBands(chain, "high");
		expect(next[0].volumeLinks).toEqual({
			a: { min: 0, max: 1, inverted: true, ...pick("high") },
			b: { min: 0, max: 1, ...pick("high") },
		});
		expect(next[1]).toBe(chain[1]);
		expect(next[2].volumeLinks?.c).toEqual({
			min: 0.2,
			max: 0.8,
			...pick("high"),
		});
		expect(sharedLinkBand(next)).toBe("high");
	});

	test("full drops the stored band", () => {
		const next = setAllLinkBands([effect({ a: low })], "full");
		expect(next[0].volumeLinks?.a).toEqual({ min: 0, max: 1 });
	});

	test("mixed or no links share no band", () => {
		expect(sharedLinkBand([effect({ a: low, b: custom })])).toBeNull();
		expect(sharedLinkBand([effect()])).toBeNull();
	});
});
