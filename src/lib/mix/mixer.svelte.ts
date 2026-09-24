/** The editor's transport: a clock over the project timeline, and every lane's sound
 * mixed through one Web Audio graph. The project, not a song, sets the length. */

import { startLinkTick } from "../audio/audio-controller";
import type { AudioLinkGroup } from "../audio/audio-utils";
import { resetAutoRange } from "../audio/auto-range";
import { resetSpectrumRange } from "../audio/spectrum-range";
import type { SpectrumData } from "../types";
import type { MixSegment } from "./plan";
import { scheduleMix, stopNodes, type ScheduledNode } from "./schedule";
import type { SourceAudioBank } from "./source-audio.svelte";

/** Scheduling lead: sound asked to start "now" would clip its first few ms. */
const LEAD = 0.03;

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
	#nodes: ScheduledNode[] = [];
	/** Timeline time at context time `#anchorCtx`, while playing. */
	#anchorTime = 0;
	#anchorCtx = 0;
	/** performance.now() at the anchor; the clock falls back on it if the context stalls. */
	#anchorWall = 0;
	#raf = 0;
	/** Buffers that were missing when the playing mix was scheduled. */
	#missing = new Set<string>();

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
				frequencyData: data,
				sampleRate: analyser.context.sampleRate,
				isPaused: () => !this.playing,
				getLinkGroups: this.#getLinkGroups,
				onLevel: (level) => (this.volumeLevel = level),
			});
		});
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

	/** Called from a user gesture: that's when a context may start. */
	#ensureGraph(): AudioContext {
		if (this.#ctx && this.#ctx.state !== "closed") return this.#ctx;
		const ctx = new AudioContext({ latencyHint: "interactive" });
		const master = ctx.createGain();
		master.gain.value = this.outputVolume;
		master.connect(ctx.destination);
		const drive = ctx.createGain();
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 2048;
		// Raw bins; smoothing lives in the link code, which the export runs too.
		analyser.smoothingTimeConstant = 0;
		// Kept pulled without being heard.
		const sink = ctx.createGain();
		sink.gain.value = 0;
		drive.connect(analyser);
		analyser.connect(sink);
		sink.connect(ctx.destination);
		this.#ctx = ctx;
		this.#master = master;
		this.#drive = drive;
		this.analyserNode = analyser;
		this.frequencyData = new Uint8Array(analyser.frequencyBinCount);
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
		stopNodes(this.#nodes);
		this.#anchorTime = t;
		this.#anchorCtx = ctx.currentTime + LEAD;
		this.#anchorWall = performance.now() + LEAD * 1000;
		// Scheduled out to the project's end: playback past the span runs on.
		this.#nodes = scheduleMix(
			ctx,
			this.plan,
			(id) => this.#bank.buffer(id),
			{ mix: this.#master, drive: this.#drive },
			t,
			Math.max(t, this.duration),
			this.#anchorCtx,
		);
		this.#missing = new Set(
			this.plan
				.filter((s) => s.end > t && !this.#bank.buffer(s.sourceId))
				.map((s) => s.sourceId),
		);
	}

	play(): void {
		if (this.playing || this.duration <= 0) return;
		const ctx = this.#ensureGraph();
		if (ctx.state === "suspended") void ctx.resume().catch(() => {});
		let t = this.currentTime;
		const repeat = this.repeat;
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
		this.#reschedule(true);
		this.#raf = requestAnimationFrame(this.#frame);
	}

	pause(): void {
		if (!this.playing) return;
		this.currentTime = Math.min(this.duration, this.#now());
		this.#halt();
	}

	#halt(): void {
		this.playing = false;
		cancelAnimationFrame(this.#raf);
		stopNodes(this.#nodes);
		this.#nodes = [];
		this.#missing.clear();
	}

	seek(t: number): void {
		const clamped = Math.max(0, Math.min(this.duration, t));
		this.currentTime = clamped;
		this.pastSpan = this.spanEnd > 0 && clamped >= this.spanEnd;
		if (this.playing && this.#ctx) {
			this.#anchorTime = clamped;
			this.#anchorCtx = this.#ctx.currentTime;
			this.#anchorWall = performance.now();
			this.#reschedule(true);
		}
		resetAutoRange();
		resetSpectrumRange();
	}

	#frame = () => {
		if (!this.playing) return;
		const t = this.#now();
		const repeat = this.repeat;
		if (repeat && t >= repeat.end) {
			this.seek(repeat.start);
			this.#raf = requestAnimationFrame(this.#frame);
			return;
		}
		const end =
			!this.pastSpan && this.spanEnd > 0 ? this.spanEnd : this.duration;
		if (!repeat && t >= end) {
			if (this.loop && !this.pastSpan) {
				this.seek(this.spanStart);
			} else {
				this.currentTime = this.pastSpan ? this.duration : this.spanStart;
				this.#halt();
				return;
			}
		} else {
			this.currentTime = t;
		}
		this.#raf = requestAnimationFrame(this.#frame);
	};

	dispose(): void {
		this.#halt();
		void this.#ctx?.close().catch(() => {});
		this.#ctx = null;
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
			x.fade.start === y.fade.start &&
			x.fade.end === y.fade.end &&
			x.fade.fadeIn === y.fade.fadeIn &&
			x.fade.fadeOut === y.fade.fadeOut
		);
	});
}
