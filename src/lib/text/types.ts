import { restoreEffects } from "../effects";
import type { EffectInstance } from "../effects/types";
import {
	normalizeChainFields,
	splitChainClipAt,
	type ChainClip,
} from "../editor/chain-clip";
import { cleanEffects, handBuiltLabel } from "../editor/sequence";
// From the module, not the barrel: that re-exports the custom-font store, whose
// runes break outside a Svelte build.
import { FONT_OPTIONS } from "../text-overlay/fonts";
import type { TextOverlayBlendMode } from "../text-overlay/types";
import { clipFadeWeight, fitClipsToDuration } from "../timeline/clips";

export type TextAlign = "left" | "center" | "right";

export { MIN_CLIP_LENGTH } from "../timeline/clips";

export interface TextStyle {
	/** Anchor position, normalized (x: left→right, y: top→bottom). */
	x: number;
	y: number;
	/** Font size as a fraction of frame height. */
	size: number;
	/** CSS font-family value (see text-overlay/fonts.ts). */
	fontFamily: string;
	align: TextAlign;
	color: string;
	outline: boolean;
	outlineColor: string;
	/** Stroke width, in px at a 720px reference height (scaled to actual size). */
	outlineWidth: number;
	/** 0..1, applied by the GL composite rather than the 2D canvas. */
	opacity: number;
	blendMode: TextOverlayBlendMode;
}

/** One span of text on a lane. A chain clip: its effects run on this clip's text
 * alone, before it meets the image. */
export interface TextClip extends ChainClip {
	text: string;
	/** Ramp in over `fadeInSec` after the start and out over `fadeOutSec` before the
	 * end, each edge on its own. Absent means no ramp. */
	fadeInSec?: number;
	fadeOutSec?: number;
}

/** How strongly the clip shows at `time`, 1 unless a fade is ramping. */
export function textClipWeight(clip: TextClip, time: number): number {
	return clipFadeWeight(clip, clip.fadeInSec, clip.fadeOutSec, time);
}

/** A text layer. Clips within a lane never overlap, so a lane shows at most one
 * clip at a time and drag/resize stay unambiguous. */
export interface TextLane {
	id: string;
	name: string;
	enabled: boolean;
	/** Composite before the main chain rather than over the finished frame, so every
	 * image effect distorts this layer too. */
	underEffects: boolean;
	/** Order among *all* layers, text and media alike. Higher sits on top. */
	z: number;
	style: TextStyle;
	clips: TextClip[];
}

export interface TextTimeline {
	enabled: boolean;
	lanes: TextLane[];
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
	x: 0.5,
	y: 0.5,
	size: 0.1,
	fontFamily: FONT_OPTIONS[0].family,
	align: "center",
	color: "#ffffff",
	outline: true,
	outlineColor: "#000000",
	outlineWidth: 2,
	opacity: 1,
	blendMode: "normal",
};

export const EMPTY_TEXT_TIMELINE: TextTimeline = { enabled: false, lanes: [] };

