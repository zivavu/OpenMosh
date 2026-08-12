import { DEFAULT_AUTO_RANGE_AMOUNT } from "../audio/auto-range";

const SETTINGS_KEY = "openmosh-settings";

export interface EditorSettings {
	moshMin: number;
	moshMax: number;
	randomizeOrder: boolean;
	moshAudioLink: boolean;
	moshAudioLinkStrength: number;
	/** 0 = raw band level, 1 = fully auto-ranged. Applies to every volume link. */
	autoRangeAmount: number;
	showFps: boolean;
	outputVolume: number;
	loopAudio: boolean;
	loopVideo: boolean;
	/** How sequence sources that don't match the output aspect are fitted. */
	sourceFit: "stretch" | "contain" | "cover";
}

/** What a fresh editor starts from, and what double-clicking a control restores. */
export const DEFAULT_SETTINGS: EditorSettings = {
	moshMin: 3,
	moshMax: 6,
	randomizeOrder: true,
	moshAudioLink: true,
	moshAudioLinkStrength: 0.8,
	autoRangeAmount: DEFAULT_AUTO_RANGE_AMOUNT,
	showFps: false,
	outputVolume: 1,
	loopAudio: false,
	loopVideo: true,
	// Only bites with a mixed media pool; "contain" never crops the user's media.
	sourceFit: "contain",
};

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
