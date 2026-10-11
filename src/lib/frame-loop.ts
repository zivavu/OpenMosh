/** One animation frame for the per-frame jobs, run in phase order: the audio a frame
 * reads lands before the draw that shows it, not a frame later. */
export type FramePhase = "read" | "draw";

type Job = (now: number) => void;

const jobs: Record<FramePhase, Set<Job>> = { read: new Set(), draw: new Set() };
const PHASES: FramePhase[] = ["read", "draw"];
let raf = 0;

function run(now: number) {
	raf = jobs.read.size + jobs.draw.size > 0 ? requestAnimationFrame(run) : 0;
	for (const phase of PHASES) {
		for (const job of [...jobs[phase]]) {
			// One that left during this frame doesn't run in it.
			if (!jobs[phase].has(job)) continue;
			try {
				job(now);
			} catch (e) {
				// A job that throws stops, as its own rAF loop would have; the rest go on.
				jobs[phase].delete(job);
				queueMicrotask(() => {
					throw e;
				});
			}
		}
	}
}

/** Run `job` every frame in `phase` until the returned function is called. */
export function onFrame(phase: FramePhase, job: Job): () => void {
	jobs[phase].add(job);
	if (!raf) raf = requestAnimationFrame(run);
	return () => {
		jobs[phase].delete(job);
	};
}
