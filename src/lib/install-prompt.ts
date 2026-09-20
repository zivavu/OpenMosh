/**
 * Chromium's deferred "install this site" prompt.
 *
 * Chrome never asks the user about persistent storage: it grants
 * navigator.storage.persist() only to origins it already trusts — installed
 * as an app, bookmarked, allowed to notify, or heavily used — and refuses the
 * rest silently. Installing is the one of those a page can trigger itself, so
 * the event is caught here (it fires once, early, and only if listened for)
 * and handed to whoever wants to offer the install.
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

/** Running as an installed app rather than a tab. */
export function isInstalled(): boolean {
	return (
		typeof window !== "undefined" &&
		(window.matchMedia("(display-mode: standalone)").matches ||
			(navigator as { standalone?: boolean }).standalone === true)
	);
}
