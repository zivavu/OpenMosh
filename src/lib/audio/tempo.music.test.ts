import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	estimateTempo,
	FRAMES_PER_SECOND,
	gridFit,
	onsetEnvelope,
} from "./tempo";

/** Local-only benchmark over the untracked songs in test_music/, against the results
 * essentia's RhythmExtractor2013 gave for them. Run with `bun run test:bpm`. */
const MUSIC_DIR = resolve(import.meta.dir, "../../../test_music");
const TRUTH_FILE = join(MUSIC_DIR, "essentia-bpm.json");
const SAMPLE_RATE = 44100;

type Truth = Record<
	string,
	{ bpm: number; confidence: number; offset?: number }
>;

function decode(file: string): Float32Array {
	const out = spawnSync(
		"ffmpeg",
		[
			...["-v", "error", "-i", file],
			...["-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "f32le", "-"],
		],
		{ maxBuffer: 1 << 30 },
	);
	if (out.status !== 0) throw new Error(String(out.stderr));
	const buf = out.stdout as Buffer;
	return new Float32Array(
		buf.buffer,
		buf.byteOffset,
		buf.byteLength / 4,
	).slice();
}

/** Distance between two beat grids' phases, in seconds. */
function phaseGap(a: number, b: number, bpm: number): number {
	const beat = 60 / bpm;
	const d = (((a - b) % beat) + beat) % beat;
	return Math.min(d, beat - d);
}

/** Mean onset strength on a beat grid; offsets are shifted back by the half-frame
 * the detector adds, into envelope frames. */
function beatStrength(env: Float64Array, bpm: number, offset: number): number {
	const period = (FRAMES_PER_SECOND * 60) / bpm;
	const start = (offset - 1024 / SAMPLE_RATE) * FRAMES_PER_SECOND;
	let sum = 0;
	let n = 0;
	for (
		let t = ((start % period) + period) % period;
		t < env.length;
		t += period, n++
	)
		sum += env[Math.round(t)] ?? 0;
	return sum / (n || 1);
}

const enabled = !!process.env.BPM_MUSIC && existsSync(MUSIC_DIR);

describe.skipIf(!enabled)("tempo vs essentia", () => {
	test(
		"agrees with essentia, or locks to the beat tighter",
		async () => {
			const truth: Truth = existsSync(TRUTH_FILE)
				? JSON.parse(readFileSync(TRUTH_FILE, "utf8"))
				: {};
			const songs = readdirSync(MUSIC_DIR).filter((f) =>
				/\.(mp3|wav|flac|ogg|m4a)$/i.test(f),
			);
			const rows: string[] = [];
			const failures: string[] = [];
			for (const song of songs) {
				const samples = decode(join(MUSIC_DIR, song));
				if (truth[song]?.offset === undefined) {
					truth[song] = await essentia(samples);
					writeFileSync(TRUTH_FILE, JSON.stringify(truth, null, "\t"));
				}
				const ref = truth[song];
				const t0 = performance.now();
				const ours = estimateTempo(samples, SAMPLE_RATE);
				const ms = performance.now() - t0;

				const env = onsetEnvelope(samples, SAMPLE_RATE);
				const fit = (bpm: number) =>
					gridFit(env, (FRAMES_PER_SECOND * 60) / bpm).score;
				const near = (a: number, b: number) => Math.abs(a - b) / b < 0.015;
				let verdict: string;
				if (Math.abs(Math.round(ours.bpm) - Math.round(ref.bpm)) <= 1) {
					// Essentia's first tick is often its tracker warming up, so a phase gap
					// only counts against us when its beat lands on stronger onsets.
					const gap = phaseGap(ours.offset, ref.offset!, ours.bpm);
					const mine = beatStrength(env, ours.bpm, ours.offset);
					const theirs = beatStrength(env, ours.bpm, ref.offset!);
					if (gap < 0.05) verdict = "match";
					else if (mine >= theirs)
						verdict = `match, our beat ${(mine / theirs).toFixed(1)}x stronger`;
					else {
						verdict = `beat ${(gap * 1000).toFixed(0)}ms off essentia's`;
						failures.push(song);
					}
				} else if (near(ours.bpm, ref.bpm * 2) || near(ours.bpm, ref.bpm / 2)) {
					verdict = "octave";
				} else if (fit(ours.bpm) > fit(ref.bpm)) {
					verdict = `tighter (${fit(ours.bpm).toFixed(1)} vs ${fit(ref.bpm).toFixed(1)})`;
				} else {
					verdict = "MISS";
					failures.push(song);
				}
				rows.push(
					`${ref.bpm.toFixed(1).padStart(6)} ${ours.bpm.toFixed(1).padStart(6)} ${ms.toFixed(0).padStart(5)}ms  ${verdict.padEnd(26)} ${song}`,
				);
			}
			console.log(
				`essentia  ours   time  verdict\n${rows.join("\n")}\n${songs.length - failures.length}/${songs.length} pass`,
			);
			expect(failures).toEqual([]);
		},
		60 * 60 * 1000,
	);
});
