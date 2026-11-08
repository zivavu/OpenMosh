/** The editor's transport: a clock over the project timeline, and every lane's sound
 * mixed through one Web Audio graph. The project, not a song, sets the length. */

import { createAnalysisTap, startLinkTick } from "../audio/audio-controller";
import { wakeAudioContext, type AudioLinkGroup } from "../audio/audio-utils";
import { resetAutoRange } from "../audio/auto-range";
import { buildSongProfile } from "../audio/build-song-profile";
import type { SongProfile } from "../audio/song-profile";
import { onFrame } from "../frame-loop";
import { resetSpectrumBars } from "../audio/spectrum-bars";
import type { SpectrumData } from "../types";
import type { MixSegment } from "./plan";
import { renderDrive } from "./render";
import { scheduleMix, stopNodes, type ScheduledNode } from "./schedule";
import type { SourceAudioBank } from "./source-audio.svelte";

/** Scheduling lead: sound asked to start "now" would clip its first few ms. */
const LEAD = 0.03;
/** A loop shorter than this restarts by seeking, as any loop once did. */
const MIN_PASS = 0.05;

/** A loop's passes, each scheduled before the one ahead of it ends, so the turn is
 * seamless rather than a stop and a fresh start. */
interface LoopPasses {
	start: number;
	end: number;
	/** Context time the playing pass ends and the next begins. */
	endsAt: number;
	current: ScheduledNode[];
	next: ScheduledNode[];
}

export interface MixerOptions {
	bank: SourceAudioBank;
	getLinkGroups: () => AudioLinkGroup[];
	initialOutputVolume?: number;
	initialLoop?: boolean;
}

export class SequenceMixer {
	/** Project length in seconds. */
	duration = $state(0);
	currentTime = $state(0);
	playing = $state(false);
	/** The export span; playback turns round on its end. */
	spanStart = $state(0);
	spanEnd = $state(0);
	loop = $state(false);
	/** Set while the clock sits past the span end; a run started beyond it plays on. */
	pastSpan = $state(false);
	/** Preview-only: playback goes round this range, over the span and the loop setting. */
	repeat = $state<{ start: number; end: number } | null>(null);
	outputVolume = $state(1);
	/** Set while recording: playback runs on to the end, past the loop and the repeat. */
	straight = false;
	/** Bumped by every play, seek and stop: the jumps `clock` doesn't follow across. */
	run = 0;

	/** The segments to play, from `planMix`. */
	plan = $state.raw<MixSegment[]>([]);

	analyserNode = $state<AnalyserNode | null>(null);
	frequencyData = $state<Uint8Array | null>(null);
	volumeLevel = $state(0);

	spectrumData: SpectrumData | null = $derived(
		this.frequencyData && this.analyserNode
			? {
					data: this.frequencyData,
					sampleRate: this.analyserNode.context.sampleRate,
					binCount: this.analyserNode.frequencyBinCount,
				}
			: null,
	);

	/** Whether anything on the timeline feeds the audio links. */
	hasDrive = $derived(this.plan.some((s) => s.drives));

	#bank: SourceAudioBank;
	#getLinkGroups: () => AudioLinkGroup[];
	#ctx: AudioContext | null = null;
	#master: GainNode | null = null;
	#drive: GainNode | null = null;
	#analysisDelay: DelayNode | null = null;
	#nodes: ScheduledNode[] = [];
	/** Timeline time at context time `#anchorCtx`, while playing. */
	#anchorTime = 0;
	#anchorCtx = 0;
	/** performance.now() at the anchor; the clock falls back on it if the context stalls. */
	#anchorWall = 0;
	#stopFrame: (() => void) | null = null;
	/** Turns the loop while the tab is hidden, where frames stop. */
	#hiddenTick: ReturnType<typeof setInterval> | null = null;
	/** Buffers that were missing when the playing mix was scheduled. */
	#missing = new Set<string>();
	#passes: LoopPasses | null = null;
	/** Where the sound laid out past a non-looping play stops. */
	#scheduledEnd = 0;

