import type { FreqBand } from "../effects";
import { DEFAULT_SETTINGS, loadSettings } from "./settings";

let band = $state<FreqBand>(
	loadSettings().moshLinkBand ?? DEFAULT_SETTINGS.moshLinkBand,
);

/** The one band every new link starts on — the last one picked anywhere, be
 * it a link's Freq row in any panel or the "Random audio links" setting.
 * Persisted as `moshLinkBand` by the editor's settings effect. */
export const linkBand = {
	get value(): FreqBand {
		return band;
	},
	set value(v: FreqBand) {
		band = v;
	},
};
