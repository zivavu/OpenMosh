import { MASK_MAX } from "../media/source-edit";

/** RGBA pixels turned into a mask in place, white where the effects show. A cutout
 * with any transparency is read by its alpha; anything opaque, by its brightness. */
export function toMaskPixels(px: Uint8ClampedArray): void {
	let cutout = false;
	for (let i = 3; i < px.length; i += 4) {
		if (px[i] < 255) {
			cutout = true;
			break;
		}
	}
	for (let i = 0; i < px.length; i += 4) {
		const v = cutout
			? px[i + 3]
			: Math.round(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]);
		px[i] = px[i + 1] = px[i + 2] = v;
		px[i + 3] = 255;
	}
}

/** An image file as a Mask painting: a PNG data URL no longer than MASK_MAX. */
export async function maskFromImage(file: Blob): Promise<string> {
	const bitmap = await createImageBitmap(file);
	try {
		const k = Math.min(1, MASK_MAX / Math.max(bitmap.width, bitmap.height));
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(bitmap.width * k));
		canvas.height = Math.max(1, Math.round(bitmap.height * k));
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw new Error("2D canvas unavailable");
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
		toMaskPixels(data.data);
		ctx.putImageData(data, 0, 0);
		return canvas.toDataURL("image/png");
	} finally {
		bitmap.close();
	}
}
