/** A slideshow frozen into a pool source: its slides and the beat each one cuts in on.
 * The editor plays it like a video whose frames are other pool media. */

export const CUT_LIST_TYPE = "application/vnd.openmosh.cuts+json";
const CUT_LIST_SUFFIX = ".cuts.json";
/** Far past a long song cut on the finest subdivision. */
const MAX_CUT_LIST_BYTES = 16 * 1024 * 1024;

/** When a beat starts, in seconds from the cut list's start, and its index into `slides`. */
export type Cut = [t: number, slide: number];

export interface CutList {
	version: 1;
	/** The slideshow's name when it was frozen. */
	name: string;
	/** The slideshow session it came from, to freeze it again. */
	sessionKey: string;
	/** Seconds; the cut list wraps here like a video. */
	duration: number;
	/** Where on its song the cut list starts: video slides play at song time. */
	songStart: number;
	/** The slideshow's own tempo; the editor's BPM never retimes it. */
	bpm: number;
	/** Seconds from the cut list's start to a beat. */
	beatOffset: number;
	/** Pool source ids. */
	slides: string[];
	/** Ascending, the first at 0. */
	cuts: Cut[];
}

export function isCutListFile(file: File): boolean {
	return file.type === CUT_LIST_TYPE || file.name.endsWith(CUT_LIST_SUFFIX);
}

export function cutListFile(list: CutList): File {
	return new File([JSON.stringify(list)], list.name + CUT_LIST_SUFFIX, {
		type: CUT_LIST_TYPE,
	});
}

/** Null for a file too large, unreadable, or not a cut list. */
export async function readCutList(file: File): Promise<CutList | null> {
	if (file.size > MAX_CUT_LIST_BYTES) return null;
	try {
		return parseCutList(await file.text());
	} catch {
		return null;
	}
}

const isTime = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Null unless every field holds up: a project file can carry a crafted one. */
export function parseCutList(text: string): CutList | null {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	const list = raw as Partial<CutList> | null;
	if (!list || typeof list !== "object" || list.version !== 1) return null;
	if (typeof list.name !== "string" || typeof list.sessionKey !== "string") {
		return null;
	}
	if (!isTime(list.duration) || list.duration === 0) return null;
	if (!isTime(list.songStart) || !isTime(list.beatOffset)) return null;
	if (!isTime(list.bpm) || list.bpm === 0) return null;
	const { slides, cuts } = list;
	if (!Array.isArray(slides) || slides.length === 0) return null;
	if (!slides.every((s) => typeof s === "string")) return null;
	if (!Array.isArray(cuts) || cuts.length === 0) return null;
	let last = 0;
	for (const cut of cuts as unknown[]) {
		if (!Array.isArray(cut) || cut.length !== 2) return null;
		const [t, slide] = cut as unknown[];
		if (!isTime(t) || t < last) return null;
		if (!Number.isInteger(slide) || (slide as number) < 0) return null;
		if ((slide as number) >= slides.length) return null;
		last = t;
	}
	if (cuts[0][0] !== 0) return null;
	return {
		version: 1,
		name: list.name,
		sessionKey: list.sessionKey,
		duration: list.duration,
		songStart: list.songStart,
		bpm: list.bpm,
		beatOffset: list.beatOffset,
		slides,
		cuts,
	};
}

export interface CutPosition {
	/** Counts on across loops, so each pass rolls its own moshes. */
	tick: number;
	slideId: string;
	/** Where the slide is in its own media: song time, as the slideshow plays it. */
	slideTime: number;
}

/** The beat on screen at `sourceTime`. */
export function cutAt(list: CutList, sourceTime: number): CutPosition {
	const loop = Math.floor(Math.max(0, sourceTime) / list.duration);
	const local = Math.max(0, sourceTime) - loop * list.duration;
	const { cuts } = list;
	let lo = 0;
	let hi = cuts.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (cuts[mid][0] <= local) lo = mid;
		else hi = mid - 1;
	}
	return {
		tick: loop * cuts.length + lo,
		slideId: list.slides[cuts[lo][1]],
		slideTime: local + list.songStart,
	};
}

/** Where a layer is in its media once a cut list hands over to the slide on screen.
 * Anything else passes through. A slide never bounces. */
export function throughCuts<S extends { kind: string; cutList?: CutList }, B>(
	src: S | undefined,
	sourceTime: number,
	bounce: B | undefined,
	get: (id: string) => S | undefined,
): { src: S | undefined; sourceTime: number; bounce: B | undefined } {
	if (src?.kind !== "cuts" || !src.cutList) {
		return { src, sourceTime, bounce };
	}
	const at = cutAt(src.cutList, sourceTime);
	return { src: get(at.slideId), sourceTime: at.slideTime, bounce: undefined };
}
