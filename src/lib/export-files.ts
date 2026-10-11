/** Where a WebM export is written while it's built: a file in the origin's private
 * storage, so a long export never sits in memory. The download reads it straight
 * off that file, so it stays until it can't be in use any more. */

const EXPORT_DIR = "exports";
/** Held, shared, by every tab that has written an export: its last file may still be
 * downloading. A tab that gets it alone knows no other tab needs any of them. */
const EXPORTS_LOCK = "openmosh-exports";

let holdingLock = false;
/** This tab's last export, cleared as the next one starts. */
let lastFile: string | null = null;

async function exportDir(): Promise<FileSystemDirectoryHandle> {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle(EXPORT_DIR, { create: true });
}

/** Drop every export no open tab still holds. Run at startup: a tab that has since
 * closed left its file behind, taking up quota the storage manager can't show. */
export async function clearStaleExports(): Promise<void> {
	try {
		if (!navigator.storage?.getDirectory || !navigator.locks) return;
		await navigator.locks.request(
			EXPORTS_LOCK,
			{ ifAvailable: true },
			async (lock) => {
				if (!lock) return;
				const root = await navigator.storage.getDirectory();
				await root.removeEntry(EXPORT_DIR, { recursive: true });
			},
		);
	} catch {
		// Nothing there, or storage blocked.
	}
}

/** A fresh file for the next export, or null where the browser can't write one. */
export async function openExportFile(): Promise<FileSystemFileHandle | null> {
	try {
		if (!navigator.storage?.getDirectory) return null;
		if (!navigator.locks) {
			// No way to tell whether another tab is still downloading one; clear them all.
			const root = await navigator.storage.getDirectory();
			await root.removeEntry(EXPORT_DIR, { recursive: true }).catch(() => {});
		} else {
			await clearStaleExports();
			if (!holdingLock) {
				holdingLock = true;
				void navigator.locks.request(
					EXPORTS_LOCK,
					{ mode: "shared" },
					() => new Promise<never>(() => {}),
				);
			}
		}
		const dir = await exportDir();
		// This tab's last export was saved long before another was started.
		if (lastFile) await dir.removeEntry(lastFile).catch(() => {});
		lastFile = `export-${Date.now()}.webm`;
		return await dir.getFileHandle(lastFile, { create: true });
	} catch {
		return null;
	}
}

/** Delete an export that was cancelled or failed. */
export async function removeExportFile(
	handle: FileSystemFileHandle,
): Promise<void> {
	try {
		await (await exportDir()).removeEntry(handle.name);
		if (lastFile === handle.name) lastFile = null;
	} catch {
		// Already gone.
	}
}
