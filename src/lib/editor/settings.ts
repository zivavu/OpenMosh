import { DEFAULT_AUDIO_RESPONSE } from "../audio/auto-range";
import type { FreqBand } from "../effects";

const SETTINGS_KEY = "openmosh-settings";

/** The three ways in from the upload screen. */
export type UploadMode = "single" | "sequence" | "slideshow";

export interface EditorSettings {
	/** Which mode the app was last launched in, so it opens on it again. */
	lastMode: UploadMode;
	moshMin: number;
	moshMax: number;
	randomizeOrder: boolean;
	moshAudioLink: boolean;
	moshAudioLinkStrength: number;
	/** Band the links a mosh rolls listen to. */
	moshLinkBand: FreqBand;
	/** 0 = raw band level, 1 = fully auto-ranged. Applies to every volume link. */
	autoRangeAmount: number;
	/** 0 = the level snaps to the signal, 1 = it glides. Sets the follower's release. */
	audioSmoothing: number;
	/** Response curve of a linked param: low lifts quiet detail, high keeps only hits. */
	audioPunch: number;
	showFps: boolean;
	outputVolume: number;
	loopAudio: boolean;
	loopVideo: boolean;
	/** How sequence sources that don't match the output aspect are fitted. */
	sourceFit: "stretch" | "contain" | "cover";
	/** Whether the upload screen's demo keeps moshing behind the UI. */
	demoBackground: boolean;
}

/** What a fresh editor starts from, and what double-clicking a control restores. */
export const DEFAULT_SETTINGS: EditorSettings = {
	lastMode: "single",
	moshMin: 3,
	moshMax: 6,
	randomizeOrder: true,
	moshAudioLink: true,
	moshAudioLinkStrength: 0.8,
	moshLinkBand: "full",
	autoRangeAmount: DEFAULT_AUDIO_RESPONSE.autoRange,
	audioSmoothing: DEFAULT_AUDIO_RESPONSE.smoothing,
	audioPunch: DEFAULT_AUDIO_RESPONSE.punch,
	showFps: false,
	outputVolume: 1,
	loopAudio: false,
	loopVideo: true,
	// Only bites with a mixed media pool; "contain" never crops the user's media.
	sourceFit: "contain",
	demoBackground: true,
};

export function loadSettings(): Partial<EditorSettings> {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (raw) return JSON.parse(raw);
	} catch {}
	return {};
}

/** Whether the upload screen's live demo is switched on. Read by both the demo
 * itself and the wordmark that glitches along with it. */
export function demoBackgroundEnabled(): boolean {
	return loadSettings().demoBackground ?? DEFAULT_SETTINGS.demoBackground;
}

/** Merge a partial update into the stored settings without clobbering the rest. */
export function updateSettings(patch: Partial<EditorSettings>) {
	localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
}
