import { afterAll, describe, expect, it } from "bun:test";
import { inEffectRoot } from "../testing/effect-root.svelte";
import type { MixSegment } from "./plan";
import type { SourceAudioBank } from "./source-audio.svelte";

/** Sources that remember when they were told to start and stop. */
class FakeNode {
	context: FakeContext;
	gain = {
		value: 1,
		setValueAtTime: () => {},
		linearRampToValueAtTime: () => {},
		setTargetAtTime: () => {},
	};
	delayTime = { value: 0 };
	playbackRate = { value: 1 };
	buffer: unknown = null;
	startedAt: number | null = null;
	stopped = false;
	fftSize = 0;
	frequencyBinCount = 8;
	constructor(context: FakeContext) {
		this.context = context;
	}
	connect() {}
	disconnect() {}
	start(at: number) {
		this.startedAt = at;
	}
	stop() {
		this.stopped = true;
	}
}

class FakeContext {
	currentTime = 0;
	state = "running";
	sampleRate = 48000;
	baseLatency = 0;
	outputLatency = 0;
	destination = {};
	sources: FakeNode[] = [];
	createGain = () => new FakeNode(this);
	createDelay = () => new FakeNode(this);
	createAnalyser = () => new FakeNode(this);
	createBufferSource = () => {
		const node = new FakeNode(this);
		this.sources.push(node);
		return node;
	};
	resume = async () => {};
	close = async () => {};
}

let ctx!: FakeContext;
const frames: ((now: number) => void)[] = [];
const globals = globalThis as Record<string, unknown>;
globals.AudioContext = class {
	constructor() {
		ctx = new FakeContext();
		return ctx;
	}
};
globals.requestAnimationFrame = (job: (now: number) => void) => {
	frames.push(job);
	return frames.length;
};
afterAll(() => {
	delete globals.AudioContext;
	delete globals.requestAnimationFrame;
});

/** Run the frame the mixer is waiting on. */
function frame() {
	const job = frames.shift();
	job?.(performance.now());
}

const { SequenceMixer } = await import("./mixer.svelte");

const bank = {
	version: 0,
	buffer: () => ({ duration: 60 }) as AudioBuffer,
} as unknown as SourceAudioBank;

const song: MixSegment = {
	laneId: "l",
	clipId: "c",
	sourceId: "s",
	drives: false,
	start: 0,
	end: 10,
	offset: 0,
	rate: 1,
	gain: 1,
	fade: { start: 0, end: 10, fadeIn: 0, fadeOut: 0 },
};

function looping(span: { start: number; end: number }) {
	const root = inEffectRoot(
		() => new SequenceMixer({ bank, getLinkGroups: () => [] }),
	);
	const mixer = root.value;
	mixer.setDuration(10);
	mixer.spanStart = span.start;
	mixer.spanEnd = span.end;
	mixer.loop = true;
	mixer.setPlan([song]);
	return { mixer, dispose: root.dispose };
}

describe("a looping mix", () => {
	it("starts each pass exactly as the one before it ends", () => {
		const { mixer, dispose } = looping({ start: 2, end: 3 });
		mixer.play();
		const anchor = ctx.sources[0].startedAt!;
		expect(ctx.sources.map((s) => s.startedAt)).toEqual([anchor, anchor + 1]);

		// Each frame past a turn queues the pass after next, a pass length on.
		for (let pass = 1; pass <= 3; pass++) {
			ctx.currentTime = anchor + pass + 0.01;
			frame();
			expect(mixer.currentTime).toBeCloseTo(2.01, 5);
		}
		const round = (v: number) => Math.round(v * 1e6) / 1e6;
		expect(ctx.sources.map((s) => round(s.startedAt! - anchor))).toEqual([
			0, 1, 2, 3, 4,
		]);
		// Only finished passes were stopped; the one sounding and the one queued weren't.
		expect(ctx.sources.map((s) => s.stopped)).toEqual([
			true,
			true,
			true,
			false,
			false,
		]);
		mixer.pause();
		dispose();
	});

	it("lays the passes again when the span moves mid-play", () => {
		const { mixer, dispose } = looping({ start: 2, end: 3 });
		mixer.play();
		const before = ctx.sources.length;
		mixer.spanEnd = 4;
		frame();
		const fresh = ctx.sources.slice(before);
		expect(fresh).toHaveLength(2);
		// Picked up where it was, 2s in: the new next pass waits for the new end, at 4.
		expect(fresh[1].startedAt! - fresh[0].startedAt!).toBeCloseTo(2, 5);
		mixer.pause();
		dispose();
	});

	it("plays straight to the project's end when it doesn't loop", () => {
		const { mixer, dispose } = looping({ start: 2, end: 3 });
		mixer.loop = false;
		mixer.play();
		expect(ctx.sources).toHaveLength(1);
		mixer.pause();
		dispose();
	});
});
