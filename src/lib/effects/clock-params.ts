import type { EffectParam } from "./types";

export const SYNC_KEY = "sync";

/** The tempo a free rate is weighed against when offering beat divisions. */
const REFERENCE_BEATS_PER_SECOND = 2;
/** Divisions past 8 per beat, offered where the free rate can go that fast too. */
const FAST_DIVISIONS = [16, 32];

/** A clock the renderer can run free or off the song grid; a division is cycles per beat. */
export function clockParams(
	label: string,
	speed: {
		min: number;
		max: number;
		step: number;
		defaultValue: number;
		moshMax?: number;
	},
	unit = "cycle",
	plural = `${unit}s`,
): EffectParam[] {
	const fastest = speed.max / REFERENCE_BEATS_PER_SECOND;
	const fast = FAST_DIVISIONS.filter((n) => n <= fastest).map((n) => ({
		label: `${n} ${plural} / beat`,
		value: String(n),
	}));
	return [
		{
			key: SYNC_KEY,
			label: "Sync",
			type: "select",
			defaultValue: "free",
			options: [
				{ label: "Free", value: "free" },
				{ label: "Beat", value: "beat" },
			],
		},
		{
			key: "speed",
			label,
			type: "range",
			...speed,
			visibleWhen: (v) => v.sync !== "beat",
		},
		{
			key: "division",
			label: "Division",
			type: "select",
			defaultValue: "1",
			options: [
				{ label: `1 ${unit} / 4 beats`, value: "0.25" },
				{ label: `1 ${unit} / 2 beats`, value: "0.5" },
				{ label: `1 ${unit} / beat`, value: "1" },
				{ label: `2 ${plural} / beat`, value: "2" },
				{ label: `3 ${plural} / beat`, value: "3" },
				{ label: `4 ${plural} / beat`, value: "4" },
				{ label: `8 ${plural} / beat`, value: "8" },
				...fast,
			],
			visibleWhen: (v) => v.sync === "beat",
		},
	];
}
