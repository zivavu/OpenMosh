import { afterEach, describe, expect, it } from "bun:test";
import { applyVolumeLinksToEffects } from "./audio-utils";
import { resetAutoRange } from "./auto-range";
import { buildSongProfile } from "./build-song-profile";
import {
	analyzeFrames,
	FFT_SIZE,
	SPECTRUM_MAX_DB,
	SPECTRUM_MIN_DB,
} from "./offline-audio";
import {
	activeSongProfile,
	publishSongProfile,
	songRideRange,
	stepBandHits,
	songProfileReady,
	type SongProfile,
} from "./song-profile";
import { resetSpectrumBars, stepSpectrumBars } from "./spectrum-bars";
import type { EffectInstance } from "../effects";

const RATE = 48000;
const INTRO = 10;
const DROP = 10;

/** A 60 Hz kick on every half second over a little hiss: quiet for the intro, 16 dB
 * louder for the drop. */
function song(): AudioBuffer {
	const pcm = new Float32Array((INTRO + DROP) * RATE);
	let seed = 1;
	for (let i = 0; i < pcm.length; i++) {
		const t = i / RATE;
		const amp = t < INTRO ? 0.05 : 0.32;
		const hit = Math.exp(-((t % 0.5) / 0.08));
		seed = (seed * 16807) % 2147483647;
		const hiss = (seed / 2147483647 - 0.5) * 0.004;
		pcm[i] = amp * hit * Math.sin(2 * Math.PI * 60 * t) + hiss;
	}
	return {
		numberOfChannels: 1,
		sampleRate: RATE,
		length: pcm.length,
		duration: pcm.length / RATE,
		getChannelData: () => pcm,
	} as unknown as AudioBuffer;
}

const buffer = song();
const profile = (await buildSongProfile(buffer))!;
const FPS = 30;
const frames = await analyzeFrames(
	buffer,
	Array.from({ length: (INTRO + DROP) * FPS }, (_, i) => i / FPS),
);

function lowLink(): EffectInstance {
	return {
		instanceId: "fx",
		defId: "audio-bars",
		enabled: true,
		locked: false,
		expanded: false,
		values: { height: 0 },
		volumeLinks: { height: { min: 0, max: 1, freqMin: 20, freqMax: 250 } },
	} as unknown as EffectInstance;
}

/** Play frames [from, to) seconds through a Low link and return what it rode. */
function ride(fx: EffectInstance, from: number, to: number): number[] {
	const out: number[] = [];
	for (let i = Math.round(from * FPS); i < Math.round(to * FPS); i++) {
		const f = frames[i];
		applyVolumeLinksToEffects(
			[fx],
			f.volumeLevel,
			f.frequencyData,
			RATE,
			FFT_SIZE,
			1 / FPS,
			{ smoothing: 0.45, punch: 0.4 },
		);
		out.push(fx.values.height as number);
	}
	return out;
}

async function use(p: SongProfile | null) {
	publishSongProfile(p ? async () => p : null);
	await songProfileReady();
}

afterEach(async () => {
	await use(null);
	resetAutoRange();
	resetSpectrumBars();
});

