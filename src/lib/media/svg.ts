export function isSvgFile(file: File): boolean {
	return file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
}

/** The size to draw an SVG at to fit inside `maxW` x `maxH`, kept to its own shape. */
export function svgFit(
	aspect: number,
	maxW: number,
	maxH: number,
): { width: number; height: number } {
	return aspect >= maxW / maxH
		? { width: maxW, height: Math.max(1, Math.round(maxW / aspect)) }
		: { width: Math.max(1, Math.round(maxH * aspect)), height: maxH };
}

/** Width over height, from the viewBox or else the width and height; 1 when it
 * has neither in plain units. */
export function svgAspect(root: Element): number {
	const box = root
		.getAttribute("viewBox")
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (box?.length === 4 && box[2] > 0 && box[3] > 0) return box[2] / box[3];
	const w = plainLength(root.getAttribute("width"));
	const h = plainLength(root.getAttribute("height"));
	return w && h ? w / h : 1;
}

/** A length in user units or px; null for percentages and the like. */
function plainLength(value: string | null): number | null {
	const m = value?.trim().match(/^([\d.]+)(px)?$/);
	const n = m ? Number(m[1]) : NaN;
	return n > 0 ? n : null;
}

/** The SVG drawn crisp to fit inside `maxW` x `maxH`, as a PNG, transparent where
 * it is. The root gets an explicit size: Firefox won't draw an SVG without one. */
export async function rasterizeSvg(
	file: Blob,
	maxW: number,
	maxH: number,
): Promise<{ blob: Blob; width: number; height: number }> {
	const doc = new DOMParser().parseFromString(
		await file.text(),
		"image/svg+xml",
	);
	const root = doc.documentElement;
	if (root.nodeName !== "svg" || doc.querySelector("parsererror")) {
		throw new Error("not an SVG");
	}
	const aspect = svgAspect(root);
	const { width, height } = svgFit(aspect, maxW, maxH);
	// Without a viewBox, a new size would crop the drawing instead of scaling it.
	if (!root.hasAttribute("viewBox")) {
		const w = plainLength(root.getAttribute("width"));
		const h = plainLength(root.getAttribute("height"));
		if (w && h) root.setAttribute("viewBox", `0 0 ${w} ${h}`);
	}
	root.setAttribute("width", String(width));
	root.setAttribute("height", String(height));
	const url = URL.createObjectURL(
		new Blob([new XMLSerializer().serializeToString(doc)], {
			type: "image/svg+xml",
		}),
	);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2D context");
		ctx.drawImage(img, 0, 0, width, height);
		return {
			blob: await canvas.convertToBlob({ type: "image/png" }),
			width,
			height,
		};
	} finally {
		URL.revokeObjectURL(url);
	}
}
