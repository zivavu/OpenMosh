/** Export settings remembered per project (fps, silent-take length, output size are
 * choices about one piece of work). Keyed like each mode's saved work, prefix apart. */

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

/** Merge a patch into a project's entry: modes write different subsets, so replacing
 * would have each control clearing the others. */
export function saveRenderSettings(
	key: string | null | undefined,
	patch: RenderSettings,
): void {
	if (!key) return;
	store.save(key, { ...(loadRenderSettings(key) ?? {}), ...patch });
}
