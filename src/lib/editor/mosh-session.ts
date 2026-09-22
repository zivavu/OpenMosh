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
}

/** Two undo stacks over one chain so ←/→ (moshes) and Ctrl+Z/Y (hand-edits)
 * never fight; rolling a mosh rebases the edit history onto the new chain. */
export function createMoshSession(opts: MoshSessionOptions) {
	const { getEffects, setEffects, getMoshOptions, cancelBurst, endBurst } =
		opts;
	const history = createEffectHistory();
	const moshHistory = createEffectHistory();

	function roll() {
		cancelBurst();
		const effects = getEffects();
		// Record the pre-first-roll chain so ← returns to the user's own work, not startup.
		if (!moshHistory.canUndo && !moshHistory.canRedo)
			moshHistory.reset(effects);
		generateMosh(effects, getMoshOptions());
		moshHistory.push(effects);
		history.reset(effects);
	}

	/** → : forward through mosh history, rolling a new mosh at its top. */
	function forward() {
		const next = moshHistory.redo();
		if (!next) {
			roll();
			return;
		}
		cancelBurst();
		setEffects(next);
		history.reset(next);
	}

	/** ← : back through the mosh history. Never touches the edit history. */
	function back() {
		const prev = moshHistory.undo();
		if (!prev) return;
		cancelBurst();
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
