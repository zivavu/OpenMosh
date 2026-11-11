/** Saved slideshows and single edits brought into the editor as one clip each, and
 * updated from their saves later. */

import { showToast } from "../components/ui/toast.svelte";
import {
	autoOnSlideshow,
	createMediaClip,
	findMediaClip,
	MAX_MEDIA_LANES,
	retargetMediaSource,
	setMediaClipSources,
	type MediaClip,
	type MediaLane,
	type MediaTimeline,
} from "../media";
import { updateMediaClips } from "../media/resolve";
import { MAX_AUDIO_LANES, trackSourceId } from "../mix/types";
import type { ChainTimelineState } from "./chain-timeline-state.svelte";
import { asOneEdit } from "./edit-clock";
import { addProjectLane } from "./project-lane";
import { stableSourceId } from "./sequence-media-store";
import { droppedClipLength } from "./sequence-source-ui";
import type {
	SequenceSource,
	SequenceSourceRegistry,
} from "./sequence-sources.svelte";
import {
	openSavedSingle,
	singleClipIds,
	withSingleChain,
	type SavedSingle,
} from "./single-source";
import { freezeSavedSlideshow } from "./slideshow-source";

export interface ProjectImportsHost {
	registry: SequenceSourceRegistry;
	media: ChainTimelineState<MediaTimeline, MediaLane, MediaClip>;
	/** Pool media listed only as a slideshow's slides. */
	slideOnlyIds(): ReadonlySet<string>;
	setSlideOnlyIds(ids: ReadonlySet<string>): void;
	/** Decodes these audio sources before a lane plays them. */
	settleAudio(ids: string[]): Promise<void>;
	hasSong(): boolean;
	loadSong(trackId: string | null): Promise<void>;
	projectLength(): number;
	growProjectTo(length: number): void;
	playhead(): number;
	nextLaneZ(): number;
	revealLane(laneId: string): void;
	/** The pool as it is now; call the result to record it as an undo step. */
	capturePool(): () => void;
	dropFromPool(sourceId: string): void;
	closePicker(): void;
}

