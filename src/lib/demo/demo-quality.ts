/** Whether this device keeps the 3D demo smooth, measured on its drawn frames. */

import { loadSettings, updateSettings } from "../editor/settings";

export const MIN_FPS = 40;
/** Skipped first: the opening frames pay for texture and program setup. */
const WARMUP_SECONDS = 0.5;
const SAMPLE_SECONDS = 2;
/** A frame this long is a hitch (GC, a tab switch), not the steady rate. */
const HITCH_SECONDS = 0.25;
/** How long a slow verdict holds before the 3D worlds get another try. */
const FLAT_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export type DemoVerdict = "smooth" | "slow";

export interface FpsProbe {
	/** Feeds one drawn frame's delta; the verdict once the sample is in. */
	frame(deltaSeconds: number): DemoVerdict | null;
}

export function createFpsProbe(minFps = MIN_FPS): FpsProbe {
	let warm = 0;
	let time = 0;
	let frames = 0;
	return {
		frame(dt) {
			if (dt <= 0 || dt > HITCH_SECONDS) return null;
			if (warm < WARMUP_SECONDS) {
				warm += dt;
				return null;
			}
			time += dt;
			frames++;
			if (time < SAMPLE_SECONDS) return null;
			return frames / time >= minFps ? "smooth" : "slow";
		},
	};
}

/** True on touch devices, and while an earlier visit measured this device too
 * slow for the 3D worlds. */
export function demoStartsFlat(now = Date.now()): boolean {
	if (window.matchMedia("(pointer: coarse)").matches) return true;
	const at = loadSettings().demoSlowAt ?? 0;
	return at > 0 && now - at < FLAT_FOR_MS;
}

export function rememberDemoSlow() {
	updateSettings({ demoSlowAt: Date.now() });
}
