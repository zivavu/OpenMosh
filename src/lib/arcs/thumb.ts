/** A pool thumbnail: one lively moment of the look, on its own short-lived context. */

import type { Controls } from "./controls";
import { allForms, arcsColors, arcsLook, type ArcsSpec } from "./look";
import { ArcsPass } from "./pass";

/** A second of steady music with one hit, so a thumbnail needs no song. */
function posedControls(): Controls {
	const frames = 60;
	const flat = (v: number) => new Float32Array(frames).fill(v);
	const hit = 30;
	return {
		frames,
		duration: 1,
		kick: flat(0.6),
		bass: flat(0.6),
		mid: flat(0.5),
		high: flat(0.5),
		energy: flat(0.7),
		energyTotal: flat(0.5),
		kickAge: flat(0).map((_, i) => Math.max(0, (i - hit) / frames)),
		formA: new Uint8Array(frames),
		formB: new Uint8Array(frames),
		formMix: flat(0),
		sectionA: new Uint16Array(frames),
		sectionB: new Uint16Array(frames),
		onsetIndex: new Uint32Array(frames).fill(1),
		cuts: [],
		onsets: [hit],
		onsetStrength: [1],
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
		const controls = posedControls();
		// The form follows the seed, so thumbnails don't all show the same one.
		const forms = allForms();
		controls.formA.fill(forms[spec.seed % forms.length]);
		controls.formB.set(controls.formA);
		pass.draw(
			controls,
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
