/** Analyses a song into a `SongProfile`; kept apart from it so the link code can
 * read profiles without importing the offline analyser. */

import {
	analyzeFrames,
	FFT_SIZE,
	SPECTRUM_MAX_DB,
	SPECTRUM_MIN_DB,
} from "./offline-audio";
import { PROFILE_FPS, type SongProfile } from "./song-profile";

/** A frame whose loudest bin is below this is silence, a gap or a fade's last breath,
 * and would only drag the quiet end of every range down to nothing. */
const SILENT_BYTE = 12;
/** Where "the loud parts" sit: a level only the song's peaks reach. */
const LOUD_PERCENTILE = 0.97;

/** Profile of `buffer` as heard through a gain (the track's normalize gain). */
export async function buildSongProfile(
	buffer: AudioBuffer,
	gain = 1,
): Promise<SongProfile | null> {
	const count = Math.floor(buffer.duration * PROFILE_FPS);
	if (count <= 0) return null;
	const times = Array.from({ length: count }, (_, i) => i / PROFILE_FPS);
	const analysed = await analyzeFrames(buffer, times, FFT_SIZE);
	const offset =
		gain > 0 && gain !== 1
			? (20 * Math.log10(gain) * 255) / (SPECTRUM_MAX_DB - SPECTRUM_MIN_DB)
			: 0;

	const bins = FFT_SIZE / 2;
	const histogram = new Uint32Array(bins * 256);
	const frames: Uint8Array[] = [];
	for (const { frequencyData } of analysed) {
		let max = 0;
		for (let i = 0; i < bins; i++) {
			let v = frequencyData[i];
			if (offset !== 0 && v > 0) {
				v = Math.max(0, Math.min(255, Math.round(v + offset)));
				frequencyData[i] = v;
			}
			if (v > max) max = v;
		}
		if (max < SILENT_BYTE) continue;
		frames.push(frequencyData);
		for (let i = 0; i < bins; i++) histogram[i * 256 + frequencyData[i]]++;
	}
	if (frames.length === 0) return null;

	const loud = new Uint8Array(bins);
	const rank = Math.floor((frames.length - 1) * LOUD_PERCENTILE);
	for (let i = 0; i < bins; i++) {
		let seen = 0;
		for (let v = 0; v < 256; v++) {
			seen += histogram[i * 256 + v];
			if (seen > rank) {
				loud[i] = v;
				break;
			}
		}
	}
	return {
		sampleRate: buffer.sampleRate,
		fftSize: FFT_SIZE,
		loud,
		frames,
		ranges: new Map(),
	};
}

const fileProfiles = new WeakMap<
	AudioBuffer,
	Map<number, Promise<SongProfile | null>>
>();

/** Profile of a decoded file at a gain, analysed once per buffer and gain. */
export function songProfileOf(
	buffer: AudioBuffer,
	gain = 1,
): Promise<SongProfile | null> {
	let byGain = fileProfiles.get(buffer);
	if (!byGain) {
		byGain = new Map();
		fileProfiles.set(buffer, byGain);
	}
	let profile = byGain.get(gain);
	if (!profile) {
		profile = buildSongProfile(buffer, gain);
		byGain.set(gain, profile);
	}
	return profile;
}
