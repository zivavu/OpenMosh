/** Presentation helpers shared by the sequence media pool's grid view and rail. */

import { sourcePlayLength, type SourceEdit } from "../media/source-edit";

/** dataTransfer type marking a drag that carries a source id. The timeline and the
 * preview accept drops by this type, so a drag can start in the grid without shared state. */
export const SOURCE_DND_TYPE = "application/x-openmosh-source";

/** The least a drop from the pool lays down; a shorter video loops to fill it. */
const DROPPED_CLIP_LENGTH = 20;

/** How long a clip dropped from the pool wants to be, before the lane's room trims it. */
export function droppedClipLength(
	source: { duration?: number },
	edit: SourceEdit | undefined,
): number {
	return Math.max(
		DROPPED_CLIP_LENGTH,
		sourcePlayLength(edit, source.duration ?? 0),
	);
}

/** A stable colour per position in the pool. */
export function sourceColor(n: number): string {
	return `hsl(${(n * 57) % 360} 45% 52%)`;
}

/** Filenames from one export batch share a long prefix, so keep the tail (and the
 * extension) rather than truncating from the right. */
export function shortSourceName(name: string, max = 16): string {
	if (name.length <= max) return name;
	const dot = name.lastIndexOf(".");
	const ext = dot > 0 && name.length - dot <= 5 ? name.slice(dot) : "";
	const stem = ext ? name.slice(0, dot) : name;
	// A slice(0) would return the whole stem, so never let the budget hit 0.
	const keep = Math.max(1, max - ext.length - 1);
	return `…${stem.slice(-keep)}${ext}`;
}
