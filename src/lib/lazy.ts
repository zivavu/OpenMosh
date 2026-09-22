/**
 * Defer a component's chunk until something renders it. The promise is cached,
 * so `{#await load() then C}` reuses the resolved component across re-renders.
 * A failed load is forgotten, so the next render retries it.
 */
export function lazy<T>(load: () => Promise<{ default: T }>): () => Promise<T> {
	let pending: Promise<T> | null = null;
	return () =>
		(pending ??= load().then(
			(m) => m.default,
			(err: unknown) => {
				pending = null;
				throw err;
			},
		));
}
