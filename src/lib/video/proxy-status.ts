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
	/**
	 * The user asked this video to preview from the original. Only ever set on
	 * media a proxy would otherwise be built for, so it doubles as "this one is
	 * big enough for the choice to mean something".
	 */
	proxyDisabled?: boolean;
}

/**
 * What clicking the badge does. Carried beside the status so every surface
 * offers the same action for the same state, and so the one surface that can't
 * take a click (the rail chip, which is already a button) can leave it out
 * without its tooltip promising one.
 */
export interface ProxyAction {
	kind: "disable" | "enable" | "retry";
	/** Appended to the tooltip on a surface where the badge is clickable. */
	hint: string;
}

const DISABLE_RUNNING: ProxyAction = {
	kind: "disable",
	hint: "Click to stop and preview from the original.",
};
const DISABLE_READY: ProxyAction = {
	kind: "disable",
	hint: "Click to preview from the original instead.",
};
const ENABLE: ProxyAction = {
	kind: "enable",
	hint: "Click to make a smaller copy to preview from.",
};
const RETRY: ProxyAction = { kind: "retry", hint: "Click to try again." };

export type ProxyStatus =
	| { kind: "none" }
	| { kind: "pending"; badge: string; title: string; action: ProxyAction }
	| { kind: "ready"; badge: string; title: string; action: ProxyAction }
	| { kind: "failed"; badge: string; title: string; action: ProxyAction }
	| { kind: "off"; badge: string; title: string; action: ProxyAction };

/** Longest error text a tooltip will carry before it stops being readable. */
const MAX_REASON = 120;

export function proxyStatus(src: ProxyStatusInput): ProxyStatus {
	// Checked first: the choice outranks whatever a job left behind, and a
	// cancelled transcode's leftovers shouldn't keep reading as in progress.
	if (src.proxyDisabled) {
		return {
			kind: "off",
			badge: src.height ? shortRes(src.height) : "OFF",
			title:
				`The preview plays the ${sourceSize(src)} original of this video,` +
				" at full quality, which may stutter. Export is unaffected.",
			action: ENABLE,
		};
	}
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
				action: DISABLE_RUNNING,
			};
		}
		return {
			kind: "pending",
			badge: percent === null ? "…" : `${percent}%`,
			title:
				`Making a ${size(src.proxyWidth, src.proxyHeight)} copy to preview from` +
				`${percent === null ? "" : `, ${percent}% of the way through`}.` +
				` The preview plays the ${sourceSize(src)} original until it lands.`,
			action: DISABLE_RUNNING,
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
			action: RETRY,
		};
	}
	if (src.proxyFile && src.proxyWidth && src.proxyHeight) {
		return {
			kind: "ready",
			badge: shortRes(src.proxyHeight),
			title:
				`The preview plays a ${size(src.proxyWidth, src.proxyHeight)} copy of this video.` +
				` Export reads the ${sourceSize(src)} original, at full quality.`,
			action: DISABLE_READY,
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
			action: DISABLE_READY,
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
