import { mount } from "svelte";
import "./app.css";
// Must be listening before Chrome fires beforeinstallprompt.
import "./lib/install-prompt";
import App from "./App.svelte";

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

mount(App, {
	target: document.getElementById("app")!,
});
