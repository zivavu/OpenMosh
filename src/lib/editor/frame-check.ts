/** Whether a rolled frame is worth keeping, judged from a small RGBA sample of it. */

const MIN_MEAN = 0.04;
const MAX_MEAN = 0.96;
/** Luminance spread below this is one flat colour. */
const MIN_SPREAD = 0.035;
/** Neighbouring pixels of a picture move together; noise doesn't. */
const MIN_NEIGHBOUR_CORRELATION = 0.25;

/** True when the frame is near black, near white, flat, or pure noise. */
export function frameLooksDead(
	rgba: ArrayLike<number>,
	width: number,
	height: number,
): boolean {
	const n = width * height;
	if (n === 0) return false;
	const lum = new Float32Array(n);
	let sum = 0;
	for (let i = 0; i < n; i++) {
		const l =
			(0.2126 * rgba[i * 4] +
				0.7152 * rgba[i * 4 + 1] +
				0.0722 * rgba[i * 4 + 2]) /
			255;
		lum[i] = l;
		sum += l;
	}
	const mean = sum / n;
	if (mean < MIN_MEAN || mean > MAX_MEAN) return true;
	let variance = 0;
	for (let i = 0; i < n; i++) variance += (lum[i] - mean) ** 2;
	variance /= n;
	if (Math.sqrt(variance) < MIN_SPREAD) return true;
	if (width < 2) return false;
	let covariance = 0;
	let pairs = 0;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width - 1; x++) {
			const i = y * width + x;
			covariance += (lum[i] - mean) * (lum[i + 1] - mean);
			pairs++;
		}
	}
	return covariance / pairs / variance < MIN_NEIGHBOUR_CORRELATION;
}
