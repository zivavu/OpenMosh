import { DEFAULT_SETTINGS, loadSettings } from "./settings";

let on = $state<boolean>(
	loadSettings().layerHighlight ?? DEFAULT_SETTINGS.layerHighlight,
);

/** Whether selecting a layer in the editor traces its edge on the preview. Read
 * straight by the canvas. Persisted as `layerHighlight` by settings. */
export const layerHighlight = {
	get value(): boolean {
		return on;
	},
	set value(v: boolean) {
		on = v;
	},
};
