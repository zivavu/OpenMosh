/** What a load had to leave behind: effects this build doesn't have and settings that
 * no longer fit, collected across one load and handed to whoever shows them. */

export interface LoadLosses {
	/** Names of effects this build doesn't have: removed, or from a newer one. */
	effects: string[];
	/** "Effect: Param" for values outside what the param takes now. */
	settings: string[];
}

/** One load restores several chains over a few ticks; they arrive as one report. */
const SETTLE_MS = 250;

/** Effects that were removed, by the name they had, so a save can say what's gone. */
const RETIRED_NAMES: Record<string, string> = {
	ascii: "ASCII",
	"brightness-contrast": "Brightness & Contrast",
	"chromatic-aberration": "Chromatic Aberration",
	"color-melt": "Color Melt",
	crt: "CRT",
	echo: "Echo",
	fractalize: "Fractalize",
	"hard-glitch": "Hard Glitch",
	"hue-saturation": "Hue & Saturation",
	"luma-mesh": "Luma Mesh",
	polar: "Polar",
	"rgb-shift": "RGB Shift",
	shatter: "Shatter",
	"spectral-shift": "Spectral Shift",
};

export function retiredEffectName(defId: string): string {
	return (
		RETIRED_NAMES[defId] ??
		defId
			.split(/[-_]/)
			.filter(Boolean)
			.map((w) => w[0].toUpperCase() + w.slice(1))
			.join(" ")
	);
}

let listener: ((losses: LoadLosses) => void) | null = null;
let effects = new Set<string>();
let settings = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** Only one listener, the app shell; without one, losses are dropped. */
export function onLoadLosses(fn: (losses: LoadLosses) => void): () => void {
	listener = fn;
	return () => {
		if (listener === fn) listener = null;
	};
}

function schedule() {
	clearTimeout(timer);
	timer = setTimeout(() => {
		const losses = { effects: [...effects], settings: [...settings] };
		effects = new Set();
		settings = new Set();
		listener?.(losses);
	}, SETTLE_MS);
}

export function reportRemovedEffect(defId: string) {
	if (!listener) return;
	effects.add(retiredEffectName(defId));
	schedule();
}

export function reportResetSetting(effectName: string, paramLabel: string) {
	if (!listener) return;
	settings.add(`${effectName}: ${paramLabel}`);
	schedule();
}
