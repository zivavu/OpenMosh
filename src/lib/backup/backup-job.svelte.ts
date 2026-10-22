/** The one backup save or load running, app-wide: it outlives the dialog that
 * started it, so reopening shows it still going and can't start a second. */
import { showToast } from "../components/ui/toast.svelte";
import { downloadFile } from "../utils";
import { noteRestored } from "./restored-notice";

let running = $state<"save" | "load" | null>(null);

/** What's running, if anything. Reactive. */
export function backupJob(): "save" | "load" | null {
	return running;
}

export async function saveBackup(): Promise<void> {
	if (running) return;
	running = "save";
	try {
		// Loaded on first use: the upload screen offers this only on the old address.
		const backup = await import("./backup");
		const name = backup.backupFileName();
		downloadFile(await backup.buildBackup(), name);
		showToast(`Backup saved as ${name}`, "success");
	} catch (e) {
		console.error(e);
		showToast("Couldn't build the backup", "error");
	} finally {
		running = null;
	}
}

/** Merged in, then reloaded: settings and fonts are read once at startup. False
 * when the file was refused, with the reason toasted. */
export async function loadBackup(file: File): Promise<boolean> {
	if (running) return false;
	running = "load";
	try {
		const { restoreBackup } = await import("./backup");
		noteRestored(await restoreBackup(file));
		location.reload();
		return true;
	} catch (e) {
		showToast(
			e instanceof Error ? e.message : "Couldn't load that backup",
			"error",
			8000,
		);
		running = null;
		return false;
	}
}
