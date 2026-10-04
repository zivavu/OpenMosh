import { untrack } from "svelte";
import { showToast } from "../components/ui/toast.svelte";
import { detectBpm } from "../slideshow/bpm-detector";

interface BpmDetectionOptions {
	track: () => File | null;
	bpm: () => number;
	onDetected: (bpm: number) => void;
}

/** The editor's tempo detection: the slideshow's detector, in a shared worker. Construct
 * during component init: a new track detects its own tempo in an effect. */
export class BpmDetection {
	detecting = $state(false);
	#abort: AbortController | null = null;
	#file: File | null = null;
	/** Bumped when the BPM is settled elsewhere; a detection that started before yields to it. */
	#epoch = 0;
	/** The track the automatic pass has already been spent on. */
	#autoFor: File | null = null;
	readonly #opts: BpmDetectionOptions;

	constructor(opts: BpmDetectionOptions) {
		this.#opts = opts;
		// Clip timing and beat-synced effects need the tempo.
		$effect(() => {
			const file = opts.track();
			if (!file) return;
			untrack(() => {
				if (this.#autoFor === file) return;
				this.#autoFor = file;
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
		const file = this.#opts.track();
		if (!file || (this.detecting && this.#file === file)) return;
		// A pass still measuring the previous song is moot.
		this.#abort?.abort();
		const abort = new AbortController();
		this.#abort = abort;
		this.#file = file;
		const epoch = this.#epoch;
		this.detecting = true;
		try {
			const result = await detectBpm(file, abort.signal);
			// The automatic pass never overrules what landed while it ran.
			if (auto && (this.#epoch !== epoch || this.#opts.track() !== file))
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
				this.#file = null;
			}
		}
	};
}
