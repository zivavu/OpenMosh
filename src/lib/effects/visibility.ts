import type { EffectInstance, EffectParam } from "./types";

/** A param linked to music is judged at both ends of its link range rather
 * than its live value, so rows that depend on it don't flicker with the beat. */
export function isParamVisible(
	param: EffectParam,
	effect: Pick<EffectInstance, "values" | "volumeLinks">,
): boolean {
	if (!param.visibleWhen) return true;
	const links = Object.entries(effect.volumeLinks ?? {});
	if (links.length === 0) return param.visibleWhen(effect.values);
	return (["min", "max"] as const).some((end) =>
		param.visibleWhen!({
			...effect.values,
			...Object.fromEntries(links.map(([key, link]) => [key, link[end]])),
		}),
	);
}
