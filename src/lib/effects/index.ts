export * from './types';
export { EFFECT_DEFINITIONS } from './definitions';
export { loadPresets, savePreset, deletePreset, applyPreset } from './presets';

import type { EffectDefinition, EffectInstance } from './types';
import { EFFECT_DEFINITIONS } from './definitions';

export function createEffectInstance(def: EffectDefinition): EffectInstance {
	return {
		instanceId: crypto.randomUUID(),
		defId: def.id,
		enabled: false,
		locked: false,
		expanded: false,
		values: Object.fromEntries(def.params.map((p) => [p.key, p.defaultValue])),
		volumeLinks: undefined,
	};
}

export function getDefinition(defId: string): EffectDefinition | undefined {
	return EFFECT_DEFINITIONS.find((d) => d.id === defId);
}