describe("song profile", () => {
	it("keeps an intro's link readings low", async () => {
		await use(profile);
		const range = songRideRange(profile, 20, 250, 0.45, 0.4);
		expect(range.ceil).toBeGreaterThan(range.floor);
		// Past the follower's first frames, which start from the raw level.
		const intro = ride(lowLink(), 2, INTRO).slice(10);
		expect(Math.max(...intro)).toBeLessThan(0.4);
	});

	it("lets a drop's beats swing a link most of its range", async () => {
		await use(profile);
		const drop = ride(lowLink(), INTRO + 2, INTRO + DROP);
		expect(Math.max(...drop)).toBeGreaterThan(0.8);
		expect(Math.min(...drop)).toBeLessThan(0.3);
	});

	it("lands the drop on its first kick", async () => {
		await use(profile);
		const fx = lowLink();
		ride(fx, INTRO - 2, INTRO);
		expect(Math.max(...ride(fx, INTRO, INTRO + 0.2))).toBeGreaterThan(0.9);
	});

	it("reads the intro the same at the start as after a trip to the drop", async () => {
		await use(profile);
		const fromStart = ride(lowLink(), 0, 6).slice(-15);
		resetAutoRange();
		const fx = lowLink();
		ride(fx, INTRO + 2, INTRO + 6);
		// A seek resets the followers, as the mixer's and the audio manager's do; the
		// follower then needs a moment to settle from its first frame.
		resetAutoRange();
		const afterDrop = ride(fx, 4, 6).slice(-15);
		fromStart.forEach((v, i) => expect(afterDrop[i]).toBeCloseTo(v, 2));
	});

	it("ignores history in the bars too, once their motion settles", async () => {
		await use(profile);
		const step = (i: number) =>
			stepSpectrumBars(
				"bars",
				frames[i].frequencyData,
				RATE,
				1 / FPS,
				32,
				0.45,
			);
		for (let i = 0; i < 6 * FPS; i++) step(i);
		const fromStart = Array.from(step(6 * FPS));
		resetSpectrumBars();
		for (let i = (INTRO + 2) * FPS; i < (INTRO + 6) * FPS; i++) step(i);
		resetSpectrumBars();
		let afterDrop: number[] = [];
		for (let i = 4 * FPS; i <= 6 * FPS; i++) afterDrop = Array.from(step(i));
		expect(afterDrop).toEqual(fromStart);
	});

	it("keeps the intro's bars well under the drop's", async () => {
		await use(profile);
		const tallest = (from: number, to: number) => {
			let top = 0;
			for (let i = from * FPS; i < to * FPS; i++) {
				const out = stepSpectrumBars(
					"tall",
					frames[i].frequencyData,
					RATE,
					1 / FPS,
					32,
					0.45,
				);
				for (let b = 0; b < out.length; b += 2) top = Math.max(top, out[b]);
			}
			return top / 255;
		};
		const intro = tallest(0, INTRO);
		const drop = tallest(INTRO, INTRO + DROP);
		expect(drop).toBeGreaterThan(0.6);
		expect(intro).toBeLessThan(drop / 2);
	});

	it("leaves out silent frames", async () => {
		const pcm = new Float32Array(4 * RATE);
		const silent = {
			numberOfChannels: 1,
			sampleRate: RATE,
			length: pcm.length,
			duration: 4,
			getChannelData: () => pcm,
		} as unknown as AudioBuffer;
		expect(await buildSongProfile(silent)).toBeNull();
	});
});

describe("stepBandHits", () => {
	/** A held bass over bins 0-9, with a kick lifting bins 2-5 on `kick` frames. */
	function frame(kick: boolean): Uint8Array {
		const f = new Uint8Array(10).fill(200);
		if (kick) f.fill(230, 2, 6);
		return f;
	}

	it("reads a kick over a held bass, and nothing from the bass alone", () => {
		const floors = new Float32Array(10).fill(-1);
		let held = 0;
		for (let i = 0; i < 60; i++)
			held = stepBandHits(frame(false), 0, 9, floors, 1 / 60);
		expect(held).toBe(0);
		expect(stepBandHits(frame(true), 0, 9, floors, 1 / 60)).toBeGreaterThan(
			0.5,
		);
	});

	it("stops counting a held note as a hit once it settles", () => {
		const floors = new Float32Array(10).fill(-1);
		stepBandHits(frame(false), 0, 9, floors, 1 / 60);
		const first = stepBandHits(frame(true), 0, 9, floors, 1 / 60);
		let later = first;
		for (let i = 0; i < 120; i++)
			later = stepBandHits(frame(true), 0, 9, floors, 1 / 60);
		// More than the 24 dB a range spans: it reads as nothing.
		const dbPerUnit = SPECTRUM_MAX_DB - SPECTRUM_MIN_DB;
		expect((first - later) * dbPerUnit).toBeGreaterThan(24);
	});
});

describe("publishSongProfile", () => {
	it("lets the latest song win over one still being analysed", async () => {
		const other = { ...profile, bands: new Map(), rides: new Map() };
		let release!: () => void;
		const slow = new Promise<void>((r) => (release = r));
		publishSongProfile(async () => {
			await slow;
			return other;
		});
		publishSongProfile(async () => profile);
		release();
		await songProfileReady();
		await slow;
		expect(activeSongProfile()).toBe(profile);
	});

	it("holds the previous profile until the next one is in", async () => {
		await use(profile);
		let release!: () => void;
		const slow = new Promise<void>((r) => (release = r));
		publishSongProfile(async () => {
			await slow;
			return null;
		});
		expect(activeSongProfile()).toBe(profile);
		release();
		await songProfileReady();
		expect(activeSongProfile()).toBeNull();
	});

	it("runs one analysis at a time, skipping any superseded before its turn", async () => {
		const other = { ...profile, bands: new Map(), rides: new Map() };
		const started: string[] = [];
		let release!: () => void;
		const slow = new Promise<void>((r) => (release = r));
		publishSongProfile(async () => {
			started.push("first");
			await slow;
			return profile;
		});
		publishSongProfile(async () => {
			started.push("second");
			return profile;
		});
		publishSongProfile(async () => {
			started.push("third");
			return other;
		});
		await Promise.resolve();
		expect(started).toEqual(["first"]);
		release();
		await songProfileReady();
		expect(started).toEqual(["first", "third"]);
		expect(activeSongProfile()).toBe(other);
	});
});
