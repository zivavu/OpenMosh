/** Reading a Google Fonts stylesheet: which @font-face files a link asks for. */

export interface ParsedFace {
	name: string;
	url: string;
	weight: number;
	italic: boolean;
	/** Empty when the block covers everything. */
	unicodeRange: string;
}

export function parseFontFaces(css: string): ParsedFace[] {
	const faces: ParsedFace[] = [];
	for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
		const body = block[1];
		const name = /font-family:\s*(['"]?)(.+?)\1\s*;/.exec(body)?.[2]?.trim();
		const src =
			/url\(\s*['"]?(https?:\/\/[^'")\s]+\.woff2[^'")\s]*)/i.exec(body)?.[1] ??
			/url\(\s*['"]?(https?:\/\/[^'")\s]+)/i.exec(body)?.[1];
		if (!name || !src) continue;
		faces.push({
			name,
			url: src,
			weight: Number(/font-weight:\s*(\d+)/.exec(body)?.[1] ?? 400),
			italic: /font-style:\s*italic/.test(body),
			unicodeRange: /unicode-range:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? "",
		});
	}
	return faces;
}

/** The first family a stylesheet link asks for: `css2?family=A:wght@400&family=B`,
 * or the older `css?family=A|B`. */
export function requestedFamily(cssUrl: string): string | null {
	try {
		const param = new URL(cssUrl).searchParams.get("family");
		return param?.split("|")[0].split(":")[0].trim() || null;
	} catch {
		return null;
	}
}

/** A Google Fonts stylesheet is one @font-face per script subset and weight. Take
 * every subset of the upright regular face of the asked-for family: the overlays
 * draw a single weight, in whatever script the caption is in. The latin one leads. */
export function pickFaces(
	faces: ParsedFace[],
	family: string | null,
): ParsedFace[] {
	const named = faces.filter(
		(f) => f.name.toLowerCase() === family?.toLowerCase(),
	);
	const ofFamily = named.length > 0 ? named : faces;
	const upright = ofFamily.filter((f) => !f.italic);
	const pool = upright.length > 0 ? upright : ofFamily;
	if (pool.length === 0) return [];
	const weight = pool.reduce((best, f) =>
		Math.abs(f.weight - 400) < Math.abs(best.weight - 400) ? f : best,
	).weight;
	const isLatin = (f: ParsedFace) =>
		f.unicodeRange === "" || f.unicodeRange.includes("U+0000-00FF");
	const picked = pool.filter((f) => f.weight === weight);
	return [...picked.filter(isLatin), ...picked.filter((f) => !isLatin(f))];
}
