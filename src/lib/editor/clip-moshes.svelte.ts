import { MoshHistory, type MoshSnapshot } from "./mosh-history";

interface ClipMoshesOptions<Clip extends { id: string }> {
	/** The live clips with these ids. */
	clips: (ids: Set<string>) => Clip[];
	snapshot: (clip: Clip) => MoshSnapshot;
	/** Roll these clips in the editor's state. */
	roll: (ids: Set<string>) => void;
	restore: (clipId: string, snap: MoshSnapshot) => void;
}

/** ←/→ through one lane kind's clip moshes, a stack per clip id. Mosh history only,
 * never the edit stack. */
export class ClipMoshes<Clip extends { id: string }> {
	#history = new MoshHistory<MoshSnapshot>();
	readonly #opts: ClipMoshesOptions<Clip>;

	constructor(opts: ClipMoshesOptions<Clip>) {
		this.#opts = opts;
	}

	#snapshot(clip: Clip): MoshSnapshot {
		return this.#opts.snapshot($state.snapshot(clip) as Clip);
	}

	roll = (clipIds: string[]) => {
		const ids = new Set(clipIds);
		for (const clip of this.#opts.clips(ids)) {
			this.#history.seed(clip.id, this.#snapshot(clip));
		}
		this.#opts.roll(ids);
		for (const clip of this.#opts.clips(ids)) {
			this.#history.push(clip.id, this.#snapshot(clip));
		}
	};

	/** → : the next mosh in the clip's history, or a new roll at its top. */
	forward(clipId: string) {
		const snap = this.#history.redo(clipId);
		if (snap) this.#opts.restore(clipId, snap);
		else this.roll([clipId]);
	}

	back(clipId: string) {
		const snap = this.#history.undo(clipId);
		if (snap) this.#opts.restore(clipId, snap);
	}

	/** Splits, deletes and undo retire clip ids; drop their stacks. */
	retain(liveIds: Iterable<string>) {
		this.#history.retain(liveIds);
	}
}
