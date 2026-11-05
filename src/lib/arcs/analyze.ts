/** Reads a song for Arcs. Apart from `controls.ts`: the analyser brings in the effects
 * catalog, which the renderer can't import back. */

import { analyzeFrames, FFT_SIZE } from "../audio/offline-audio";
import { PROFILE_FPS, songBand, type SongProfile } from "../audio/song-profile";
import type { SongAudio } from "./controls";

const LOW_BAND = [30, 140] as const;
const MID_BAND = [250, 2500] as const;
const HIGH_BAND = [5000, 14000] as const;

/** Unlike `buildSongProfile` this keeps silent frames: the table is indexed by time. */
export async function analyzeDrive(
	drive: AudioBuffer,
	onProgress?: (p: number) => void,
): Promise<SongAudio> {
	const frames = Math.floor(drive.duration * PROFILE_FPS);
	const times = Array.from({ length: frames }, (_, i) => i / PROFILE_FPS);
	const analysed = await analyzeFrames(drive, times, FFT_SIZE, onProgress);
	const profile: SongProfile = {
		sampleRate: drive.sampleRate,
		fftSize: FFT_SIZE,
		loud: new Uint8Array(0),
		frames: analysed.map((f) => f.frequencyData),
		bands: new Map(),
		rides: new Map(),
	};
	return {
		duration: drive.duration,
		frames,
		low: songBand(profile, ...LOW_BAND),
		mid: songBand(profile, ...MID_BAND),
		high: songBand(profile, ...HIGH_BAND),
	};
}
