import { FREQ_PRESETS, getDefinition, type EffectInstance } from "../effects";
import {
	autoRangeLevel,
	hitFloorsOf,
	rideExponent,
	smoothBandLevel,
	type AudioResponse,
} from "./auto-range";
import {
	activeSongProfile,
	bandBins,
	blendBand,
	getLevelFromFrequencyRange,
	placeInRange,
	songBand,
	songRideRange,
	stepBandHits,
} from "./song-profile";

export { getLevelFromFrequencyRange };

export function bandKey(
	scope: string,
	freqMin: number,
	freqMax: number,
): string {
	return `${scope}|${freqMin}:${freqMax}`;
}

/** What a link on [freqMin, freqMax] rides this frame, 0-1, before Punch's curve: the
 * band's loudness and hits blended by Punch, followed by Smoothing and placed in the
 * song's range. Steps the band's state under `key`, so call it once per band a frame. */
export function bandRideLevel(
	key: string,
	frequencyData: Uint8Array | null,
	volumeLevel: number,
	sampleRate: number,
	fftSize: number,
	freqMin: number,
	freqMax: number,
	dt: number,
	response: AudioResponse,
): number {
	if (!frequencyData || sampleRate <= 0) {
		const level = smoothBandLevel(key, volumeLevel, dt, response.smoothing);
		return autoRangeLevel(key, level, dt);
	}
	const level = getLevelFromFrequencyRange(
		frequencyData,
		sampleRate,
		fftSize,
		freqMin,
		freqMax,
	);
	const { first, last } = bandBins(
		frequencyData.length,
		sampleRate,
		fftSize,
		freqMin,
		freqMax,
	);
	const hits = stepBandHits(
		frequencyData,
		first,
		last,
		hitFloorsOf(key, Math.max(0, last - first + 1)),
		dt,
	);
	const profile = activeSongProfile();
	if (!profile) {
		// Until the song is analysed, each reading learns its range as it plays.
		const body = autoRangeLevel(`${key}|level`, level, dt);
		const hit = autoRangeLevel(`${key}|hits`, hits, dt);
		const blend = body + (hit - body) * response.punch;
		return smoothBandLevel(key, blend, dt, response.smoothing);
	}
	const band = songBand(profile, freqMin, freqMax);
	const ride = smoothBandLevel(
		key,
		blendBand(level, hits, band, response.punch),
		dt,
		response.smoothing,
	);
	return placeInRange(
		ride,
		songRideRange(
			profile,
			freqMin,
			freqMax,
			response.smoothing,
			response.punch,
		),
	);
}

/** Scratch for applyVolumeLinksToEffects; valid only within one call. */
const perBand = new Map<string, number>();

/** A set of effects that follows the music its own way, with its own response and scope. */
export interface AudioLinkGroup {
	/** Namespaces the per-band envelope state. Lanes pass their lane id. */
	scope: string;
	effects: EffectInstance[];
	response: AudioResponse;
}

/** `dt` and `response` must match between preview and export, or a render won't match. */
export function applyVolumeLinksToEffects(
	effects: EffectInstance[],
	volumeLevel: number,
	frequencyData: Uint8Array | null,
	sampleRate: number,
	fftSize: number,
	dt: number,
	response: AudioResponse,
	scope: string = "",
): void {
	const exponent = rideExponent(response.punch);
	// Cached so a band's state advances once per frame, not once per link.
	perBand.clear();
	const levelForBand = (freqMin: number, freqMax: number): number => {
		const key = bandKey(scope, freqMin, freqMax);
		const cached = perBand.get(key);
		if (cached !== undefined) return cached;
		const level = bandRideLevel(
			key,
			frequencyData,
			volumeLevel,
			sampleRate,
			fftSize,
			freqMin,
			freqMax,
			dt,
			response,
		);
		perBand.set(key, level);
		return level;
	};

	for (const effect of effects) {
		const links = effect.volumeLinks;
		if (!links) continue;
		const def = getDefinition(effect.defId);
		if (!def) continue;
		for (const param of def.params) {
			if (param.type !== "range") continue;
			const link = links[param.key];
			if (!link) continue;
			let level = levelForBand(
				link.freqMin ?? FREQ_PRESETS.full.min,
				link.freqMax ?? FREQ_PRESETS.full.max,
			);
			// Shape before inverting, so inverted is the mirror of the same response.
			level = level ** exponent;
			if (link.inverted) level = 1 - level;
			const { min: pMin, max: pMax, step } = param;
			let value = link.min + level * (link.max - link.min);
			value = Math.max(pMin, Math.min(pMax, value));
			if (step > 0) {
				value = Math.round((value - pMin) / step) * step + pMin;
				value = Math.max(pMin, Math.min(pMax, value));
			}
			effect.values[param.key] = value;
		}
	}
}

export function formatTime(sec: number): string {
	if (!Number.isFinite(sec) || sec < 0) return "0:00";
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${s.toString().padStart(2, "0")}`;
}

/** m:ss.mmm for the playhead readout, where a frame is ~16ms. */
export function formatTimeMs(sec: number): string {
	if (!Number.isFinite(sec) || sec < 0) return "0:00.000";
	const ms = Math.floor((sec % 1) * 1000);
	return `${formatTime(sec)}.${ms.toString().padStart(3, "0")}`;
}

/** Resume a context that isn't running: suspended, or Safari's "interrupted" after a
 * call or Siri, which never turns back into "suspended". */
export function wakeAudioContext(ctx: AudioContext) {
	if (ctx.state !== "running" && ctx.state !== "closed")
		void ctx.resume().catch(() => {});
}
