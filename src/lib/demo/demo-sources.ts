/** Source material for the upload-screen demo: a fresh mixed batch from the image
 * generators each visit. All share one size so switching source never reallocates the FBOs. */

const WIDTH = 640;
const HEIGHT = 360;
const COUNT = 12;

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = reject;
		img.src = url;
	});
}

export async function loadDemoSources(): Promise<HTMLImageElement[]> {
	const { planBatch, randomSeed, renderSpec } = await import("../generators");
	const specs = planBatch(randomSeed(), {
		count: COUNT,
		variety: "wild",
		kind: "mix",
		palette: null,
	});
	const images: HTMLImageElement[] = [];
	for (const spec of specs) {
		// One kind this GPU can't draw (attractors need float targets) shouldn't take the rest.
		try {
			const blob = await renderSpec(spec, WIDTH, HEIGHT, "image/jpeg");
			images.push(await blobToImage(blob));
		} catch (e) {
			console.warn("Demo image skipped:", e);
		}
	}
	return images;
}
