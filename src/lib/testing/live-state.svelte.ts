/** `value` as deep `$state`, for a test that needs the proxies the app hands around. */
export function liveState<T>(value: T): T {
	const live = $state(value);
	return live;
}
