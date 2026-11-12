/** A keyed slider held through playback, recorded as a pass. */

import { KeyTake, pointerHeld } from "../key-take";
import { writeTake, type Keyframe } from "../keyframes";
import { isKeyed, paramTolerance, setParamTrack } from "./param-keys";
import type { EffectInstance } from "./types";

export interface ParamTakeHost {
	/** Whether a pointer is down; the real one unless a test stands in. */
	held?: () => boolean;
	/** Frame scheduling for the take, for tests. */
	frame?: (cb: () => void) => number;
	effects(): EffectInstance[];
	replace(index: number, effect: EffectInstance): void;
	/** Once per pass, before its first write: the pass is one undo step. */
	beforeEdit(): void;
	afterEdit(): void;
	/** Seconds into the clip; null where nothing can be keyed. */
	time(): number | null;
	playing(): boolean;
}

interface Pass {
	id: string;
	key: string;
	take: KeyTake<string>;
}

export class ParamTakes {
	readonly #host: ParamTakeHost;
	#pass: Pass | null = null;

	constructor(host: ParamTakeHost) {
		this.#host = host;
	}

	/** A slider tick, taken as part of a recorded pass. False when it isn't one: the
	 * song is paused, the param isn't keyed, or nothing is held. */
	edit(index: number, key: string, value: number): boolean {
		const host = this.#host;
		const effect = host.effects()[index];
		if (
			!effect ||
			!host.playing() ||
			host.time() === null ||
			!(host.held ?? pointerHeld)() ||
			!isKeyed(effect, key)
		)
			return false;
		const pass = this.#pass;
		if (pass?.id !== effect.instanceId || pass.key !== key || pass.take.ended)
			this.#start(effect, key);
		this.#pass!.take.set({ [key]: value });
		return true;
	}

	#start(effect: EffectInstance, key: string) {
		this.#pass?.take.end();
		const host = this.#host;
		host.beforeEdit();
		const id = effect.instanceId;
		const base: Keyframe<number>[] = (effect.keys?.[key] ?? []).map((k) => ({
			...k,
		}));
		const tolerance = paramTolerance(effect.defId, key);
		const take: KeyTake<string> = new KeyTake<string>({
			now: () => (host.playing() ? host.time() : null),
			frame: host.frame,
			cancelFrame: host.frame && (() => {}),
			apply: (samples, final) => {
				const taken = samples[key] ?? [];
				const effects = host.effects();
				const i = effects.findIndex((e) => e.instanceId === id);
				if (i < 0 || taken.length === 0) return;
				const keys = writeTake(base, taken, final ? tolerance : undefined);
				const next = setParamTrack(effects[i], key, keys);
				host.replace(i, {
					...next,
					values: { ...next.values, [key]: taken[taken.length - 1].v },
				});
				host.afterEdit();
			},
			onEnd: () => {
				if (this.#pass?.take === take) this.#pass = null;
			},
		});
		this.#pass = { id, key, take };
	}

	dispose() {
		this.#pass?.take.end();
	}
}
