/** How a slider's value reads in a typed field, matching its read-out beside the track. */
export interface FieldDisplay {
	toField(value: number): number;
	fromField(typed: number): number;
	unit?: string;
}

const scaled = (factor: number, unit?: string): FieldDisplay => ({
	toField: (v) => v * factor,
	fromField: (n) => n / factor,
	unit,
});

export const percent = scaled(100, "%");
export const percentOf = (max: number) => scaled(100 / max, "%");
/** Positions stored as 0..1 that read as 0..100. */
export const hundredths = scaled(100);
export const seconds = scaled(1, "s");
export const degrees = scaled(1, "°");
/** Speed sliders run on log₂ of the factor. */
export const speedFactor: FieldDisplay = {
	toField: (v) => 2 ** v,
	fromField: (n) => Math.log2(n),
	unit: "×",
};

export interface FieldRange {
	min: number;
	max: number;
	step: number;
	display?: FieldDisplay;
}

/** Drops float noise: 0.07500000000000001 is 0.075. */
const clean = (n: number) => Math.round(n * 1e6) / 1e6;

const clamp = (n: number, { min, max }: FieldRange) =>
	Math.min(max, Math.max(min, n));

export function formatField(value: number, display?: FieldDisplay): string {
	const shown = display ? display.toField(value) : value;
	return String(+shown.toFixed(3));
}

/** The value a typed string means, or null when it means none. Finer than the slider's
 * step is the point of typing, except on whole-number sliders. */
export function parseField(raw: string, range: FieldRange): number | null {
	if (raw.trim() === "") return null;
	const typed = Number(raw);
	if (Number.isNaN(typed)) return null;
	const { step, display } = range;
	const value = display ? display.fromField(typed) : typed;
	if (Number.isNaN(value)) return null;
	const snapped =
		!display && step >= 1 ? Math.round(value / step) * step : value;
	return clean(clamp(snapped, range));
}

/** One arrow-key press, in the slider's own steps. */
export function stepField(
	value: number,
	direction: 1 | -1,
	coarse: boolean,
	range: FieldRange,
): number {
	const by = range.step * (coarse ? 10 : 1);
	return clean(clamp(value + direction * by, range));
}
