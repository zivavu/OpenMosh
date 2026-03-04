/** How to split the dictionary into phrases. */
export type TextOverlaySplitBy = 'sentence' | 'line' | 'both';

/** Layout of text: block = one block at style position, scattered = each word at random position. */
export type TextOverlayLayout = 'block' | 'scattered';

/** How to composite the text layer onto the main image. */
export type TextOverlayBlendMode = 'normal' | 'multiply' | 'add' | 'screen';

/** Effect IDs that can be applied to the text layer (kept for renderer API). */
export const TEXT_SAFE_EFFECT_IDS = ['scanlines', 'grain', 'vignette', 'bleach'] as const;
export type TextSafeEffectId = (typeof TEXT_SAFE_EFFECT_IDS)[number];

export interface TextOverlayStyle {
	/** CSS font family. */
	fontFamily: string;
	/** Font size as fraction of canvas height (0.02–0.15). */
	fontSizeRatio: number;
	/** Fill color (hex or rgba). */
	fillStyle: string;
	/** Optional stroke (outline) for readability. */
	strokeStyle: string;
	/** Stroke width in pixels (0 = no stroke). */
	strokeWidth: number;
	/** Horizontal position: 0 = left, 0.5 = center, 1 = right. */
	alignX: number;
	/** Vertical position: 0 = top, 0.5 = middle, 1 = bottom. */
	alignY: number;
	/** Max width as fraction of canvas width (0.5–1). Wrap text within. */
	maxWidthRatio: number;
}

export interface TextOverlayConfig {
	enabled: boolean;
	/** Raw text: split by sentence (.), line (\\n), or both to get phrases. */
	dictionary: string;
	splitBy: TextOverlaySplitBy;
	/** How to composite text onto the image. */
	blendMode: TextOverlayBlendMode;
	/** Invert text layer (negative). */
	invert: boolean;
	/** Chance (0–1) that a slide/frame will show text. */
	chance: number;
	/** Layout: block = single block, scattered = each word at random position. */
	layout: TextOverlayLayout;
	style: TextOverlayStyle;
}

export const DEFAULT_TEXT_OVERLAY_STYLE: TextOverlayStyle = {
	fontFamily: 'Georgia, serif',
	fontSizeRatio: 0.06,
	fillStyle: '#ffffff',
	strokeStyle: '#000000',
	strokeWidth: 2,
	alignX: 0.5,
	alignY: 0.85,
	maxWidthRatio: 0.9,
};

export const DEFAULT_TEXT_OVERLAY_CONFIG: TextOverlayConfig = {
	enabled: false,
	dictionary: '',
	splitBy: 'sentence',
	blendMode: 'normal',
	invert: false,
	chance: 0.8,
	layout: 'scattered',
	style: { ...DEFAULT_TEXT_OVERLAY_STYLE },
};

/**
 * Parse dictionary into an array of non-empty phrases.
 * - sentence: split by . then trim
 * - line: split by \\n then trim
 * - both: split by . or \\n, then trim
 */
export function parsePhrases(
	dictionary: string,
	splitBy: TextOverlaySplitBy,
): string[] {
	if (!dictionary.trim()) return [];

	const splitPattern =
		splitBy === 'sentence'
			? /\.+/g
			: splitBy === 'line'
				? /\n+/g
				: /[.\n]+/g;

	const raw = dictionary.split(splitPattern).map((s) => s.trim()).filter(Boolean);
	// Dedupe and limit length so we don't show huge blocks
	return raw.map((s) => (s.length > 120 ? s.slice(0, 117) + '...' : s));
}
