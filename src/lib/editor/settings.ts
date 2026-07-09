const SETTINGS_KEY = "openmosh-settings";

export interface EditorSettings {
	moshMin: number;
	moshMax: number;
	randomizeOrder: boolean;
	moshAudioLink: boolean;
	moshAudioLinkStrength: number;
	showFps: boolean;
	outputVolume: number;
	loopAudio: boolean;
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

/** Merge a partial update into the stored settings without clobbering the rest. */
export function updateSettings(patch: Partial<EditorSettings>) {
	localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
}
