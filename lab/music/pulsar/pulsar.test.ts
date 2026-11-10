import { describe, expect, test } from "bun:test";
import { analyzeDrive } from "../analyze";
import type { SongAudio } from "../listen";
import { pulsarLook, PULSAR_KNOBS } from "./look";
import { buildPulsarTable, Mode, rollSections, samplePulsar } from "./table";

const RATE = 48000;

function buffer(seconds: number, sample: (t: number, i: number) => number) {
	const data = new Float32Array(RATE * seconds);
	for (let i = 0; i < data.length; i++) data[i] = sample(i / RATE, i);
	return {
		duration: seconds,
		length: data.length,
		sampleRate: RATE,
		numberOfChannels: 1,
		getChannelData: () => data,
	} as unknown as AudioBuffer;
}

const kickAt = (x: number) =>
	0.8 * Math.exp(-x * 25) * Math.sin(2 * Math.PI * 60 * x);

/** Quiet for 8 s, then a 120 BPM kick with hats and a held note. */
let dropSong: Promise<SongAudio> | null = null;
const drop = () =>
	(dropSong ??= analyzeDrive(
		buffer(40, (t, i) => {
			if (t < 8) return 0;
			const hat = 0.2 * Math.exp(-((t + 0.25) % 0.5) * 60);
			return (
				kickAt((t - 8) % 0.5) +
				hat * Math.sin(i * 1.7) +
				0.05 * Math.sin(2 * Math.PI * 800 * t)
			);
		}),
	));

describe("Pulsar's song table", () => {
	test("is dark in the silence and lit once the music starts", async () => {
		const table = buildPulsarTable(await drop(), pulsarLook(1, {}));
		expect(samplePulsar(table, 4).presence).toBe(0);
		expect(samplePulsar(table, 4).flash).toBe(0);
		expect(samplePulsar(table, 12).presence).toBeGreaterThan(0.5);
	});

	test("flashes on each hit and lets it die away", async () => {
		const table = buildPulsarTable(await drop(), pulsarLook(1, {}));
		expect(table.onsets.length).toBeGreaterThan(20);
		const at = table.onsets[10];
		expect(table.flash[at]).toBeGreaterThan(0.3);
		expect(table.flash[at + 12]).toBeLessThan(table.flash[at]);
	});

	test("only hits invert, and none do with the chance at 0", async () => {
		const song = await drop();
		const table = buildPulsarTable(song, pulsarLook(1, { snapChance: 1 }));
		for (let i = 1; i < table.frames; i++) {
			if (table.snap[i] && !table.snap[i - 1]) {
				expect(table.onsets).toContain(i);
			}
		}
		expect(table.snap.some((v) => v === 1)).toBe(true);
		const never = buildPulsarTable(song, pulsarLook(1, { snapChance: 0 }));
		expect(never.snap.every((v) => v === 0)).toBe(true);
	});

	test("an inverting hit flips dark and ink both ways", async () => {
		const table = buildPulsarTable(await drop(), pulsarLook(1, {}));
		const at = table.onsets[10];
		const t = (at + 1) / 60;
		const section = table.sections[table.section[at + 1]];
		table.snap[at + 1] = 1;
		section.mode = Mode.Dark;
		expect(samplePulsar(table, t).mode).toBe(Mode.Ink);
		section.mode = Mode.Ink;
		expect(samplePulsar(table, t).mode).toBe(Mode.Dark);
	});

	test("is the same for the same seed", async () => {
		const song = await drop();
		const a = buildPulsarTable(song, pulsarLook(7, {}));
		const b = buildPulsarTable(song, pulsarLook(7, {}));
		expect(a.sections).toEqual(b.sections);
		expect(a.snap).toEqual(b.snap);
	});
});

describe("Pulsar's sections", () => {
	test("open dark and keep to the modes the shares allow", () => {
		const dark = rollSections(
			30,
			pulsarLook(3, { inkShare: 0, fieldShare: 0 }),
		);
		expect(dark.every((s) => s.mode === Mode.Dark)).toBe(true);
		const mixed = rollSections(30, pulsarLook(3, {}));
		expect(mixed[0].mode).toBe(Mode.Dark);
		expect(new Set(mixed.map((s) => s.mode)).size).toBe(3);
	});

	test("never ask the shader for more than it draws", () => {
		for (const s of rollSections(200, pulsarLook(11, {}))) {
			expect(s.fold).toBeGreaterThanOrEqual(5);
			expect(s.fold).toBeLessThanOrEqual(16);
			expect(s.orbits).toBeGreaterThanOrEqual(2);
			expect(s.orbits).toBeLessThanOrEqual(4);
		}
		const fold = PULSAR_KNOBS.find((k) => k.key === "fold")!;
		expect(fold.max).toBeLessThanOrEqual(16);
	});
});
