import { keyGridOf, onGridWithin, type KeyGrid } from "../key-grid";
import { uiPrefs } from "../ui-prefs.svelte";

/** The editor's tempo, which the key grid follows. 0 BPM is no grid. */
const tempo = $state({ bpm: 0, beatOffset: 0 });

export function setKeyGridTempo(bpm: number, beatOffset: number) {
	tempo.bpm = bpm;
	tempo.beatOffset = beatOffset;
}

export function keyGridTempoKnown(): boolean {
	return tempo.bpm > 0;
}

/** The grid new and dragged keys land on, or null while it's off or there's no tempo. */
export function keyGrid(): KeyGrid | null {
	return uiPrefs.keyGrid
		? keyGridOf(tempo.bpm, tempo.beatOffset, uiPrefs.keyGridBeats)
		: null;
}

/** Where a key added at `at` lands: on the grid while it's on, inside `from`..`to`. */
export function snapToKeyGrid(at: number, from = 0, to = Infinity): number {
	const grid = keyGrid();
	return grid ? onGridWithin(at, grid, from, to) : at;
}
