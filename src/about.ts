import "./app.css";
import "./about.css";
import { glitchText } from "./lib/not-found/glitch";

const glitch = glitchText(
	document.querySelector<HTMLCanvasElement>(".wordmark")!,
	"OpenMosh",
);

window.addEventListener("pointermove", (e) =>
	glitch.disturb(Math.hypot(e.movementX, e.movementY) / 400),
);
