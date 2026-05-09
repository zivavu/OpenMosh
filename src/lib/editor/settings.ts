const SETTINGS_KEY = "openmosh-settings";

export interface EditorSettings {
	moshMin: number;
	moshMax: number;
	randomizeOrder: boolean;
	moshAudioLink: boolean;
	moshAudioLinkStrength: number;
	showFps: boolean;
	outputVolume: number;
}

export function loadSettings(): Partial<EditorSettings> {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (raw) return JSON.parse(raw);
	} catch {}
	return {};
}

export function saveSettings(settings: EditorSettings) {
	localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
