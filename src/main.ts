import { mount } from "svelte";
import "./app.css";
// Must be listening before Chrome fires beforeinstallprompt.
import "./lib/install-prompt";
import App from "./App.svelte";

mount(App, {
	target: document.getElementById("app")!,
});
