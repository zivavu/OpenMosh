/** What the Music Lab page needs from a visual, so several can share its transport,
 * lanes and knob panel. */

import type { Colors } from "../../src/lib/generators/palette";
import type { SongAudio } from "./listen";

export interface LabKnob {
	key: string;
	label: string;
	group: string;
	min: number;
	max: number;
	step: number;
	value: number;
}

export interface VisualSettings {
	seed: number;
	palette: string;
	values: Record<string, number>;
}

/** What the strip under the picture shows. */
export interface StripView {
	frames: number;
	lanes: [Float32Array, string][];
	cuts: number[];
}

export interface VisualRun {
	/** Reads the song into the visual's table; quick enough to rerun as a knob moves. */
	build(song: SongAudio, settings: VisualSettings): void;
	/** Opaque onto the canvas. */
	draw(t: number, settings: VisualSettings, w: number, h: number): void;
	strip(): StripView | null;
	hud(): string;
}

export interface MusicVisual {
	id: string;
	name: string;
	/** Knob groups in panel order, with their headings. */
	groups: [string, string][];
	knobs: readonly LabKnob[];
	palettes: Record<string, Colors>;
	defaultPalette: string;
	/** Moving one of these rebuilds the table. */
	tableKnobs: readonly string[];
	/** Compiles every shader, so a bad one fails at load and not mid-song. */
	start(gl: WebGL2RenderingContext): VisualRun;
}
