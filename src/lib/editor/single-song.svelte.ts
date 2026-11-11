/** Single mode's song: loading one, swapping it for another, and bringing back what was
 * saved against it (its trim, its tempo, its timeline). */

import type { AudioManager } from "../audio/audio-manager.svelte";
import type { MediaTimeline } from "../media";
import type { TextTimeline } from "../text";
import type { FxLaneState } from "./fx-lane-state.svelte";
import type { PoolPersistence } from "./pool-persistence.svelte";
import type { ProjectTempo } from "./project-tempo.svelte";
import type { SequenceSourceRegistry } from "./sequence-sources.svelte";
import type { TimelinePersistence } from "./timeline-persistence.svelte";

type Span = { start: number; end: number };

export interface SingleSongHost {
	audio: AudioManager;
	timelines: TimelinePersistence;
	pool: PoolPersistence;
	tempo: ProjectTempo;
	fx: FxLaneState;
	registry: SequenceSourceRegistry;
	restoreText(timeline: TextTimeline | null): void;
	restoreMedia(timeline: MediaTimeline | null): void;
	trackId(): string | null;
	setTrackId(id: string | null): void;
	storeKey(): string | null;
	prefix: string;
	/** An edit keyed by its own id saves its timeline there, whatever song it plays. */
	projectBase: string | null;
	/** The trim last kept for a song. */
	savedSpan(trackId: string): { spanStart: number; spanEnd: number } | null;
	/** The opened edit's own trim, used up by the first song it loads. */
	initialSpan: Span | null;
}

export class SingleSong {
	readonly #host: SingleSongHost;
	#sessionSpan: Span | null;
	/** A dropped or picked song replaced another, so it starts without that one's text. */
	#songLeft = false;

	constructor(host: SingleSongHost) {
		this.#host = host;
		this.#sessionSpan = host.initialSpan;
	}

	/** A new song file in place of the current one; it gets its id on registering. */
	replaceFile(file: File) {
		const left = !!this.#host.trackId();
		this.clear();
		this.#songLeft = left;
		this.#host.audio.trackFile = file;
	}

	clear() {
		const host = this.#host;
		// Before the key changes out from under them; see TimelinePersistence.flush.
		host.timelines.flush();
		host.pool.flush();
		host.audio.clearTrack();
		host.setTrackId(null);
		// Belongs to the song that just left; the next one restores or detects its own.
		host.tempo.forget();
	}

	/** A library song picked to play. The pool is deliberately left alone. */
	load(file: File, trackId: string, autoplay: boolean) {
		const host = this.#host;
		const previous = host.trackId();
		const switchingSongs = !!previous && previous !== trackId;
		this.clear();
		this.#songLeft = false;
		host.setTrackId(trackId);
		host.audio.trackFile = file;
		void this.#restore(trackId, switchingSongs);
		if (autoplay) host.audio.autoplayOnLoad = true;
	}

	/** The song now has this library id, without being asked to load it. */
	adopted(trackId: string) {
		const switchingSongs = this.#songLeft;
		this.#songLeft = false;
		void this.#restore(trackId, switchingSongs);
	}

	/** Pull back whatever was stored against a song. Moving between songs starts the new
	 * one clean when it has nothing saved. */
	async #restore(trackId: string, clearOnMissing: boolean) {
		const host = this.#host;
		// The edit's own trim wins for its first song: a project file brings only that.
		const own = this.#sessionSpan;
		this.#sessionSpan = null;
		const savedSpan = own
			? { spanStart: own.start, spanEnd: own.end }
			: host.savedSpan(trackId);
		// An empty span is left by an overwrite, never a user choice.
		if (savedSpan !== null && savedSpan.spanEnd > savedSpan.spanStart) {
			host.audio.pendingSpan = {
				start: savedSpan.spanStart,
				end: savedSpan.spanEnd,
			};
		}
		if (host.projectBase) {
			await this.#restoreTempo(trackId, host.projectBase);
			return;
		}
		const key = host.prefix + trackId;
		host.timelines.loadedKey = null;
		const saved = await host.timelines.load(trackId);
		// A later switch overtook this load; that one owns the state now.
		if (host.storeKey() !== key) return;
		host.timelines.loadedKey = key;
		if (saved === null) {
			// The last song's text stays saved under its own key.
			if (clearOnMissing) {
				host.fx.restore([]);
				host.restoreText(null);
			}
			return;
		}
		// Beat-synced effects read the BPM in single mode too.
		host.tempo.restore(saved.bpm, saved.beatOffset);
		host.restoreText(saved.text);
		host.restoreMedia(saved.media);
		host.registry.restoreEdits(saved.sourceEdits);
	}

	/** The tempo for a song in an edit with its own key: what the edit found for it, else
	 * what the song's older single-mode timeline kept. Neither leaves detection to run. */
	async #restoreTempo(trackId: string, projectBase: string) {
		const { timelines, tempo } = this.#host;
		const [own, song] = await Promise.all([
			timelines.load(projectBase),
			timelines.load(trackId),
		]);
		if (this.#host.trackId() !== trackId) return;
		const found = own?.song === trackId && own.bpm > 0 ? own : song;
		if (found && found.bpm > 0) tempo.restore(found.bpm, found.beatOffset);
	}
}
