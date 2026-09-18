/** In-place Fisher-Yates shuffle. Returns the array for convenience. */
export function shuffleInPlace<T>(arr: T[]): T[] {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

/** "just now", "5m ago", "3h ago", "12d ago", then a plain date. */
export function fmtAgo(t: number): string {
	if (!t) return "";
	const s = Math.max(0, (Date.now() - t) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
	return new Date(t).toLocaleDateString();
}
