/** Build something whose constructor runs `$effect`, which needs a root to run in. */
export function inEffectRoot<T>(make: () => T): {
	value: T;
	dispose: () => void;
} {
	let value!: T;
	const dispose = $effect.root(() => {
		value = make();
	});
	return { value, dispose };
}
