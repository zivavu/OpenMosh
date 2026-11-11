/** Where the editor's timeline lives in storage: reading this mode's entry, the
 * debounced autosave and its flush, and holding an entry that mustn't be written over
 * (saved by a newer OpenMosh, unreadable, or changed in another tab). The autosave is an
 * effect, so construct during component init. */

import { showToast } from "../components/ui/toast.svelte";
import { untrack } from "svelte";
import type { SaveTracker } from "./save-status.svelte";
import {
	isNewerEntry,
	readSeqEntry,
	type RestoredEntry,
	type SeqEntry,
} from "./seq-entry";
import { StaleWriteError } from "./sequence-media-store";
import { loadTimeline, saveTimeline } from "./timeline-store";

export type HoldReason = "newer" | "unreadable" | "elsewhere";

const HOLD_MESSAGES: Record<HoldReason, string> = {
	newer:
		"A newer version of OpenMosh saved this. Reload the page to open it; changes here won't be saved.",
	elsewhere:
		"This project changed in another tab. Reload the page to see it; changes here won't be saved.",
	unreadable:
		"Couldn't read this project's saved timeline. Reload the page to try again; changes here won't be saved.",
};

export interface TimelinePersistenceHost {
	saves: SaveTracker;
	/** Store keys are namespaced per mode ("seq:", "single:"). */
	prefix: string;
	/** The editor also reads the entry saved before keys had a prefix. */
	readsLegacy: boolean;
	/** The key the screen's timeline belongs to now. */
	storeKey(): string | null;
	/** What to save, read deep; null while there's nothing to save yet. */
	entry(): SeqEntry | null;
	playing(): boolean;
	/** The opened file's pool id, which a legacy entry's base media becomes. */
	baseSourceId(): string;
}

export class TimelinePersistence {
	readonly #host: TimelinePersistenceHost;
	readonly #held = new Set<string>();
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** Something on screen isn't written yet. Playback counts: it skips the debounce.
	 * Flushes write only then, or an idle tab closing would save its stale copy over
	 * another tab's newer work. */
	#pending = false;
	/** Only the transition into failure is announced, or it would toast every tick. */
	#failed = false;
	/** The key whose stored timeline has landed; saving waits for the screen's to match. */
	loadedKey: string | null = null;

	constructor(host: TimelinePersistenceHost) {
		this.#host = host;
		$effect(() => this.#schedule());
	}

	isHeld(key: string | null): boolean {
		return !!key && this.#held.has(key);
	}

	/** Leave the entry as it is, never written over, and say why once. */
	hold(key: string, reason: HoldReason) {
		if (this.#held.has(key)) return;
		this.#held.add(key);
		showToast(HOLD_MESSAGES[reason], "error", 0);
	}

	/** A save another tab got to first holds the entry rather than writing over it. */
	holdIfStale(key: string, write: Promise<boolean>): Promise<boolean> {
		return write.catch((err) => {
			if (!(err instanceof StaleWriteError)) throw err;
			this.hold(key, "elsewhere");
			return false;
		});
	}

	/** This mode's entry for a base key, or the legacy un-prefixed one. */
	async load(baseKey: string): Promise<RestoredEntry | null> {
		const { prefix, readsLegacy } = this.#host;
		const key = prefix + baseKey;
		let entry: SeqEntry | null;
		try {
			entry =
				(await loadTimeline<SeqEntry>(key)) ??
				(readsLegacy ? await loadTimeline<SeqEntry>(baseKey) : null);
		} catch {
			this.hold(key, "unreadable");
			return null;
		}
		if (entry && isNewerEntry(entry)) {
			this.hold(key, "newer");
			return null;
		}
		return entry && readSeqEntry(entry, this.#host.baseSourceId());
	}

	// Skipped while playing: the volume-link tick mutates the chains each frame.
	#schedule() {
		const host = this.#host;
		if (host.playing()) {
			this.#pending = true;
			return;
		}
		const entry = host.entry();
		const key = host.storeKey();
		if (!key || key !== this.loadedKey || !entry) return;
		if (this.#held.has(key)) return;
		clearTimeout(this.#timer);
		untrack(() => host.saves.schedule("timeline"));
		this.#pending = true;
		this.#timer = setTimeout(() => {
			this.#pending = false;
			this.#write(key, entry);
		}, 300);
	}

	#write(key: string, entry: SeqEntry) {
		void this.#host.saves
			.track("timeline", this.holdIfStale(key, saveTimeline(key, entry)))
			.then((ok) => this.#report(ok));
	}

	#report(ok: boolean) {
		// A held entry has said so already.
		if (!ok && this.isHeld(this.#host.storeKey())) return;
		if (ok === !this.#failed) return;
		this.#failed = !ok;
		if (ok) return;
		showToast(
			"Couldn't save this timeline — your recent changes may not survive a reload.",
			"error",
			10000,
		);
	}

	/** Write the current timeline under the current key now; a key switch outruns the
	 * effect. */
	flush() {
		clearTimeout(this.#timer);
		if (!this.#pending) return;
		this.#pending = false;
		const key = this.#host.storeKey();
		const entry = this.#host.entry();
		if (!key || key !== this.loadedKey || !entry || this.#held.has(key)) {
			this.#host.saves.drop("timeline");
			return;
		}
		this.#write(key, entry);
	}
}
