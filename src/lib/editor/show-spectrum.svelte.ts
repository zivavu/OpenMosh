import { DEFAULT_SETTINGS, loadSettings } from "./settings";

let shown = $state<boolean>(
	loadSettings().showSpectrum ?? DEFAULT_SETTINGS.showSpectrum,
);

/** Whether audio links draw their live spectrum. One switch for every panel,
 * read straight by the link row. Persisted as `showSpectrum` by settings. */
export const showSpectrum = {
	get value(): boolean {
		return shown;
	},
	set value(v: boolean) {
		shown = v;
	},
};
