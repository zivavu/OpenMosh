/** A whole song's levels, analysed once, so Audio Bars and the audio links place each
 * moment against the song's own quiet and loud parts rather than the last few seconds
 * played. That keeps an intro an intro, and makes a moment look the same however the
 * playhead got there, in preview and export alike. */

import { followerTaus } from "./auto-range";

/** Analysis rate: enough to catch every beat's level, cheap enough for a long song. */
export const PROFILE_FPS = 20;
/** Where a link band's range starts and ends across the song. */
const LINK_FLOOR_PERCENTILE = 0.05;
const LINK_CEIL_PERCENTILE = 0.98;
/** A stretch about a bar of music long, over which a band's beat-to-beat swing is read. */
const SWING_WINDOW = 2 * PROFILE_FPS;
/** Stretches whose peak reaches this percentile count as the song's loud parts. */
const LOUD_STRETCH_PERCENTILE = 0.6;
/** Smallest band range a link stretches to full scale, as in auto-range. */
const MIN_LINK_SPAN = 0.06;

export interface SongProfile {
	sampleRate: number;
	fftSize: number;
	/** Each bin's level at the song's loud parts, 0-255 on the analysers' scale. */
	loud: Uint8Array;
	/** The song's non-silent frames, for working out a link band's range on demand. */
	frames: Uint8Array[];
	/** Link ranges already worked out, keyed by band and smoothing. */
	ranges: Map<string, { floor: number; ceil: number }>;
}

/** Mean of the bins covering [freqMin, freqMax], 0-1: the level a link band rides. */
export function getLevelFromFrequencyRange(
	freqData: Uint8Array,
	sampleRate: number,
	fftSize: number,
	freqMin: number,
	freqMax: number,
): number {
	const binCount = freqData.length;
	const minBin = Math.max(0, Math.floor((freqMin / sampleRate) * fftSize));
	const maxBin = Math.min(
		binCount - 1,
		Math.ceil((freqMax / sampleRate) * fftSize),
	);
	if (minBin > maxBin) return 0;
	let sum = 0;
	for (let i = minBin; i <= maxBin; i++) sum += freqData[i];
	const count = maxBin - minBin + 1;
	return Math.min(1, sum / count / 255);
}

/** Where a link band sits across the song, after the same follower the live level
 * goes through, so a slow Smoothing doesn't leave the top of the range unreachable. */
export function songLinkRange(
	profile: SongProfile,
	freqMin: number,
	freqMax: number,
	smoothing: number,
): { floor: number; ceil: number } {
	const key = `${freqMin}:${freqMax}:${smoothing}`;
	let range = profile.ranges.get(key);
	if (range) return range;
	const { attack, release } = followerTaus(smoothing);
	const dt = 1 / PROFILE_FPS;
	const upK = 1 - Math.exp(-dt / attack);
	const downK = 1 - Math.exp(-dt / release);
	const levels = new Float32Array(profile.frames.length);
	let env = -1;
	profile.frames.forEach((frame, i) => {
		const v = getLevelFromFrequencyRange(
			frame,
			profile.sampleRate,
			profile.fftSize,
			freqMin,
			freqMax,
		);
		env = env < 0 ? v : env + (v - env) * (v > env ? upK : downK);
		levels[i] = env;
	});
	const sorted = levels.slice().sort();
	const at = (p: number) => sorted[Math.floor((sorted.length - 1) * p)];
	const ceil = at(LINK_CEIL_PERCENTILE);
	const loudPeak = at(LOUD_STRETCH_PERCENTILE);
	// The window hangs a loud stretch's typical swing below the song's top, so a drop's
	// beats cross all of it and a quieter part sits under it.
	const swings: number[] = [];
	for (let start = 0; start < levels.length; start += SWING_WINDOW) {
		const stretch = levels.subarray(start, start + SWING_WINDOW);
		let lo = Infinity;
		let hi = -Infinity;
		for (const v of stretch) {
			if (v < lo) lo = v;
			if (v > hi) hi = v;
		}
		if (hi >= loudPeak) swings.push(hi - lo);
	}
	swings.sort((a, b) => a - b);
	const swing = swings.length > 0 ? swings[swings.length >> 1] : ceil;
	const floor = Math.min(
		Math.max(ceil - swing, at(LINK_FLOOR_PERCENTILE)),
		ceil - MIN_LINK_SPAN,
	);
	range = { floor, ceil };
	profile.ranges.set(key, range);
	return range;
}

let active: SongProfile | null = null;
let pending: Promise<unknown> | null = null;
let token = 0;

/** The profile of the song on screen, or null until it's analysed or with no song. */
export function activeSongProfile(): SongProfile | null {
	return active;
}

/** Make `load`'s profile the active one once it resolves; the previous one holds
 * until then, so a mix edit doesn't flicker. A later call supersedes an earlier one
 * still loading; pass null to clear. */
export function publishSongProfile(
	load: (() => Promise<SongProfile | null>) | null,
): void {
	const mine = ++token;
	if (!load) {
		active = null;
		pending = null;
		return;
	}
	const run = load().then(
		(profile) => {
			if (mine === token) active = profile;
		},
		() => {
			if (mine === token) active = null;
		},
	);
	pending = run;
	void run.finally(() => {
		if (pending === run) pending = null;
	});
}

/** Resolves once the profile being analysed is in, so an export doesn't start on the
 * fallback while the preview it should match uses the profile. */
export async function songProfileReady(): Promise<void> {
	while (pending) await pending;
}
