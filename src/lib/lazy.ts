/**
 * Defer a component's chunk until something renders it. The import promise is
 * cached, so `{#await load() then C}` reuses the resolved component instead of
 * re-entering its pending state on every re-render.
 */
export function lazy<T>(load: () => Promise<{ default: T }>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => (pending ??= load().then((m) => m.default));
}
