export interface Capabilities {
	webgl2: boolean;
	floatTargets: boolean;
	maxTexture: number;
	videoEncode: boolean;
}

export interface CapabilityReport {
	/** Nothing renders without it. */
	blocking: string | null;
	/** Editing works, export doesn't. */
	exportBlocked: string | null;
	/** Works, with caveats. */
	notes: string[];
}

export function assess(c: Capabilities): CapabilityReport {
	const report: CapabilityReport = {
		blocking: null,
		exportBlocked: null,
		notes: [],
	};
	if (!c.webgl2) {
		report.blocking =
			"This browser can't run WebGL2, and OpenMosh draws everything with it. Try a recent Chrome or Edge, or check that hardware acceleration is on.";
		return report;
	}
	if (!c.videoEncode)
		report.exportBlocked =
			"This browser can't encode video, so export is off. You can still edit here; Chrome or Edge can export.";
	if (!c.floatTargets)
		report.notes.push(
			"Your graphics driver can't render to float textures, so glow and bloom effects may look wrong.",
		);
	if (c.maxTexture < 4096)
		report.notes.push(
			`Your GPU tops out at ${c.maxTexture}px textures, under the 4096px OpenMosh is built for, so large images and video may not show right.`,
		);
	return report;
}

async function canEncode(): Promise<boolean> {
	if (typeof VideoEncoder === "undefined") return false;
	for (const codec of ["vp8", "vp09.00.10.08", "av01.0.04M.08"]) {
		try {
			const { supported } = await VideoEncoder.isConfigSupported({
				codec,
				width: 1280,
				height: 720,
				bitrate: 4_000_000,
			});
			if (supported) return true;
		} catch {
			// An unknown codec string throws on some browsers.
		}
	}
	return false;
}

function probeGl(): Pick<
	Capabilities,
	"webgl2" | "floatTargets" | "maxTexture"
> {
	const gl = document.createElement("canvas").getContext("webgl2");
	if (!gl) return { webgl2: false, floatTargets: false, maxTexture: 0 };
	const result = {
		webgl2: true,
		floatTargets: !!gl.getExtension("EXT_color_buffer_float"),
		maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
	};
	gl.getExtension("WEBGL_lose_context")?.loseContext();
	return result;
}

export async function detectCapabilities(): Promise<CapabilityReport> {
	return assess({ ...probeGl(), videoEncode: await canEncode() });
}
