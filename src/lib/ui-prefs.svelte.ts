import {
	DEFAULT_SETTINGS,
	loadSettings,
	updateSettings,
} from "./editor/settings";

let numberInputs = $state<boolean>(
	loadSettings().numberInputs ?? DEFAULT_SETTINGS.numberInputs,
);

/** How the app looks and takes input, the same in every mode. */
export const uiPrefs = {
	get numberInputs(): boolean {
		return numberInputs;
	},
	set numberInputs(on: boolean) {
		numberInputs = on;
		updateSettings({ numberInputs: on });
	},
};
