import type { RestoreSummary } from "./backup";

/** A backup load ends in a reload, so its toast waits in session storage for the
 * page that comes back. */
const NOTICE_KEY = "openmosh-backup-restored";

function plural(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** What the toast says a backup brought in. */
export function restoredMessage(summary: RestoreSummary): string {
	const parts = [
		summary.edits > 0 && plural(summary.edits, "project"),
		summary.media > 0 && plural(summary.media, "media file"),
		summary.songs > 0 && plural(summary.songs, "song"),
		summary.fonts > 0 && plural(summary.fonts, "font"),
	].filter(Boolean);
	return parts.length > 0
		? `Backup loaded: ${parts.join(", ")}`
		: "Backup loaded";
}

export function noteRestored(summary: RestoreSummary): void {
	try {
		sessionStorage.setItem(NOTICE_KEY, restoredMessage(summary));
	} catch {
		// No session storage: the load still happened, just unannounced.
	}
}

/** The waiting notice, once. */
export function takeRestoredNotice(): string | null {
	try {
		const message = sessionStorage.getItem(NOTICE_KEY);
		sessionStorage.removeItem(NOTICE_KEY);
		return message;
	} catch {
		return null;
	}
}