	constructor({
		bank,
		getLinkGroups,
		initialOutputVolume = 1,
		initialLoop = false,
	}: MixerOptions) {
		this.#bank = bank;
		this.#getLinkGroups = getLinkGroups;
		this.outputVolume = initialOutputVolume;
		this.loop = initialLoop;

		// A decode landing mid-play joins in, rather than waiting for the next seek.
		$effect(() => {
			this.#bank.version;
			if (!this.playing || this.#missing.size === 0) return;
			const landed = [...this.#missing].some((id) => this.#bank.buffer(id));
			if (landed) this.#reschedule();
		});

		// The links only follow the music when some lane drives them; otherwise the
		// chains hold still, as the export's would.
		$effect(() => {
			const analyser = this.analyserNode;
			const data = this.frequencyData;
			if (!analyser || !this.hasDrive) return;
			return startLinkTick({
				analyser,
				analysisDelay: this.#analysisDelay,
				frequencyData: data,
				sampleRate: analyser.context.sampleRate,
				isPaused: () => !this.playing,
				getLinkGroups: this.#getLinkGroups,
				onLevel: (level) => (this.volumeLevel = level),
			});
		});
	}

	/** Profile of everything that drives the effects across the whole timeline: the
	 * same sound an export reacts to, so both read it on the same scale. */
	async analyseDrive(): Promise<SongProfile | null> {
		const drive = await renderDrive(
			this.plan,
			(id) => this.#bank.buffer(id),
			this.duration,
		);
		return drive ? buildSongProfile(drive) : null;
	}

	/** Swap in a new plan; a playing mix picks it up where it is. A change of volume
	 * alone ramps the sound already playing rather than restarting it. */
	setPlan(plan: MixSegment[]): void {
		const before = this.plan;
		this.plan = plan;
		if (!this.playing) return;
		const ctx = this.#ctx;
		if (ctx && sameButGain(before, plan)) {
			for (const { trim, index } of this.#nodes) {
				trim.gain.setTargetAtTime(plan[index].gain, ctx.currentTime, 0.015);
			}
			return;
		}
		this.#reschedule();
	}

	get trackDuration(): number {
		return this.duration;
	}

	setDuration(d: number): void {
		const next = Math.max(0, d);
		const wasFull = this.spanEnd <= 0 || this.spanEnd >= this.duration - 1e-6;
		this.duration = next;
		// A span that covered the whole project keeps covering it.
		if (wasFull) this.spanEnd = next;
		this.spanEnd = Math.min(this.spanEnd, next);
		this.spanStart = Math.min(this.spanStart, Math.max(0, this.spanEnd));
		if (this.currentTime > next) this.seek(next);
	}

	setOutputVolume(v: number): void {
		this.outputVolume = v;
		if (this.#master) this.#master.gain.value = v;
	}

	/** The context the mix plays through, woken; call it from a user gesture. */
	context(): AudioContext {
		const ctx = this.#ensureGraph();
		wakeAudioContext(ctx);
		return ctx;
	}

	/** Timeline time `time` sounds at context time `ctx`, until `run` moves on. */
	get clock(): { time: number; ctx: number } {
		return { time: this.#anchorTime, ctx: this.#anchorCtx };
	}

	/** Called from a user gesture: that's when a context may start. */
	#ensureGraph(): AudioContext {
		if (this.#ctx && this.#ctx.state !== "closed") return this.#ctx;
		const ctx = new AudioContext({ latencyHint: "interactive" });
		const master = ctx.createGain();
		master.gain.value = this.outputVolume;
		master.connect(ctx.destination);
		const drive = ctx.createGain();
		const tap = createAnalysisTap(ctx);
		drive.connect(tap.input);
		this.#ctx = ctx;
		this.#master = master;
		this.#drive = drive;
		this.#analysisDelay = tap.input;
		this.analyserNode = tap.analyser;
		this.frequencyData = new Uint8Array(tap.analyser.frequencyBinCount);
		return ctx;
	}

	#now(): number {
		const ctx = this.#ctx;
		if (ctx && ctx.state === "running") {
			return this.#anchorTime + (ctx.currentTime - this.#anchorCtx);
		}
		return this.#anchorTime + (performance.now() - this.#anchorWall) / 1000;
	}

	/** Stop and schedule again. `fromNow` starts the clock at its current reading
	 * after the lead (play, seek); otherwise it runs on through it, unbroken. */
	#reschedule(fromNow = false): void {
		const ctx = this.#ctx;
		if (!ctx) return;
		const t = this.#now() + (fromNow ? 0 : LEAD);
		const handover = ctx.currentTime + LEAD;
		// Running on, the old sound plays until the new takes over; a jump cuts it now.
		stopNodes(this.#nodes, fromNow ? undefined : handover);
		this.#anchorTime = t;
		this.#anchorCtx = handover;
		this.#anchorWall = performance.now() + LEAD * 1000;
		const loop = this.#loopRange();
		if (loop && t < loop.end) {
			const current = this.#schedule(t, loop.end, this.#anchorCtx);
			const endsAt = this.#anchorCtx + (loop.end - t);
			const next = this.#schedule(loop.start, loop.end, endsAt);
			this.#passes = { ...loop, endsAt, current, next };
			this.#nodes = [...current, ...next];
		} else {
			this.#passes = null;
			// Stops on the context clock, so a hidden tab's throttled frames can't overrun it.
			this.#scheduledEnd = this.#playEnd();
			this.#nodes = this.#schedule(
				t,
				Math.max(t, this.#scheduledEnd),
				this.#anchorCtx,
			);
		}
		this.#missing = new Set(
			this.plan
				.filter((s) => s.end > t && !this.#bank.buffer(s.sourceId))
				.map((s) => s.sourceId),
		);
	}

	play(): void {
		if (this.playing || this.duration <= 0) return;
		const ctx = this.#ensureGraph();
		wakeAudioContext(ctx);
		let t = this.currentTime;
		const repeat = this.#repeat();
		if (repeat) {
			this.pastSpan = false;
			if (t < repeat.start || t >= repeat.end) t = repeat.start;
		} else {
			// Past the span end is where the marker sits, so it plays from there; before it, no.
			this.pastSpan = this.spanEnd > 0 && t >= this.spanEnd;
			if (!this.pastSpan && t < this.spanStart) t = this.spanStart;
			if (t >= this.duration) t = this.spanStart;
		}
		this.#anchorTime = t;
		this.#anchorCtx = ctx.currentTime;
		this.#anchorWall = performance.now();
		this.currentTime = t;
		this.playing = true;
		this.run++;
		this.#reschedule(true);
		this.#stopFrame?.();
		// Read phase: the clock moves before the frame that shows it draws.
		this.#stopFrame = onFrame("read", this.#frame);
		// An audible tab's timers keep running; its frames don't.
		this.#hiddenTick = setInterval(() => {
			if (typeof document !== "undefined" && document.hidden) this.#frame();
		}, 250);
	}

	pause(): void {
		if (!this.playing) return;
		this.currentTime = Math.min(this.duration, this.#now());
		this.#halt();
	}

	#halt(): void {
		this.playing = false;
		this.run++;
		this.#stopFrame?.();
		this.#stopFrame = null;
		if (this.#hiddenTick) clearInterval(this.#hiddenTick);
		this.#hiddenTick = null;
		stopNodes(this.#nodes);
		this.#nodes = [];
		this.#passes = null;
		this.#missing.clear();
	}

	seek(t: number): void {
		const clamped = Math.max(0, Math.min(this.duration, t));
		this.currentTime = clamped;
		this.pastSpan = this.spanEnd > 0 && clamped >= this.spanEnd;
		if (this.playing && this.#ctx) {
			this.run++;
			this.#anchorTime = clamped;
			this.#anchorCtx = this.#ctx.currentTime;
			this.#anchorWall = performance.now();
			this.#reschedule(true);
		}
		resetAutoRange();
		resetSpectrumBars();
	}

	#frame = () => {
		if (!this.playing) return;
		if (this.#turnLoop()) return;
		const t = this.#now();
		const repeat = this.#repeat();
		if (repeat && t >= repeat.end) {
			this.seek(repeat.start);
			return;
		}
		const end = this.#playEnd();
		// The span's end moved while playing: lay the sound out to the new one.
		if (!this.#passes && end !== this.#scheduledEnd && t < end)
			this.#reschedule();
		if (!repeat && t >= end) {
			if (this.loop && !this.pastSpan && !this.straight) {
				this.seek(this.spanStart);
			} else {
				this.currentTime = this.pastSpan ? this.duration : this.spanStart;
				this.#halt();
				return;
			}
		} else {
			this.currentTime = t;
		}
	};

	#repeat(): { start: number; end: number } | null {
		return this.straight ? null : this.repeat;
	}

	/** Where playback stops: the span's end, or the project's once past it. */
	#playEnd(): number {
		return !this.pastSpan && this.spanEnd > 0 ? this.spanEnd : this.duration;
	}

	/** The timeline range that plays round: the repeat, else a looping span. */
	#loopRange(): { start: number; end: number } | null {
		if (this.straight) return null;
		const range =
			this.repeat ??
			(this.loop && !this.pastSpan
				? {
						start: this.spanStart,
						end: this.spanEnd > 0 ? this.spanEnd : this.duration,
					}
				: null);
		return range && range.end - range.start >= MIN_PASS ? range : null;
	}

	#schedule(from: number, to: number, at: number): ScheduledNode[] {
		return scheduleMix(
			this.#ctx!,
			this.plan,
			(id) => this.#bank.buffer(id),
			{ mix: this.#master, drive: this.#drive },
			from,
			to,
			at,
		);
	}

	/** Keep a loop's passes running on the context clock. False when there are none,
	 * or the clock isn't the context's, and the frame goes the old way round. */
	#turnLoop(): boolean {
		const passes = this.#passes;
		const ctx = this.#ctx;
		if (!passes || !ctx || ctx.state !== "running") return false;
		const loop = this.#loopRange();
		if (!loop || loop.start !== passes.start || loop.end !== passes.end) {
			// The range moved under the scheduled passes: lay them again from here.
			this.#reschedule();
			this.currentTime = Math.min(this.duration, this.#now());
			return true;
		}
		const length = passes.end - passes.start;
		if (ctx.currentTime >= passes.endsAt + length) {
			// No turn for longer than the queued pass: lay the loop again from where it's got to.
			this.seek(passes.start + ((ctx.currentTime - passes.endsAt) % length));
			return true;
		}
		if (ctx.currentTime >= passes.endsAt) {
			// The next pass is already sounding; move the clock onto it, and queue another.
			stopNodes(passes.current);
			this.#anchorTime = passes.start;
			this.#anchorCtx = passes.endsAt;
			this.#anchorWall =
				performance.now() - (ctx.currentTime - passes.endsAt) * 1000;
			const endsAt = passes.endsAt + length;
			const next = this.#schedule(passes.start, passes.end, endsAt);
			this.#passes = { ...passes, endsAt, current: passes.next, next };
			this.#nodes = [...passes.next, ...next];
			resetAutoRange();
			resetSpectrumBars();
		}
		this.currentTime = this.#now();
		return true;
	}

	dispose(): void {
		this.#halt();
		void this.#ctx?.close().catch(() => {});
		this.#ctx = null;
		this.#analysisDelay = null;
		this.analyserNode = null;
	}
}

/** Two plans alike in everything the scheduled nodes are built from, bar volume. */
function sameButGain(a: MixSegment[], b: MixSegment[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((x, i) => {
		const y = b[i];
		return (
			x.sourceId === y.sourceId &&
			x.drives === y.drives &&
			x.start === y.start &&
			x.end === y.end &&
			x.offset === y.offset &&
			x.rate === y.rate &&
			x.reversed === y.reversed &&
			x.fade.start === y.fade.start &&
			x.fade.end === y.fade.end &&
			x.fade.fadeIn === y.fade.fadeIn &&
			x.fade.fadeOut === y.fade.fadeOut
		);
	});
}
