import { mount } from "svelte";
import "./app.css";
// Must be listening before Chrome fires beforeinstallprompt.
import "./lib/install-prompt";
import App from "./App.svelte";
import { showToast } from "./lib/components/ui/toast.svelte";

// A deploy renames every chunk, so an open tab 404s on its next lazy import. Reload
// once to pick up the new build; a second failure soon after is a real outage and
// falls through to the {:catch} screen.
const RELOADED_AT = "openmosh-chunk-reload";
window.addEventListener("vite:preloadError", (event) => {
	const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
	if (Date.now() - last < 30_000) return;
	sessionStorage.setItem(RELOADED_AT, String(Date.now()));
	event.preventDefault();
	location.reload();
});

// Errors outside rendering (handlers, async work) never reach the boundary in App.
let lastErrorToast = 0;
function reportUncaught(reason: unknown) {
	if (reason instanceof DOMException && reason.name === "AbortError") return;
	const message = reason instanceof Error ? reason.message : String(reason);
	if (message.includes("ResizeObserver loop")) return;
	if (Date.now() - lastErrorToast < 5000) return;
	lastErrorToast = Date.now();
	showToast(`Something went wrong: ${message}`, "error", 6000);
}
window.addEventListener("error", (e) => reportUncaught(e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => reportUncaught(e.reason));

// The offline copy; dev serves unbundled modules, which it can't list.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("/sw.js").catch(() => {});
	});
}

mount(App, {
	target: document.getElementById("app")!,
});
