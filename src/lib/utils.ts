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

export function downloadFile(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	// Revoked late: Safari reads the blob only once its "allow downloads" prompt is
	// answered, and a big file takes a while; a revoked URL fails the download.
	setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Whether two blobs hold the same bytes; read a slice at a time, since a pool video
 * can run to gigabytes. */
export async function sameBytes(a: Blob, b: Blob): Promise<boolean> {
	if (a.size !== b.size) return false;
	const CHUNK = 8 * 1024 * 1024;
	for (let at = 0; at < a.size; at += CHUNK) {
		const [x, y] = await Promise.all([
			a.slice(at, at + CHUNK).arrayBuffer(),
			b.slice(at, at + CHUNK).arrayBuffer(),
		]);
		const ua = new Uint8Array(x);
		const ub = new Uint8Array(y);
		for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
	}
	return true;
}
