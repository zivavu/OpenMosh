import type { FreqBand } from "../effects";
import { DEFAULT_SETTINGS, loadSettings } from "./settings";

let band = $state<FreqBand>(
	loadSettings().moshLinkBand ?? DEFAULT_SETTINGS.moshLinkBand,
);

/** The band every new link starts on: the last one picked anywhere, be it a
 * link's Freq row or the "Random audio links" setting. Persisted as `moshLinkBand`. */
export const linkBand = {
	get value(): FreqBand {
		return band;
	},
	set value(v: FreqBand) {
		band = v;
	},
};
