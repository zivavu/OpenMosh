import {
	FREQ_PRESETS,
	type EffectInstance,
	type FreqBand,
	type VolumeLink,
} from "./types";

const BANDS = Object.keys(FREQ_PRESETS) as FreqBand[];

export const FREQ_BAND_OPTIONS = [
	{ id: "full", label: "Full", title: "Full spectrum (20–16k Hz)" },
	{ id: "low", label: "Low", title: "Low (20–500 Hz)" },
	{ id: "mid", label: "Mid", title: "Mid (500–4000 Hz)" },
	{ id: "high", label: "High", title: "High (4k–16k Hz)" },
] as const satisfies { id: FreqBand; label: string; title: string }[];

/** Null for a hand-dragged range. Full stores no band on the link. */
export function bandOfLink(link: VolumeLink): FreqBand | null {
	if (link.freqMin == null && link.freqMax == null) return "full";
	return (
		BANDS.find(
			(b) =>
				b !== "full" &&
				FREQ_PRESETS[b].min === link.freqMin &&
				FREQ_PRESETS[b].max === link.freqMax,
		) ?? null
	);
}

export function withBand(link: VolumeLink, band: FreqBand): VolumeLink {
	const { freqMin: _min, freqMax: _max, ...rest } = link;
	if (band === "full") return rest;
	return {
		...rest,
		freqMin: FREQ_PRESETS[band].min,
		freqMax: FREQ_PRESETS[band].max,
	};
}

/** The band every link in the chain shares; null when none are linked or they differ. */
export function sharedLinkBand(effects: EffectInstance[]): FreqBand | null {
	const bands = new Set(
		effects.flatMap((e) => Object.values(e.volumeLinks ?? {}).map(bandOfLink)),
	);
	return bands.size === 1 ? [...bands][0] : null;
}

export function hasVolumeLinks(effects: EffectInstance[]): boolean {
	return effects.some((e) => Object.keys(e.volumeLinks ?? {}).length > 0);
}

export function setAllLinkBands(
	effects: EffectInstance[],
	band: FreqBand,
): EffectInstance[] {
	return effects.map((e) =>
		e.volumeLinks && Object.keys(e.volumeLinks).length > 0
			? {
					...e,
					volumeLinks: Object.fromEntries(
						Object.entries(e.volumeLinks).map(([key, link]) => [
							key,
							withBand(link, band),
						]),
					),
				}
			: e,
	);
}
