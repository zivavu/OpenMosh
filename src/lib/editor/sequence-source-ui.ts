/**
 * Presentation helpers shared by everything that shows the sequence media pool
 * — the grid view and the segment blocks that tag which source they play.
 */

/**
 * dataTransfer type marking a drag that carries a source id. The timeline
 * accepts drops by looking for this type, so a drag can start in the grid
 * without the two components sharing any state.
 */
export const SOURCE_DND_TYPE = "application/x-openmosh-source";

/** A stable colour per position in the pool. */
export function sourceColor(n: number): string {
  return `hsl(${(n * 57) % 360} 45% 52%)`;
}

/**
 * Filenames from one export batch share a long prefix, so keep the tail (and
 * the extension) rather than truncating from the right.
 */
export function shortSourceName(name: string, max = 16): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 5 ? name.slice(dot) : "";
  const stem = ext ? name.slice(0, dot) : name;
  // A slice(0) would return the whole stem, so never let the budget hit 0.
  const keep = Math.max(1, max - ext.length - 1);
  return `…${stem.slice(-keep)}${ext}`;
}
