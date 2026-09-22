/**
 * Chromium's deferred "install this site" prompt. Chrome grants
 * navigator.storage.persist() only to origins it already trusts and refuses the rest
 * silently; installing is the one a page can trigger itself, so the event is caught here.
 */

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
	window.addEventListener("beforeinstallprompt", (e) => {
		e.preventDefault();
		deferred = e as BeforeInstallPromptEvent;
		listeners.forEach((fn) => fn());
	});
	window.addEventListener("appinstalled", () => {
		deferred = null;
		listeners.forEach((fn) => fn());
	});
}

/** True once the browser has offered an install and it hasn't been used. */
export function canInstall(): boolean {
	return deferred !== null;
}

/** Notified whenever canInstall() may have changed. Returns the unsubscribe. */
export function onInstallableChange(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

/** Show the install prompt. Resolves true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
	const ev = deferred;
	if (!ev) return false;
	deferred = null;
	listeners.forEach((fn) => fn());
	try {
		await ev.prompt();
		return (await ev.userChoice).outcome === "accepted";
	} catch {
		return false;
	}
}
