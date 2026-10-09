import { untrack } from "svelte";
import { showToast } from "../components/ui/toast.svelte";
import { detectBpm } from "../slideshow/bpm-detector";

interface BpmDetectionOptions {
	/** What the BPM is measured from: the song's file, or a pool source id (a video's sound). */
	source: () => File | string | null;
	decode: (sourceId: string) => Promise<AudioBuffer | null>;
	bpm: () => number;
	onDetected: (bpm: number) => void;
}

/** The editor's tempo detection: the slideshow's detector, in a shared worker. Construct
 * during component init: a new source detects its own tempo in an effect. */
export class BpmDetection {
	detecting = $state(false);
	#abort: AbortController | null = null;
	#source: File | string | null = null;
	/** Bumped when the BPM is settled elsewhere; a detection that started before yields to it. */
	#epoch = 0;
	/** The source the automatic pass has already been spent on. */
	#autoFor: File | string | null = null;
	readonly #opts: BpmDetectionOptions;

	constructor(opts: BpmDetectionOptions) {
		this.#opts = opts;
		// Clip timing and beat-synced effects need the tempo.
		$effect(() => {
			const source = opts.source();
			if (!source) return;
			untrack(() => {
				if (this.#autoFor === source) return;
				this.#autoFor = source;
				// A song reopened from the library brings its own BPM back.
				if (opts.bpm() > 0) return;
				void this.run(true);
			});
		});
	}

	/** The BPM was set some other way: a pass already running mustn't overrule it. */
	settle() {
		this.#epoch++;
	}

	run = async (auto = false) => {
		const source = this.#opts.source();
		if (!source || (this.detecting && this.#source === source)) return;
		// A pass still measuring the previous source is moot.
		this.#abort?.abort();
		const abort = new AbortController();
		this.#abort = abort;
		this.#source = source;
		const epoch = this.#epoch;
		this.detecting = true;
		try {
			const audio =
				typeof source === "string" ? await this.#opts.decode(source) : source;
			if (!audio) throw new Error("No decodable sound");
			const result = await detectBpm(audio, abort.signal);
			// The automatic pass never overrules what landed while it ran.
			if (auto && (this.#epoch !== epoch || this.#opts.source() !== source))
				return;
			this.#opts.onDetected(Math.round(result.bpm));
		} catch (e) {
			if (!(e instanceof DOMException && e.name === "AbortError")) {
				console.error("BPM detection failed:", e);
				showToast(
					"Couldn't detect the BPM for this track. Set it by hand instead.",
					"error",
					6000,
				);
			}
		} finally {
			if (this.#abort === abort) {
				this.detecting = false;
				this.#abort = null;
				this.#source = null;
			}
		}
	};
}
