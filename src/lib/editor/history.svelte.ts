import { loadInitialEffects, type EffectInstance } from "../effects";
import { NO_EDIT, nextEditSeq } from "./edit-clock";

export function createEffectHistory() {
	let history = $state<EffectInstance[][]>([
		$state.snapshot(loadInitialEffects()),
	]);
	// Edit-clock stamp per entry — see createSnapshotHistory for the same
	// bookkeeping and why Ctrl+Z needs it.
	let seqs = $state<number[]>([NO_EDIT]);
	let historyIndex = $state(0);
	const canUndo = $derived(historyIndex > 0);
	const canRedo = $derived(historyIndex < history.length - 1);

	function push(effects: EffectInstance[]) {
		history.length = historyIndex + 1;
		seqs.length = historyIndex + 1;
		history.push($state.snapshot(effects));
		seqs.push(nextEditSeq());
		historyIndex = history.length - 1;
	}

	function undo(): EffectInstance[] | null {
		if (!canUndo) return null;
		// The entry left behind is now the newest thing to redo.
		seqs[historyIndex] = nextEditSeq();
		historyIndex--;
		return $state.snapshot(history[historyIndex]) as EffectInstance[];
	}

	function redo(): EffectInstance[] | null {
		if (!canRedo) return null;
		historyIndex++;
		seqs[historyIndex] = nextEditSeq();
		return $state.snapshot(history[historyIndex]) as EffectInstance[];
	}

	function reset(effects: EffectInstance[]) {
		history = [$state.snapshot(effects)];
		seqs = [NO_EDIT];
		historyIndex = 0;
	}

	return {
		get history() {
			return history;
		},
		get historyIndex() {
			return historyIndex;
		},
		get canUndo() {
			return canUndo;
		},
		get canRedo() {
			return canRedo;
		},
		get undoSeq() {
			return canUndo ? seqs[historyIndex] : NO_EDIT;
		},
		get redoSeq() {
			return canRedo ? seqs[historyIndex + 1] : NO_EDIT;
		},
		push,
		undo,
		redo,
		reset,
	};
}
