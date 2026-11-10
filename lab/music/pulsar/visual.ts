import { PROFILE_FPS } from "../../../src/lib/audio/song-profile";
import type { MusicVisual } from "../visual";
import {
	DEFAULT_PULSAR_PALETTE,
	PULSAR_KNOBS,
	PULSAR_PALETTES,
	PULSAR_TABLE_KNOBS,
	pulsarLook,
} from "./look";
import { PulsarPass } from "./pass";
import { buildPulsarTable, samplePulsar, type PulsarTable } from "./table";

const MODE_NAMES = ["dark", "ink", "blue field"];

export const PULSAR_VISUAL: MusicVisual = {
	id: "pulsar",
	name: "Pulsar",
	groups: [
		["shape", "Shape"],
		["music", "Music"],
		["feedback", "Feedback"],
		["post", "Post"],
		["listen", "Listening"],
	],
	knobs: PULSAR_KNOBS,
	palettes: PULSAR_PALETTES,
	defaultPalette: DEFAULT_PULSAR_PALETTE,
	tableKnobs: PULSAR_TABLE_KNOBS,
	start(gl) {
		const pass = new PulsarPass(gl);
		pass.compile();
		let table: PulsarTable | null = null;
		let lastT = 0;
		return {
			build(song, { seed, values }) {
				table = buildPulsarTable(song, pulsarLook(seed, values));
			},
			draw(t, { seed, palette, values }, w, h) {
				if (!table) return;
				lastT = t;
				const colors =
					PULSAR_PALETTES[palette] ?? PULSAR_PALETTES[DEFAULT_PULSAR_PALETTE];
				pass.draw(table, t, pulsarLook(seed, values), colors, w, h);
			},
			strip: () =>
				table && {
					frames: table.frames,
					lanes: [
						[table.bass, "#2a5fb0"],
						[table.kick, "#7fc4ff"],
						[table.high, "#ffb454"],
					],
					cuts: table.cuts,
				},
			hud() {
				if (!pass.supported) return "no float render targets: nothing drawn";
				if (!table) return "";
				const m = samplePulsar(table, lastT);
				const section = table.section[Math.floor(lastT * PROFILE_FPS)] ?? 0;
				return `${pass.steps} feedback steps · section ${section} · ${MODE_NAMES[m.mode]}`;
			},
		};
	},
};
