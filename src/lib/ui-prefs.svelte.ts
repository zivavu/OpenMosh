import {
	DEFAULT_SETTINGS,
	loadSettings,
	updateSettings,
} from "./editor/settings";

let numberInputs = $state<boolean>(
	loadSettings().numberInputs ?? DEFAULT_SETTINGS.numberInputs,
);
let highContrast = $state<boolean>(
	loadSettings().highContrast ?? DEFAULT_SETTINGS.highContrast,
);

let previewProxies = $state<boolean>(
	loadSettings().previewProxies ?? DEFAULT_SETTINGS.previewProxies,
);

let showSpectrum = $state<boolean>(
	loadSettings().showSpectrum ?? DEFAULT_SETTINGS.showSpectrum,
);

let showFps = $state<boolean>(
	loadSettings().showFps ?? DEFAULT_SETTINGS.showFps,
);

let layerHighlight = $state<boolean>(
	loadSettings().layerHighlight ?? DEFAULT_SETTINGS.layerHighlight,
);

function applyContrast() {
	if (highContrast) document.documentElement.dataset.contrast = "high";
	else delete document.documentElement.dataset.contrast;
}

/** Runs before the first paint, so a saved choice never flashes the default colors. */
export function applyUiPrefs() {
	applyContrast();
}

/** How the app looks and takes input, the same in every mode. */
export const uiPrefs = {
	get numberInputs(): boolean {
		return numberInputs;
	},
	set numberInputs(on: boolean) {
		numberInputs = on;
		updateSettings({ numberInputs: on });
	},
	get highContrast(): boolean {
		return highContrast;
	},
	set highContrast(on: boolean) {
		highContrast = on;
		applyContrast();
		updateSettings({ highContrast: on });
	},
	get previewProxies(): boolean {
		return previewProxies;
	},
	/** Saved before the editors' effects refresh, which read it from settings. */
	set previewProxies(on: boolean) {
		previewProxies = on;
		updateSettings({ previewProxies: on });
	},
	get showSpectrum(): boolean {
		return showSpectrum;
	},
	set showSpectrum(on: boolean) {
		showSpectrum = on;
		updateSettings({ showSpectrum: on });
	},
	get showFps(): boolean {
		return showFps;
	},
	set showFps(on: boolean) {
		showFps = on;
		updateSettings({ showFps: on });
	},
	/** Whether selecting a layer in the editor traces its edge on the preview. */
	get layerHighlight(): boolean {
		return layerHighlight;
	},
	set layerHighlight(on: boolean) {
		layerHighlight = on;
		updateSettings({ layerHighlight: on });
	},
};
