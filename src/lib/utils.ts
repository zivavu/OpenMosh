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
	// Deleting the object URL immediately can cancel the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface SaveFilePickerOptions {
	suggestedName?: string;
	types?: { description?: string; accept: Record<string, string[]> }[];
}

type SaveFilePicker = (
	options: SaveFilePickerOptions,
) => Promise<{ createWritable: () => Promise<WritableStream<Uint8Array>> }>;

/** Where a file is about to be saved. */
export interface SaveTarget {
	write(blob: Blob): Promise<void>;
}

/** Ask where to save before the file is built: the picker only opens on the click
 * that asked for it, and building a big file outlasts that. Streams through the
 * picker where the browser has one, else downloads. Null when the picker is
 * cancelled. */
export async function chooseSaveTarget(
	name: string,
	type: NonNullable<SaveFilePickerOptions["types"]>[number],
): Promise<SaveTarget | null> {
	const download: SaveTarget = {
		write: async (blob) => downloadFile(blob, name),
	};
	const picker = (window as { showSaveFilePicker?: unknown })
		.showSaveFilePicker;
	if (typeof picker !== "function") return download;
	let handle: Awaited<ReturnType<SaveFilePicker>>;
	try {
		handle = await (picker as SaveFilePicker)({
			suggestedName: name,
			types: [type],
		});
	} catch (e) {
		if (e instanceof DOMException && e.name === "AbortError") return null;
		// Any other failure falls back to a download.
		return download;
	}
	return {
		async write(blob) {
			try {
				await blob.stream().pipeTo(await handle.createWritable());
			} catch {
				downloadFile(blob, name);
			}
		},
	};
}
