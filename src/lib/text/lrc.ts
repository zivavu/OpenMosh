/** Pasted lyrics, read as LRC when they carry its `[mm:ss.xx]` stamps. */

export interface PastedLyrics {
	lines: string[];
	/** Seconds per line from its stamp; null for a line without one. */
	times: (number | null)[];
}

const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
/** `[ar:Artist]`, `[ti:Title]` and the rest: tags, not lyrics. */
const TAG_LINE = /^\[[a-z#]+:[^\]]*\]$/i;
/** Enhanced LRC times each word too: `<00:12.34>`. */
const WORD_STAMP = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function seconds(min: string, sec: string): number {
	return Number(min) * 60 + Number(sec.replace(":", "."));
}

/** One entry per lyric line; a line stamped twice (a repeated chorus) appears at
 * each time. Stamped lines come back in time order. */
export function parsePastedLyrics(text: string): PastedLyrics {
	const entries: { line: string; time: number | null }[] = [];
	let offset = 0;
	for (const raw of text.split("\n")) {
		const trimmed = raw.trim();
		const shift = /^\[offset:\s*([+-]?\d+)\]$/i.exec(trimmed);
		if (shift) {
			// Milliseconds, positive meaning earlier.
			offset = -Number(shift[1]) / 1000;
			continue;
		}
		if (TAG_LINE.test(trimmed)) continue;
		const times = [...trimmed.matchAll(STAMP)].map((m) => seconds(m[1], m[2]));
		const line = trimmed.replace(STAMP, "").replace(WORD_STAMP, "").trim();
		if (!line) continue;
		if (times.length === 0) entries.push({ line, time: null });
		for (const t of times)
			entries.push({ line, time: Math.max(0, t + offset) });
	}
	if (entries.every((e) => e.time !== null)) {
		entries.sort((a, b) => a.time! - b.time!);
	}
	return {
		lines: entries.map((e) => e.line),
		times: entries.map((e) => e.time),
	};
}
