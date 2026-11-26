import type { AudioClip, AudioLane } from "../mix/types";
import type { FadeEdge } from "../timeline/clips";

export interface AudioClipSelectionHost {
	readonly lanes: AudioLane[];
	readonly clipIds: string[];
	onChange(lanes: AudioLane[]): void;
	onBeforeEdit?(coalesceKey?: string): void;
}

/** A value the whole selection shares; undefined when it disagrees. */
function common<T>(values: T[]): T | undefined {
	return values.every((v) => v === values[0]) ? values[0] : undefined;
}

/** The selected audio clips' settings, read and edited across the whole selection.
 * The timeline's selection bar and the sidebar's Audio clip tab both go through it. */
export class AudioClipSelection {
	#host: AudioClipSelectionHost;

	constructor(host: AudioClipSelectionHost) {
		this.#host = host;
	}

	clips = $derived.by(() => {
		const ids = new Set(this.#host.clipIds);
		return this.#host.lanes.flatMap((l) =>
			l.clips.filter((c) => ids.has(c.id)),
		);
	});
	lanes = $derived.by(() => {
		const ids = new Set(this.#host.clipIds);
		return this.#host.lanes.filter((l) => l.clips.some((c) => ids.has(c.id)));
	});

	gain = $derived(common(this.clips.map((c) => c.gain ?? 1)));
	fadeInSec = $derived(common(this.clips.map((c) => c.fadeInSec ?? 0)));
	fadeOutSec = $derived(common(this.clips.map((c) => c.fadeOutSec ?? 0)));
	/** The one source the selection plays, if that's all it plays. */
	sourceId = $derived(common(this.clips.map((c) => c.sourceId)));
	allLoop = $derived(this.clips.length > 0 && this.clips.every((c) => c.loop));
	someLoop = $derived(this.clips.some((c) => c.loop));
	allDrive = $derived(
		this.lanes.length > 0 && this.lanes.every((l) => l.drives),
	);
	someDrive = $derived(this.lanes.some((l) => l.drives));

	update(fn: (clip: AudioClip) => AudioClip, coalesceKey?: string) {
		const ids = new Set(this.#host.clipIds);
		this.#host.onBeforeEdit?.(coalesceKey);
		this.#host.onChange(
			this.#host.lanes.map((l) =>
				l.clips.some((c) => ids.has(c.id))
					? { ...l, clips: l.clips.map((c) => (ids.has(c.id) ? fn(c) : c)) }
					: l,
			),
		);
	}

	/** One gesture's worth of edits to the same field coalesce into one undo step. */
	#key(field: string): string {
		return `audio-${field}-${this.#host.clipIds.join(",")}`;
	}

	setGain(gain: number) {
		this.update(
			(c) => ({ ...c, gain: gain === 1 ? undefined : gain }),
			this.#key("gain"),
		);
	}

	resetGain() {
		this.update((c) => ({ ...c, gain: undefined }));
	}

	/** Zero means no ramp at all, which the clip carries as an absent field. */
	setFade(edge: FadeEdge, sec: number, coalesce = false) {
		this.update(
			(c) => ({ ...c, [edge]: sec > 0 ? sec : undefined }),
			coalesce ? this.#key(edge) : undefined,
		);
	}

	setLoop(loop: boolean) {
		this.update((c) => ({ ...c, loop: loop || undefined }));
	}

	setDrives(drives: boolean) {
		const ids = new Set(this.lanes.map((l) => l.id));
		this.#host.onBeforeEdit?.();
		this.#host.onChange(
			this.#host.lanes.map((l) => (ids.has(l.id) ? { ...l, drives } : l)),
		);
	}
}
