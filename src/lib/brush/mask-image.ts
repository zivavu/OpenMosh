/** Long edge of a loaded mask. Above the brush's: a photo's cutout needs the detail. */
export const IMAGE_MASK_MAX = 1024;

/** RGBA pixels made grey in place, transparency kept, so the Mask can read either.
 * True when any pixel is see-through: a cutout, best read by its transparency. */
export function toMaskPixels(px: Uint8ClampedArray): boolean {
	let cutout = false;
	for (let i = 0; i < px.length; i += 4) {
		const v = Math.round(
			0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2],
		);
		px[i] = px[i + 1] = px[i + 2] = v;
		if (px[i + 3] < 255) cutout = true;
	}
	return cutout;
}

/** An image file as a Mask's image: a PNG data URL no longer than IMAGE_MASK_MAX. */
export async function maskFromImage(
	file: Blob,
): Promise<{ url: string; cutout: boolean }> {
	const bitmap = await createImageBitmap(file);
	try {
		const k = Math.min(
			1,
			IMAGE_MASK_MAX / Math.max(bitmap.width, bitmap.height),
		);
		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(bitmap.width * k));
		canvas.height = Math.max(1, Math.round(bitmap.height * k));
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) throw new Error("2D canvas unavailable");
		ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const cutout = toMaskPixels(data.data);
		ctx.putImageData(data, 0, 0);
		return { url: canvas.toDataURL("image/png"), cutout };
	} finally {
		bitmap.close();
	}
}
