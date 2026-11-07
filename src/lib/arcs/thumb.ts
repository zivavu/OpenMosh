/** A pool thumbnail: the look's first figure, finished, on its own short-lived context. */

import type { Controls } from "./controls";
import { arcsColors, arcsLook, type ArcsSpec } from "./look";
import { ArcsPass } from "./pass";

/** A second of steady music with the figure finished, so a thumbnail needs no song. */
function posedControls(): Controls {
	const frames = 60;
	const flat = (v: number) => new Float32Array(frames).fill(v);
	return {
		frames,
		duration: 1,
		kick: flat(0.4),
		bass: flat(0.5),
		mid: flat(0.5),
		high: flat(0.5),
		energy: flat(0.7),
		energyTotal: flat(0.5),
		presence: flat(1),
		pen: flat(1),
		morph: flat(0),
		sectionA: new Uint16Array(frames),
		sectionB: new Uint16Array(frames),
		cuts: [],
		onsets: [],
		onsetStrength: [],
	};
}

/** Null where the browser can't draw it; the pool shows its icon instead. */
export async function renderArcsThumb(
	spec: ArcsSpec,
	size: number,
): Promise<Blob | null> {
	if (typeof OffscreenCanvas === "undefined") return null;
	const canvas = new OffscreenCanvas(size, size);
	const gl = canvas.getContext("webgl2", { alpha: false, antialias: false });
	if (!gl) return null;
	const pass = new ArcsPass(gl);
	try {
		if (!pass.supported) return null;
		pass.draw(
			posedControls(),
			0.6,
			arcsLook(spec),
			arcsColors(spec),
			size,
			size,
			null,
		);
		return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
	} catch {
		return null;
	} finally {
		pass.dispose();
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	}
}
