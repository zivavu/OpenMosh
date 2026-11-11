/** Opening an editor project: its saved timeline, or a fresh one sized by its song and
 * seeded from the opened file. Nothing saves until it's ready. Runs effects, so
 * construct during component init. */

import { untrack } from "svelte";
import type { createSpanHistory } from "../audio/span-history.svelte";
import type { MediaClip, MediaLane, MediaTimeline } from "../media";
import type { SequenceMixer } from "../mix/mixer.svelte";
import type { TextTimeline } from "../text";
import type { ChainTimelineState } from "./chain-timeline-state.svelte";
import type { FxLaneState } from "./fx-lane-state.svelte";
import type { LegacySegmentEntry } from "./seq-entry";
import {
	readCachedSavedSequences,
	listSavedSequences,
} from "./saved-sequences";
import { readProjectNames, setProjectName, uniqueName } from "./project-names";
import { seedLength, seedTimeline } from "./project-seed";
import type { ProjectTempo } from "./project-tempo.svelte";
import type { SaveTracker } from "./save-status.svelte";
import type {
	SequenceSource,
	SequenceSourceRegistry,
} from "./sequence-sources.svelte";
import type { TimelinePersistence } from "./timeline-persistence.svelte";

export interface ProjectOpenerHost {
	/** Editor mode; single mode has no project to open. */
	active: boolean;
	projectKey(): string | null;
	storeKey(): string | null;
	prefix: string;
	timelines: TimelinePersistence;
	saves: SaveTracker;
	tempo: ProjectTempo;
	fx: FxLaneState;
	media: ChainTimelineState<MediaTimeline, MediaLane, MediaClip>;
	registry: SequenceSourceRegistry;
	mixer: SequenceMixer;
	spanHistory: ReturnType<typeof createSpanHistory>;
	restoreText(timeline: TextTimeline | null): void;
	restoreMedia(timeline: MediaTimeline | null): void;
	setLegacySegments(
		pending: { key: string; segments: LegacySegmentEntry[] } | null,
	): void;
	currentTrackId(): string | null;
	loadSong(trackId: string | null): Promise<void>;
	/** What a new project is named after: its song, else the file it opened with. */
	openedName(): string;
	/** The song a new project is sized by: undefined until its sound is decoded. */
	song(): { id: string | null; length: number } | undefined;
	/** The opened file in the pool, once it's in. */
	openedSource(): SequenceSource | null;
	/** The opening adds are done, whether or not the file made it in. */
	openDone(): boolean;
	contentEnd(): number;
	/** Before v3 the span was kept per song. */
	legacySpan(trackId: string): { spanStart: number; spanEnd: number } | null;
	/** A new project has nothing to undo. */
	resetHistories(): void;
	onReady(key: string): void;
}

export class ProjectOpener {
	readonly #host: ProjectOpenerHost;
	#loadedFor: string | null = null;
	/** A project still working out its length, from its song and its opened media. */
	#pending = $state<{ key: string; seed: boolean } | null>(null);

	/** The project knows its length; nothing saves before. */
	ready = $state(false);

	constructor(host: ProjectOpenerHost) {
		this.#host = host;
		// Ready means it saves from here on, so a reload can come back to it.
		$effect(() => {
			const key = host.projectKey();
			if (host.active && this.ready && key) host.onReady(key);
		});
		$effect(() => {
			if (!host.active) return;
			const key = host.projectKey();
			if (!key || key === this.#loadedFor) return;
			this.#loadedFor = key;
			void this.#load(key);
		});
		// The song's length and the opened file are what a project without one is sized by.
		$effect(() => {
			const pending = this.#pending;
			if (!pending || pending.key !== host.storeKey()) return;
			const song = host.song();
			if (!song) return;
			const first = host.openedSource();
			// An opened file that never decoded won't seed anything; don't wait on it forever.
			if (pending.seed && !first && !host.openDone()) return;
			this.#pending = null;
			untrack(() =>
				this.#finish(pending.seed ? first : null, song.id, song.length),
			);
		});
	}

	/** A second project from the same song or file reads "name (2)", not as the first. */
	async #name(key: string, name: string) {
		const saved = await listSavedSequences().catch(readCachedSavedSequences);
		const names = readProjectNames();
		const taken = saved
			.filter((p) => p.trackId !== key)
			.map((p) => names[p.trackId] ?? p.trackName);
		setProjectName(key, uniqueName(name, taken));
	}

