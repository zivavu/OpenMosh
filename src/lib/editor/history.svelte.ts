import {
	EFFECT_DEFINITIONS,
	createEffectInstance,
	type EffectInstance,
} from "../effects";

export function createEffectHistory() {
	let history = $state<EffectInstance[][]>([
		$state.snapshot(EFFECT_DEFINITIONS.map(createEffectInstance)),
	]);
	let historyIndex = $state(0);
	const canUndo = $derived(historyIndex > 0);
	const canRedo = $derived(historyIndex < history.length - 1);

	function push(effects: EffectInstance[]) {
		history.length = historyIndex + 1;
		history.push($state.snapshot(effects));
		historyIndex = history.length - 1;
	}

	function undo(): EffectInstance[] | null {
		if (!canUndo) return null;
		historyIndex--;
		return $state.snapshot(history[historyIndex]) as EffectInstance[];
	}

	function redo(): EffectInstance[] | null {
		if (!canRedo) return null;
		historyIndex++;
		return $state.snapshot(history[historyIndex]) as EffectInstance[];
	}

	function reset(effects: EffectInstance[]) {
		history = [$state.snapshot(effects)];
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
		push,
		undo,
		redo,
		reset,
	};
}
