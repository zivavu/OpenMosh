import { withoutHiddenEffects } from "../effects";
import { MoshHistory, type MoshSnapshot } from "./mosh-history";

interface ClipMoshesOptions<Clip extends { id: string }> {
	/** The live clips with these ids. */
	clips: (ids: Set<string>) => Clip[];
	snapshot: (clip: Clip) => MoshSnapshot;
	/** Roll these clips in the editor's state. */
	roll: (ids: Set<string>) => void;
	restore: (clipId: string, snap: MoshSnapshot) => void;
	/** Record the lanes' undo step before a roll or an arrow changes a clip's chain. */
	beforeChange?: () => void;
}

/** ←/→ through one lane kind's clip moshes, a stack per clip id. Each change is also
 * an edit, so Ctrl+Z steps back through rolls before anything older. */
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
			// The mosh being left keeps its tweaks, however the roll was asked for.
			const now = this.#snapshot(clip);
			this.#history.replace(clip.id, now);
			this.#history.seed(clip.id, now);
		}
		this.#opts.beforeChange?.();
		this.#opts.roll(ids);
		for (const clip of this.#opts.clips(ids)) {
			this.#history.push(clip.id, this.#snapshot(clip));
		}
	};

	/** Hand edits made on a mosh belong to it, so walking away and back keeps them. */
	#keepTweaks(clipId: string) {
		const [clip] = this.#opts.clips(new Set([clipId]));
		if (clip) this.#history.replace(clipId, this.#snapshot(clip));
	}

	/** An effect hidden since the mosh was taken stays hidden. */
	#restore(clipId: string, snap: MoshSnapshot) {
		this.#opts.beforeChange?.();
		this.#opts.restore(clipId, {
			...snap,
			effects: withoutHiddenEffects(snap.effects),
		});
	}

	/** → : the next mosh in the clip's history, or a new roll at its top. */
	forward(clipId: string) {
		this.#keepTweaks(clipId);
		const snap = this.#history.redo(clipId);
		if (!snap) return this.roll([clipId]);
		this.#restore(clipId, snap);
	}

	back(clipId: string) {
		this.#keepTweaks(clipId);
		const snap = this.#history.undo(clipId);
		if (!snap) return;
		this.#restore(clipId, snap);
	}

	/** Splits, deletes and undo retire clip ids; drop their stacks. */
	retain(liveIds: Iterable<string>) {
		this.#history.retain(liveIds);
	}
}
