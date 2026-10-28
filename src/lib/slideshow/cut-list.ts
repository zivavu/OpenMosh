import type { Cut, CutList } from "../media/cut-list";
import { beatAtTime, getSubdivisionAt } from "./beat-clock";
import type { SlideshowConfig } from "./types";

/** Bounds a broken tempo; a long song at the finest subdivision stays well under. */
const MAX_CUTS = 500_000;

export interface FreezeOptions {
	config: SlideshowConfig;
	name: string;
	sessionKey: string;
	/** Pool source ids, in slide order. */
	slideIds: string[];
	/** Seconds on the song (or the songless clock) the slideshow plays. */
	span: { start: number; end: number };
}

/** The slideshow as the editor plays it: every beat its frame driver would cut on. */
export function freezeSlideshow(opts: FreezeOptions): CutList {
	const { config, span } = opts;
	return {
		version: 1,
		name: opts.name,
		sessionKey: opts.sessionKey,
		duration: Math.max(0.001, span.end - span.start),
		songStart: span.start,
		bpm: config.bpm > 0 ? config.bpm : 120,
		beatOffset: beatOffsetFrom(config, span.start),
		slides: opts.slideIds,
		cuts: freezeCuts(config, opts.slideIds.length, span),
	};
}

function beatOffsetFrom(config: SlideshowConfig, start: number): number {
	const beat = 60 / (config.bpm > 0 ? config.bpm : 120);
	return (((config.beatOffset - start) % beat) + beat) % beat;
}

/** Each beat in `span`, relative to its start. A beat lands where `beatAtTime`'s index
 * changes: on the active subdivision's grid, or at a segment boundary. */
export function freezeCuts(
	config: SlideshowConfig,
	slideCount: number,
	span: { start: number; end: number },
): Cut[] {
	if (slideCount === 0) return [];
	if (!(config.bpm > 0) || !Number.isFinite(config.bpm)) return [[0, 0]];
	const { start, end } = span;
	const { segments, beatOffset, subdivision } = config;
	const edges = new Set([start]);
	for (const seg of segments) {
		for (const t of [seg.startTime, seg.endTime ?? Infinity]) {
			if (t > start && t < end) edges.add(t);
		}
	}
	const bounds = [...edges].sort((a, b) => a - b);

	const cuts: Cut[] = [];
	let last = -1;
	const cutAt = (t: number, index: number) => {
		if (index === last) return;
		last = index;
		cuts.push([t - start, index % slideCount]);
	};
	for (let i = 0; i < bounds.length && cuts.length < MAX_CUTS; i++) {
		const a = bounds[i];
		const b = bounds[i + 1] ?? end;
		const sub = getSubdivisionAt(a, segments, subdivision);
		// A stop holds the slide on screen.
		if (sub === 0) continue;
		cutAt(
			a,
			beatAtTime(a, config.bpm, beatOffset, segments, subdivision).index,
		);
		const beat = (60 / config.bpm) * sub;
		let k = Math.floor(Math.max(0, a - beatOffset) / beat) + 1;
		for (; cuts.length < MAX_CUTS; k++) {
			const t = beatOffset + k * beat;
			if (t >= b) break;
			cutAt(t, k);
		}
	}
	// Opening on a stop shows the first slide until a beat comes.
	if (cuts[0]?.[0] !== 0) cuts.unshift([0, 0]);
	return cuts;
}
