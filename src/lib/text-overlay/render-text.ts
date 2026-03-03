import type { TextOverlayStyle } from './types';

/** Seeded PRNG (mulberry32) for deterministic per-frame layout. */
function createRng(seed: number) {
	let state = seed >>> 0;
	return function next(): number {
		state = (state + 0x6d2b79f5) >>> 0; // 32-bit
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface DrawPhraseOptions {
	layout: 'block' | 'scattered';
	/** Seed for scattered layout (same seed = same positions). */
	seed?: number;
}

/**
 * Draw a single phrase onto a 2D canvas of the given dimensions.
 * - block: phrase as one block at style position (with wrap).
 * - scattered: each word at a random position with light jitter (uses seed for reproducibility).
 */
export function drawPhraseToCanvas(
	phrase: string,
	width: number,
	height: number,
	style: TextOverlayStyle,
	options: DrawPhraseOptions = { layout: 'block' },
): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) return canvas;

	ctx.clearRect(0, 0, width, height);

	const baseFontSize = Math.max(12, Math.round(height * style.fontSizeRatio));

	if (options.layout === 'scattered' && options.seed != null) {
		drawScattered(ctx, phrase, width, height, style, baseFontSize, options.seed);
	} else {
		drawBlock(ctx, phrase, width, height, style, baseFontSize);
	}

	return canvas;
}

function drawBlock(
	ctx: CanvasRenderingContext2D,
	phrase: string,
	width: number,
	height: number,
	style: TextOverlayStyle,
	fontSize: number,
) {
	const maxWidth = width * style.maxWidthRatio;
	ctx.font = `${fontSize}px ${style.fontFamily}`;
	ctx.textAlign = style.alignX < 0.34 ? 'left' : style.alignX > 0.66 ? 'right' : 'center';
	ctx.textBaseline = 'middle';

	const x = width * style.alignX;
	const y = height * style.alignY;

	const words = phrase.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let current = '';

	for (const word of words) {
		const test = current ? `${current} ${word}` : word;
		const metrics = ctx.measureText(test);
		if (metrics.width <= maxWidth) {
			current = test;
		} else {
			if (current) lines.push(current);
			current = word;
		}
	}
	if (current) lines.push(current);

	const lineHeight = fontSize * 1.25;
	const totalHeight = lines.length * lineHeight;
	let drawY = y - (totalHeight - lineHeight) / 2;

	for (const line of lines) {
		if (style.strokeWidth > 0) {
			ctx.strokeStyle = style.strokeStyle;
			ctx.lineWidth = style.strokeWidth;
			ctx.strokeText(line, x, drawY);
		}
		ctx.fillStyle = style.fillStyle;
		ctx.fillText(line, x, drawY);
		drawY += lineHeight;
	}
}

function drawScattered(
	ctx: CanvasRenderingContext2D,
	phrase: string,
	width: number,
	height: number,
	style: TextOverlayStyle,
	baseFontSize: number,
	seed: number,
) {
	const words = phrase.split(/\s+/).filter(Boolean);
	if (words.length === 0) return;

	const rng = createRng(seed);
	const padding = Math.round(width * 0.04);
	const marginX = padding;
	const marginY = Math.round(height * 0.06);

	for (let i = 0; i < words.length; i++) {
		const rand = rng();
		const rand2 = rng();
		const rand3 = rng();
		const rand4 = rng();

		const sizeMult = 0.75 + rand * 0.5;
		const fontSize = Math.max(10, Math.round(baseFontSize * sizeMult));
		const x = marginX + rand2 * (width - 2 * marginX);
		const y = marginY + rand3 * (height - 2 * marginY);
		const rotation = (rand4 - 0.5) * 0.42;

		ctx.save();
		ctx.font = `${fontSize}px ${style.fontFamily}`;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'alphabetic';
		ctx.translate(x, y);
		ctx.rotate(rotation);

		if (style.strokeWidth > 0) {
			ctx.strokeStyle = style.strokeStyle;
			ctx.lineWidth = Math.max(1, style.strokeWidth * (fontSize / baseFontSize));
			ctx.strokeText(words[i]!, 0, 0);
		}
		ctx.fillStyle = style.fillStyle;
		ctx.fillText(words[i]!, 0, 0);
		ctx.restore();
	}
}
