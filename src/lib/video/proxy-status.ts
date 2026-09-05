/**
 * What a preview proxy's badge shows and says, in one place.
 *
 * Four surfaces display this state — the source rail, both grid views and
 * single mode — and they were each carrying their own wording, which drifted
 * into saying less than the app knows. The state also reads as three different
 * things depending on how far along it is (looking in storage, encoding a
 * known size, done), and none of that is visible from a boolean.
 *
 * Copy rules here: say what is happening to the user's media and what it means
 * for playback and export. No progress verbs standing in for facts
 * ("optimizing"), no promises about the result ("for smooth playback").
 */

export interface ProxyStatusInput {
	/** Source display size, from the add-time probe. */
	width?: number;
	height?: number;
	proxyFile?: File;
	/** The proxy's size: the target while encoding, the real one once it lands. */
	proxyWidth?: number;
	proxyHeight?: number;
	proxyPending?: boolean;
	/** 0–1. */
	proxyProgress?: number;
	proxyFailed?: boolean;
	/** The worker's error text, when there is one. */
	proxyReason?: string;
}

export type ProxyStatus =
	| { kind: "none" }
	| { kind: "pending"; badge: string; title: string }
	| { kind: "ready"; badge: string; title: string }
	| { kind: "failed"; badge: string; title: string };

/** Longest error text a tooltip will carry before it stops being readable. */
const MAX_REASON = 120;

export function proxyStatus(src: ProxyStatusInput): ProxyStatus {
	if (src.proxyPending) {
		const percent =
			src.proxyProgress === undefined
				? null
				: Math.round(src.proxyProgress * 100);
		// No size yet means the worker hasn't reported one, which is the window
		// where storage is being checked and the source benchmarked. Naming a
		// size we don't have would be a guess, so the wait says what it's doing.
		if (!src.proxyWidth || !src.proxyHeight) {
			return {
				kind: "pending",
				badge: "…",
				title: "Looking for a smaller copy of this video to preview from.",
			};
		}
		return {
			kind: "pending",
			badge: percent === null ? "…" : `${percent}%`,
			title:
				`Making a ${size(src.proxyWidth, src.proxyHeight)} copy to preview from` +
				`${percent === null ? "" : `, ${percent}% of the way through`}.` +
				` The preview plays the ${sourceSize(src)} original until it lands.`,
		};
	}
	if (src.proxyFailed) {
		return {
			kind: "failed",
			badge: "!",
			title:
				`Nothing could be encoded from this video${reason(src.proxyReason)}.` +
				` The preview plays the ${sourceSize(src)} original, which may stutter.` +
				" Export is unaffected.",
		};
	}
	if (src.proxyFile && src.proxyWidth && src.proxyHeight) {
		return {
			kind: "ready",
			badge: shortRes(src.proxyHeight),
			title:
				`The preview plays a ${size(src.proxyWidth, src.proxyHeight)} copy of this video.` +
				` Export reads the ${sourceSize(src)} original, at full quality.`,
		};
	}
	// A proxy with no size behind it (an older session, say) still helps the
	// preview, but there is nothing to tell the user about it.
	if (src.proxyFile) {
		return {
			kind: "ready",
			badge: "HD",
			title:
				"The preview plays a smaller copy of this video." +
				" Export reads the original, at full quality.",
		};
	}
	return { kind: "none" };
}

/** "1920×1080" — the × is a multiplication sign, not the letter. */
function size(width: number, height: number): string {
	return `${width}×${height}`;
}

function sourceSize(src: ProxyStatusInput): string {
	return src.width && src.height ? size(src.width, src.height) : "full size";
}

/**
 * Shorthand for the row count, the way a camera menu writes it. Rounded down
 * to the nearest familiar rung so an anamorphic or oddly cropped proxy still
 * reads as a number someone recognizes.
 */
export function shortRes(height: number): string {
	for (const rung of [2160, 1440, 1080, 720, 480, 360]) {
		if (height >= rung) return `${rung}p`;
	}
	return `${height}p`;
}

/** The worker's error text, trimmed to what fits in a sentence. */
function reason(text: string | undefined): string {
	if (!text) return "";
	const trimmed = text.replace(/^Error:\s*/, "").trim();
	if (!trimmed) return "";
	return `: ${trimmed.length > MAX_REASON ? `${trimmed.slice(0, MAX_REASON)}…` : trimmed}`;
}