	async #load(key: string) {
		const host = this.#host;
		const { timelines, saves, tempo, mixer } = host;
		const storeKey = host.prefix + key;
		const stillOpen = () => host.storeKey() === storeKey;
		timelines.loadedKey = null;
		this.ready = false;
		// Pending from the start, so the bar can't say Saved before the name is stored.
		const unnamed = key.startsWith("proj-") && !readProjectNames()[key];
		if (unnamed) saves.schedule("name");
		let saved: Awaited<ReturnType<TimelinePersistence["load"]>>;
		try {
			saved = await timelines.load(key);
		} catch (e) {
			if (unnamed) saves.drop("name");
			throw e;
		}
		const naming =
			unnamed && saved === null && stillOpen() && !timelines.isHeld(storeKey);
		if (unnamed && !naming) saves.drop("name");
		if (!stillOpen()) return;
		timelines.loadedKey = storeKey;
		// Not ready, so nothing of it is seeded or saved over.
		if (timelines.isHeld(storeKey)) return;
		if (saved === null) {
			// Named after its song, else what it was opened with, until the user names it.
			if (naming) {
				await saves.track(
					"name",
					this.#name(key, host.openedName()).then(() => true),
				);
				if (!stillOpen()) return;
			}
			tempo.poolSource = null;
			this.#pending = { key: storeKey, seed: true };
			return;
		}
		tempo.poolSource = saved.bpmSource ?? null;
		tempo.restore(saved.bpm, saved.beatOffset);
		host.fx.restore(saved.fx);
		host.restoreText(saved.text);
		host.restoreMedia(saved.media);
		host.registry.restoreEdits(saved.sourceEdits);
		host.setLegacySegments(
			saved.segments.length
				? { key: storeKey, segments: saved.segments }
				: null,
		);
		const track = host.currentTrackId();
		// Before v3 the song was the clock, so it has to be in before the project is sized.
		if (saved.length === null && saved.song && saved.song !== track) {
			await host.loadSong(saved.song);
			if (!stillOpen()) return;
		}
		if (saved.length === null) {
			// Saved while the song was the clock: it becomes a lane once its length is known.
			this.#pending = { key: storeKey, seed: false };
			return;
		}
		mixer.setDuration(saved.length);
		if (saved.span) {
			mixer.spanStart = saved.span.start;
			mixer.spanEnd = saved.span.end;
		}
		if (saved.song !== undefined && saved.song !== host.currentTrackId()) {
			await host.loadSong(saved.song);
		}
		host.spanHistory.reset();
		this.ready = true;
	}

	#finish(
		seedFrom: SequenceSource | null,
		songId: string | null,
		songLength: number,
	) {
		const host = this.#host;
		const { mixer, media } = host;
		const length = seedLength({
			songLength,
			contentEnd: host.contentEnd(),
			mediaLength: seedFrom?.duration ?? 0,
		});
		mixer.setDuration(length);
		const track = host.currentTrackId();
		const savedSpan = track ? host.legacySpan(track) : null;
		if (savedSpan && savedSpan.spanEnd > savedSpan.spanStart) {
			mixer.spanStart = Math.min(savedSpan.spanStart, length);
			mixer.spanEnd = Math.min(savedSpan.spanEnd, length);
		} else {
			mixer.spanStart = 0;
			mixer.spanEnd = length;
		}
		media.timeline = seedTimeline(media.timeline, {
			length,
			song: songId ? { sourceId: songId, length: songLength } : null,
			mediaSourceId: seedFrom?.id ?? null,
		});
		host.resetHistories();
		host.spanHistory.reset();
		this.ready = true;
	}
}