let idCounter = 0;
function nextId(prefix: string): string {
	idCounter += 1;
	return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function createTextClip(
	start: number,
	end: number,
	text = "",
): TextClip {
	return {
		id: nextId("clip"),
		start,
		end,
		text,
		mode: "static",
		label: "clean",
		// Same all-disabled list the main chain starts from, so the panel can switch things on.
		effects: cleanEffects(),
	};
}

/** Cut the clip covering `at` in two, each keeping the text. Returns the lane
 * unchanged when `at` is outside a clip. */
export function splitTextClipAt(lane: TextLane, at: number): TextLane {
	return splitChainClipAt(lane, at, () => nextId("clip"));
}

export function createTextLane(
	name: string,
	z = 0,
	style: TextStyle = DEFAULT_TEXT_STYLE,
): TextLane {
	return {
		id: nextId("lane"),
		name,
		enabled: true,
		underEffects: false,
		z,
		style: { ...style },
		clips: [],
	};
}

export function createTextTimeline(z = TEXT_Z_BASE): TextTimeline {
	return { enabled: true, lanes: [createTextLane("Text 1", z)] };
}

/** Add an empty lane, named after its position. `z` comes from the caller: the
 * order spans the media lanes too, which this timeline can't see. */
export function appendTextLane(
	timeline: TextTimeline,
	z = TEXT_Z_BASE,
): TextTimeline {
	return {
		...timeline,
		lanes: [
			...timeline.lanes,
			createTextLane(`Text ${timeline.lanes.length + 1}`, z),
		],
	};
}

/** Where text lanes start in the shared layer order: above the media lanes, where
 * they sat before the orders merged. */
export const TEXT_Z_BASE = 1000;

/** A clip saved with no chain at all is backfilled, not left switch-less. */
function clipEffects(saved: unknown): EffectInstance[] {
	const hydrated = restoreEffects(saved);
	return hydrated.length > 0 ? hydrated : cleanEffects();
}

function legacyChainIndex(lane: object): number {
	const raw = (lane as { chainIndex?: unknown }).chainIndex;
	return typeof raw === "number" ? raw : Number.MAX_SAFE_INTEGER;
}

/** Fill in anything a saved timeline predates or dropped. */
export function normalizeTextTimeline(raw: unknown): TextTimeline {
	if (!raw || typeof raw !== "object") return { ...EMPTY_TEXT_TIMELINE };
	const t = raw as Partial<TextTimeline>;
	const lanes = Array.isArray(t.lanes) ? t.lanes : [];
	return {
		enabled: !!t.enabled,
		lanes: lanes.map((lane, i) => {
			const clips = Array.isArray(lane.clips) ? lane.clips : [];
			// Timelines saved before styles moved to the lane carried one per clip; the first
			// clip's style stands in for the lane's.
			const legacyStyle = (clips as Array<{ style?: TextStyle }>).find(
				(c) => c.style,
			)?.style;
			return {
				id: lane.id ?? nextId("lane"),
				name: lane.name ?? `Text ${i + 1}`,
				enabled: lane.enabled !== false,
				// Old timelines carry a chain index instead: 0 meant "under every effect".
				underEffects: lane.underEffects ?? legacyChainIndex(lane) === 0,
				z: typeof lane.z === "number" ? lane.z : TEXT_Z_BASE + i,
				style: { ...DEFAULT_TEXT_STYLE, ...(lane.style ?? legacyStyle) },
				clips: clips.map((clip) => {
					// Lanes saved before clips carried their own chain held one for the whole lane:
					// every clip inherits a copy.
					const legacyChain = (lane as { effects?: unknown }).effects;
					const effects = Array.isArray(clip.effects)
						? clipEffects(clip.effects)
						: clipEffects(legacyChain);
					const out: TextClip = {
						id: clip.id ?? nextId("clip"),
						start: clip.start ?? 0,
						end: clip.end ?? 0,
						text: clip.text ?? "",
						...normalizeChainFields(clip, effects),
					};
					// An inherited chain has no label: name it by what it switches on.
					if (!Array.isArray(clip.effects) && !clip.label)
						out.label = handBuiltLabel(effects);
					if (clip.fadeInSec! > 0) out.fadeInSec = clip.fadeInSec;
					if (clip.fadeOutSec! > 0) out.fadeOutSec = clip.fadeOutSec;
					return out;
				}),
			};
		}),
	};
}

/** See fitMediaTimeline: the same re-fit, for the text lanes. */
export function fitTextTimeline(
	timeline: TextTimeline,
	duration: number,
): TextTimeline {
	if (duration <= 0 || timeline.lanes.length === 0) return timeline;
	const lanes = timeline.lanes.map((lane) =>
		fitClipsToDuration(lane, duration),
	);
	return lanes.some((l, i) => l !== timeline.lanes[i])
		? { ...timeline, lanes }
		: timeline;
}
