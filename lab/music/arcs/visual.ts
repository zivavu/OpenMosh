import type { MusicVisual, VisualSettings } from "../visual";
import { buildControls, type Controls } from "./controls";
import {
	ARCS_CONTROLS,
	ARCS_KNOBS,
	ARCS_PALETTES,
	arcsColors,
	arcsLook,
	DEFAULT_ARCS_PALETTE,
	TABLE_KNOBS,
	type ArcsSpec,
} from "./look";
import { ArcsPass } from "./pass";

const isControl = (key: string) => ARCS_CONTROLS.some((c) => c.key === key);

/** The lab's knobs split the way an Arcs clip keeps them: controls, and the tuning
 * behind their 50. */
function spec({ seed, palette, values }: VisualSettings): ArcsSpec {
	const entries = Object.entries(values);
	return {
		seed,
		palette,
		values: Object.fromEntries(entries.filter(([k]) => isControl(k))),
		tuning: Object.fromEntries(entries.filter(([k]) => !isControl(k))),
	};
}

export const ARCS_VISUAL: MusicVisual = {
	id: "arcs",
	name: "Arcs",
	groups: [
		["controls", "Controls (what users get)"],
		["structure", "Structure"],
		["stroke", "Stroke (arcDrawer's sliders)"],
		["music", "Music"],
		["listen", "Listening"],
	],
	knobs: [...ARCS_CONTROLS, ...ARCS_KNOBS],
	palettes: ARCS_PALETTES,
	defaultPalette: DEFAULT_ARCS_PALETTE,
	tableKnobs: TABLE_KNOBS,
	start(gl) {
		const pass = new ArcsPass(gl);
		pass.compile();
		let controls: Controls | null = null;
		return {
			build(song, settings) {
				controls = buildControls(song, arcsLook(spec(settings)));
			},
			draw(t, settings, w, h) {
				if (!controls) return;
				const s = spec(settings);
				pass.draw(controls, t, arcsLook(s), arcsColors(s), w, h, null);
			},
			strip: () =>
				controls && {
					frames: controls.frames,
					lanes: [
						[controls.bass, "#2a5fb0"],
						[controls.kick, "#7fc4ff"],
						[controls.high, "#ffb454"],
					],
					cuts: controls.cuts,
				},
			hud: () => `${pass.strokes} strokes`,
		};
	},
};
