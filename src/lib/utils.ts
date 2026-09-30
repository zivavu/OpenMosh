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

/** Save a blob to disk: streamed through the file picker where the browser has one,
 * a plain download otherwise. A cancelled picker saves nothing. */
export async function saveBlobAs(blob: Blob, name: string): Promise<void> {
	const picker = (window as { showSaveFilePicker?: unknown })
		.showSaveFilePicker;
	if (typeof picker === "function") {
		try {
			const handle = await (picker as SaveFilePicker)({
				suggestedName: name,
				types: [
					{
						description: "OpenMosh project",
						accept: { "application/zip": [".openmosh"] },
					},
				],
			});
			const writable = await handle.createWritable();
			await blob.stream().pipeTo(writable);
			return;
		} catch (e) {
			if (e instanceof DOMException && e.name === "AbortError") return;
			// Any other failure falls back to a download.
		}
	}
	downloadFile(blob, name);
}