export function createProjectImports(host: ProjectImportsHost) {
	const { registry, media } = host;

	/** Lays the project on its own lane from the playhead, with its song under it
	 * when asked and there's room. The project grows to fit. */
	async function placeOnTop(opts: {
		sourceId: string;
		name: string;
		length: number;
		makeClip: (start: number, end: number) => MediaClip;
		song: { trackId: string; sourceStart: number } | null;
	}) {
		const start = host.playhead();
		const end = start + opts.length;
		const audioLanes = media.timeline.audioLanes ?? [];
		const songId =
			opts.song && audioLanes.length < MAX_AUDIO_LANES
				? trackSourceId(opts.song.trackId)
				: null;
		if (songId) await host.settleAudio([songId]);
		const asSong = !!songId && !host.hasSong();
		const clip = opts.makeClip(start, end);

		asOneEdit(() => {
			if (end > host.projectLength()) host.growProjectTo(end);
			const { timeline, laneId } = addProjectLane(media.timeline, {
				sourceId: opts.sourceId,
				name: opts.name,
				clip,
				z: host.nextLaneZ(),
				song: songId
					? { sourceId: songId, sourceStart: opts.song!.sourceStart, asSong }
					: null,
			});
			media.pushHistory();
			media.set(timeline);
			media.selectedClipId = clip.id;
			media.selectedClipIds = [clip.id];
			host.revealLane(laneId);
		});
		if (asSong) await host.loadSong(opts.song!.trackId);
	}

	/** Slides first, so the slideshow's thumbnail finds them. Media already in the pool
	 * stays listed; the rest hides behind the slideshow. */
	async function addSlideshowSource(
		slides: File[],
		cutFile: File,
	): Promise<SequenceSource | null> {
		const fresh = slides.map(stableSourceId).filter((id) => !registry.get(id));
		if (fresh.length > 0) {
			host.setSlideOnlyIds(new Set([...host.slideOnlyIds(), ...fresh]));
		}
		await registry.add(slides);
		const missing = slides.filter((f) => !registry.get(stableSourceId(f)));
		if (missing.length === slides.length) {
			showToast("None of that slideshow's slides could be read", "error");
			return null;
		}
		const [cuts] = await registry.add([cutFile]);
		return cuts ?? null;
	}

	/** The edit's file joins the pool listed, with its crop, key and erase unless the
	 * pool already has its own. */
	async function addSingleSource(
		saved: SavedSingle,
	): Promise<SequenceSource | null> {
		const id = stableSourceId(saved.file);
		const hidden = host.slideOnlyIds();
		if (hidden.has(id)) {
			host.setSlideOnlyIds(new Set([...hidden].filter((s) => s !== id)));
		}
		await registry.add([saved.file]);
		const source = registry.get(id);
		if (!source) {
			showToast("That edit's media couldn't be read", "error");
			return null;
		}
		if (saved.sourceEdit && !registry.edits[id]) {
			registry.setEdit(id, saved.sourceEdit);
		}
		return source;
	}

	function laneRoomFor(what: string): boolean {
		if (media.timeline.lanes.length < MAX_MEDIA_LANES) return true;
		showToast(`No room for the ${what}: every lane is full`, "error");
		return false;
	}

	/** Records the pool and the lanes as one undo step. */
	function pushPoolAndLanes(recordPool: () => void) {
		asOneEdit(() => {
			recordPool();
			media.pushHistory();
		});
	}

	return {
		async addSlideshow(sessionKey: string, name: string, includeSong: boolean) {
			const frozen = await freezeSavedSlideshow(sessionKey, name).catch(
				() => null,
			);
			if (!frozen) {
				showToast("That slideshow couldn't be opened", "error");
				return;
			}
			if (!laneRoomFor("slideshow")) return;
			const cuts = await addSlideshowSource(frozen.slides, frozen.cutFile);
			if (!cuts) return;
			host.closePicker();
			await placeOnTop({
				sourceId: cuts.id,
				name,
				length: frozen.cutList.duration,
				makeClip: (start, end) =>
					autoOnSlideshow(createMediaClip(start, end), true),
				song:
					includeSong && frozen.trackId
						? {
								trackId: frozen.trackId,
								sourceStart: frozen.cutList.songStart,
							}
						: null,
			});
		},

		/** Freeze a slideshow source again: its clips show the new cuts, keeping their
		 * place and effects, and slides it dropped leave the pool. */
		async refreshSlideshow(sourceId: string) {
			const old = registry.get(sourceId)?.cutList;
			if (!old) return;
			const frozen = await freezeSavedSlideshow(old.sessionKey, old.name).catch(
				() => null,
			);
			if (!frozen) {
				showToast("Couldn't find that slideshow to update from", "error");
				return;
			}
			const recordPool = host.capturePool();
			const cuts = await addSlideshowSource(frozen.slides, frozen.cutFile);
			if (!cuts) return;
			pushPoolAndLanes(recordPool);
			media.set(retargetMediaSource(media.timeline, sourceId, cuts.id));
			host.dropFromPool(sourceId);
			showToast(`Updated “${old.name}”`, "info");
		},

		/** Its media with its chain held on the clip, and its song under it. */
		async addSingleEdit(
			sessionKey: string,
			name: string,
			includeSong: boolean,
		) {
			const saved = await openSavedSingle(sessionKey).catch(() => null);
			if (!saved) {
				showToast("That edit couldn't be opened", "error");
				return;
			}
			if (!laneRoomFor("edit")) return;
			const source = await addSingleSource(saved);
			if (!source) return;
			host.closePicker();
			const span = saved.songSpan;
			await placeOnTop({
				sourceId: source.id,
				name,
				length: span
					? span.end - span.start
					: droppedClipLength(source, registry.edits[source.id]),
				makeClip: (start, end) => ({
					...withSingleChain(createMediaClip(start, end), saved.effects),
					single: { sessionKey, name },
				}),
				song:
					includeSong && span && saved.trackId
						? { trackId: saved.trackId, sourceStart: span.start }
						: null,
			});
		},

		/** Read the single edit again: its clips take its chain and media now, keeping
		 * their place and what's locked on them. */
		async refreshSingleEdit(sessionKey: string) {
			const saved = await openSavedSingle(sessionKey).catch(() => null);
			if (!saved) {
				showToast("Couldn't find that edit to update from", "error");
				return;
			}
			const recordPool = host.capturePool();
			const source = await addSingleSource(saved);
			if (!source) return;
			const ids = singleClipIds(media.timeline, sessionKey);
			const name = findMediaClip(media.timeline, ids[0] ?? null)?.single?.name;
			pushPoolAndLanes(recordPool);
			const next = updateMediaClips(media.timeline, new Set(ids), (clip) =>
				withSingleChain(clip, saved.effects),
			);
			media.set(setMediaClipSources(next, ids, source.id));
			showToast(name ? `Updated “${name}”` : "Updated", "info");
		},
	};
}
