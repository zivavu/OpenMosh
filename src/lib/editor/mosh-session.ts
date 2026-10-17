import type { EffectInstance } from "../effects";
import { createEffectHistory } from "./history.svelte";
import { generateMosh, type MoshOptions } from "./mosh";

export interface MoshSessionOptions {
	getEffects: () => EffectInstance[];
	setEffects: (effects: EffectInstance[]) => void;
	getMoshOptions: () => MoshOptions;
	/** Drop a pending panel-edit burst when a mosh replaces the chain under it. */
	cancelBurst: () => void;
	/** Close and record a pending burst before walking the edit history. */
	endBurst: () => void;
	/** Runs a roll, and may run it again until the result is worth keeping. */
	rollAlive?: (roll: () => void) => void;
}

/** Two undo stacks over one chain so ←/→ (moshes) and Ctrl+Z/Y (hand-edits)
 * never fight; rolling a mosh rebases the edit history onto the new chain. */
export function createMoshSession(opts: MoshSessionOptions) {
	const { getEffects, setEffects, getMoshOptions, cancelBurst, endBurst } =
		opts;
	const rollAlive = opts.rollAlive ?? ((roll: () => void) => roll());
	// Seeded from the live chain, so undo can't fall back past a restored session.
	const history = createEffectHistory(getEffects());
	const moshHistory = createEffectHistory(getEffects());

	function roll() {
		cancelBurst();
		keepTweaks();
		const effects = getEffects();
		rollAlive(() => generateMosh(effects, getMoshOptions()));
		moshHistory.push(effects);
		history.reset(effects);
	}

	/** Hand-edits made on a mosh belong to it, so walking away and back keeps them.
	 * Before the first roll this records the user's own chain for ← to return to. */
	function keepTweaks() {
		moshHistory.replace(getEffects());
	}

	/** → : forward through mosh history, rolling a new mosh at its top. */
	function forward() {
		if (!moshHistory.canRedo) {
			roll();
			return;
		}
		cancelBurst();
		keepTweaks();
		const next = moshHistory.redo()!;
		setEffects(next);
		history.reset(next);
	}

	/** ← : back through the mosh history. */
	function back() {
		if (!moshHistory.canUndo) return;
		cancelBurst();
		keepTweaks();
		const prev = moshHistory.undo()!;
		setEffects(prev);
		history.reset(prev);
	}

	/** Ctrl+Z: hand-edits only. A pending coalescing burst is committed first, so
	 * undo lands before it rather than skipping past it. */
	function undoEdit() {
		endBurst();
		const prev = history.undo();
		if (prev) setEffects(prev);
	}

	function redoEdit() {
		endBurst();
		const next = history.redo();
		if (next) setEffects(next);
	}

	return {
		get canUndoMosh() {
			return moshHistory.canUndo;
		},
		/** Where the hand-edit stack sits on the shared edit clock, for the Ctrl+Z router. */
		get undoSeq() {
			return history.undoSeq;
		},
		get redoSeq() {
			return history.redoSeq;
		},
		/** Anything to undo on either stack, i.e. the chain has been worked on. */
		get touched() {
			return history.canUndo || moshHistory.canUndo;
		},
		/** Either stack holds a step either way: the chain has changed since it opened,
		 * even if it's since been walked back. */
		get worked() {
			return (
				history.canUndo ||
				history.canRedo ||
				moshHistory.canUndo ||
				moshHistory.canRedo
			);
		},
		pushEdit(effects: EffectInstance[]) {
			history.push(effects);
		},
		/** Rebase the edit history onto a chain replaced from outside. */
		resetEdits(effects: EffectInstance[]) {
			history.reset(effects);
		},
		roll,
		forward,
		back,
		undoEdit,
		redoEdit,
	};
}

export type MoshSession = ReturnType<typeof createMoshSession>;
