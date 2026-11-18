/** A deep copy of state, as `$state.snapshot` makes one, without its cost on plain
 * data: Svelte runs every number and string through `structuredClone`, which a whole
 * project's worth of effect values makes the slowest part of an autosave or an undo
 * step. Arrays and plain objects are walked here, primitives kept as they are, and
 * anything else (a Date, a Blob, a toJSON) is left to the snapshot. Reads every
 * property it copies, so an effect calling it tracks the whole value, as before. */
export function plainCopy<T>(value: T): T {
	if (typeof value !== "object" || value === null) return value;
	if (Array.isArray(value)) return value.map(plainCopy) as T;
	if (Object.getPrototypeOf(value) !== Object.prototype)
		return $state.snapshot(value) as T;
	const source = value as Record<string, unknown>;
	const copy: Record<string, unknown> = {};
	for (const key of Object.keys(source)) copy[key] = plainCopy(source[key]);
	return copy as T;
}
