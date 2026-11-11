/** Single mode's autosave: the file, its chain, its text and its song span, written as
 * one session once there's something in it. Runs an effect, so construct it during
 * component init. */

import { untrack } from "svelte";
import type { SaveTracker } from "./save-status.svelte";
import {
	pruneSequenceMediaThrottled,
	StaleWriteError,
} from "./sequence-media-store";
import { saveSession, type SingleSessionState } from "./sessions";

export interface SingleSessionSaveHost {
	/** Single mode; the editor saves its own way. */
	active(): boolean;
	/** A live camera feed is never kept. */
	live(): boolean;
	/** The edit has been moshed or tweaked. */
	worked(): boolean;
	hasText(): boolean;
	/** The state to write; read in full, so a change to any of it re-saves. */
	state(): SingleSessionState;
	file(): File | null;
	trackId(): string | null;
	sessionKey: string | null;
	/** Held: newer or unreadable elsewhere, so nothing of it is written. */
	held(): boolean;
	/** Another tab wrote it since. */
	onStale(): void;
	playing(): boolean;
	saves: SaveTracker;
	onSaved(key: string): void;
	initiallyStored: boolean;
}

export class SingleSessionSave {
	readonly #host: SingleSessionSaveHost;
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** As the editor's `seqSavePending`, for the single edit's session. */
	#pending = false;

	/** Once stored, an edit keeps saving, or removing its last text would leave that
	 * text saved. */
	stored = $state(false);

	/** Kept once there's something in it; a camera never. Lane presence, not
	 * `enabled`: keying off the visibility toggle would discard hidden timelines. */
	kept = $derived.by(() => this.#kept());

	/** Why the top bar says this edit isn't kept, when it isn't. */
	notSaved = $derived.by(() => this.#notSaved());

	constructor(host: SingleSessionSaveHost) {
		this.#host = host;
		this.stored = host.initiallyStored;
		$effect(() => this.#schedule());
	}

	#kept(): boolean {
		const host = this.#host;
		return (
			host.active() &&
			!host.live() &&
			(this.stored || host.worked() || host.hasText())
		);
	}

	#notSaved(): { reason: string; warn: boolean } | null {
		const host = this.#host;
		if (!host.active()) return null;
		if (host.live()) {
			return {
				reason:
					"A live camera feed isn't saved. Take a snapshot to keep working on a frame.",
				warn: true,
			};
		}
		if (!this.kept) {
			return {
				reason:
					"Nothing to keep yet. Change an effect or add text and this edit is saved in this browser.",
				warn: false,
			};
		}
		return null;
	}

	#schedule() {
		const host = this.#host;
		if (!host.active()) return;
		// Skipped while playing, like the editor's save: the volume-link tick mutates the chain.
		if (host.playing()) {
			this.#pending = true;
			return;
		}
		host.state();
		host.file();
		// Loading a different song re-keys the session, so it has to re-save.
		host.trackId();
		if (!this.kept) {
			// An undo back to nothing kept: a save scheduled a moment ago has nothing to write.
			if (this.#pending && !untrack(() => this.stored)) {
				this.#pending = false;
				untrack(() => host.saves.drop("session"));
			}
			return;
		}
		clearTimeout(this.#timer);
		untrack(() => host.saves.schedule("session"));
		this.#pending = true;
		this.#timer = setTimeout(() => this.save(), 600);
		return () => clearTimeout(this.#timer);
	}

	save() {
		const host = this.#host;
		this.#pending = false;
		const source = host.file();
		if (!this.kept || !source || host.held()) {
			host.saves.drop("session");
			return;
		}
		const key = host.sessionKey!;
		// Keyed by the song when there is one, alongside the text timeline and span.
		const write = saveSession(
			key,
			"single",
			[source],
			host.state(),
			host.trackId(),
		).catch((e) => {
			if (e instanceof StaleWriteError) {
				host.onStale();
				return false;
			}
			// Logged, not swallowed: a silent failure here is invisible.
			if (import.meta.env.DEV) console.error("Session save failed:", e);
			return false;
		});
		void host.saves.track("session", write).then((ok) => {
			if (!ok) return;
			this.stored = true;
			host.onSaved(key);
			void pruneSequenceMediaThrottled().catch(() => {});
		});
	}

	/** Backing out shouldn't race the debounce and lose the last edit. */
	flush() {
		clearTimeout(this.#timer);
		if (this.#pending) this.save();
	}
}
