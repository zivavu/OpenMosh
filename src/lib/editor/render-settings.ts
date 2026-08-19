/**
 * Export settings, remembered per project.
 *
 * FPS, the silent-take length and the output size are choices made about one
 * piece of work — a 24 fps square export of one song has nothing to say about
 * the next — so they're stored against the project rather than globally.
 *
 * Keyed exactly the way each mode already keys its saved work: single and
 * sequence pass the mode-prefixed song/media key they store timelines under,
 * slideshow its own track key. The prefix is what keeps the three apart, since
 * the same song can be open in all of them.
 */

import { createTrackStore } from "../audio/track-persistence";

export interface RenderSettings {
	fps?: number;
	/** Export length for a take with no clock of its own (no track, no video). */
	duration?: number;
	width?: number;
	height?: number;
}

const store = createTrackStore<RenderSettings>("openmosh-render-settings");

export function loadRenderSettings(
	key: string | null | undefined,
): RenderSettings | null {
	if (!key) return null;
	const raw = store.load(key);
	return raw && typeof raw === "object" ? raw : null;
}

/**
 * Merge a patch into a project's entry. Merged rather than replaced because the
 * modes write different subsets — single mode only knows a duration while
 * nothing else sets the clock, and dropping the rest on every write would have
 * each control clearing the others.
 */
export function saveRenderSettings(
	key: string | null | undefined,
	patch: RenderSettings,
): void {
	if (!key) return;
	store.save(key, { ...(loadRenderSettings(key) ?? {}), ...patch });
}
