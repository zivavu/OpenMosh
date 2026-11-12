/** A keyed value recorded while the song plays: a slider or a handle held through
 * playback writes what it shows, once per frame, until the pointer lets go. */

import type { Keyframe } from "./keyframes";

let held = false;
if (typeof window !== "undefined") {
	// Capture phase: a handler that stops the event can't hide a release from this.
	const opts = { capture: true };
	window.addEventListener("pointerdown", () => (held = true), opts);
	window.addEventListener("pointerup", () => (held = false), opts);
	window.addEventListener("pointercancel", () => (held = false), opts);
}

/** A pointer is down somewhere: a held slider rather than a typed value or a key press. */
export function pointerHeld(): boolean {
	return held;
}

export type TakeSamples<P extends string> = Partial<
	Record<P, Keyframe<number>[]>
>;

export interface KeyTakeHost<P extends string> {
	/** Where the playhead is, in the keys' own time, while playing; else null. */
	now(): number | null;
	/** Write the take so far; `final` once the pointer lets go. */
	apply(samples: TakeSamples<P>, final: boolean): void;
	onEnd?(): void;
	frame?: (cb: () => void) => number;
	cancelFrame?: (id: number) => void;
}

/** Samples closer than this land on the same frame. */
const SAME_FRAME = 1e-4;

export class KeyTake<P extends string> {
	readonly #host: KeyTakeHost<P>;
	readonly #values = new Map<P, number>();
	readonly #samples = new Map<P, Keyframe<number>[]>();
	#raf = 0;
	#ended = false;
	readonly #frame: (cb: () => void) => number;
	readonly #cancel: (id: number) => void;

	constructor(host: KeyTakeHost<P>) {
		this.#host = host;
		this.#frame = host.frame ?? ((cb) => requestAnimationFrame(cb));
		this.#cancel = host.cancelFrame ?? ((id) => cancelAnimationFrame(id));
		if (typeof window !== "undefined") {
			window.addEventListener("pointerup", this.end, { capture: true });
			window.addEventListener("pointercancel", this.end, { capture: true });
		}
		this.#raf = this.#frame(this.#tick);
	}

	get ended(): boolean {
		return this.#ended;
	}

	/** The values held now; recorded at the playhead from this frame on. */
	set(values: Partial<Record<P, number>>): void {
		for (const [p, v] of Object.entries(values) as [P, number][])
			this.#values.set(p, v);
		this.sample();
	}

	/** Record the held values at the playhead. Public for tests; the take calls it
	 * every frame, since a slider held still sends no input. */
	sample(): void {
		if (this.#ended) return;
		const t = this.#host.now();
		if (t === null || this.#values.size === 0) return;
		for (const [p, v] of this.#values) {
			let keys = this.#samples.get(p);
			if (!keys) this.#samples.set(p, (keys = []));
			const last = keys[keys.length - 1];
			if (last && Math.abs(last.t - t) < SAME_FRAME) last.v = v;
			// A playhead that loops back would write over the start of this pass.
			else if (!last || t > last.t) keys.push({ t, v });
		}
		this.#host.apply(this.#snapshot(), false);
	}

	#tick = () => {
		if (this.#ended) return;
		this.sample();
		this.#raf = this.#frame(this.#tick);
	};

	#snapshot(): TakeSamples<P> {
		const out: TakeSamples<P> = {};
		for (const [p, keys] of this.#samples) out[p] = keys.map((k) => ({ ...k }));
		return out;
	}

	end = () => {
		if (this.#ended) return;
		this.#ended = true;
		this.#cancel(this.#raf);
		if (typeof window !== "undefined") {
			window.removeEventListener("pointerup", this.end, { capture: true });
			window.removeEventListener("pointercancel", this.end, {
				capture: true,
			});
		}
		if (this.#samples.size > 0) this.#host.apply(this.#snapshot(), true);
		this.#host.onEnd?.();
	};
}
