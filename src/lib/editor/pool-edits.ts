/** Removing pool media, undoably: the undo stack holds the files themselves, so a
 * removed one can come back with its clips. */

import {
	createSourceEdit,
	detachMediaSource,
	type MediaClip,
	type MediaLane,
	type MediaTimeline,
	type SourceEdit,
} from "../media";
import { createSnapshotHistory } from "../timeline/snapshot-history.svelte";
import type { ChainTimelineState } from "./chain-timeline-state.svelte";
import { asOneEdit } from "./edit-clock";
import type {
	SequenceSource,
	SequenceSourceRegistry,
} from "./sequence-sources.svelte";
import { slidesLeftBehind } from "./slideshow-source";

/** The pool as undo holds it: files by reference. */
export interface PoolEntry {
	id: string;
	file: File;
	edit?: SourceEdit;
}

export interface PoolEditsHost {
	/** Read per call: the registry is built with this module's add hook. */
	registry(): SequenceSourceRegistry;
	media(): ChainTimelineState<MediaTimeline, MediaLane, MediaClip>;
	slideOnlyIds(): ReadonlySet<string>;
}

export function createPoolEdits(host: PoolEditsHost) {
	const history = createSnapshotHistory<PoolEntry[]>();
	/** Ids an undo or redo is bringing back, which the stack already holds. */
	const undoIds = new Set<string>();

	function poolNow(): PoolEntry[] {
		const registry = host.registry();
		return registry.sources.map((s) => ({
			id: s.id,
			file: s.file,
			edit: registry.edits[s.id],
		}));
	}

	function detach(id: string) {
		const media = host.media();
		media.set(detachMediaSource(media.timeline, id));
	}

	/** Records the pool and the lanes as one undo step, before a removal. */
	function pushRemoval() {
		asOneEdit(() => {
			history.push(poolNow());
			host.media().pushHistory();
		});
	}

	/** A slideshow takes the slides only it played with it. */
	function dropFromPool(id: string) {
		const registry = host.registry();
		const slides = slidesLeftBehind(
			registry.sources,
			id,
			host.media().timeline,
			host.slideOnlyIds(),
		);
		for (const gone of [id, ...slides]) {
			registry.remove(gone);
			detach(gone);
		}
	}

	return {
		poolHistory: history,
		poolNow,
		dropFromPool,

		/** Adds aren't undoable, so every stored pool gains them: otherwise undoing an
		 * older removal would take out media added since. */
		keepAddsThroughPoolUndo(added: SequenceSource[]) {
			const fresh = added.filter((s) => !undoIds.has(s.id));
			if (fresh.length === 0) return;
			history.amend((entries) => [
				...entries,
				...fresh
					.filter((s) => !entries.some((e) => e.id === s.id))
					.map((s) => ({ id: s.id, file: s.file })),
			]);
		},

		/** Undo and redo of a removal: the clips come back from the media stack. */
		async setPool(entries: PoolEntry[]) {
			const registry = host.registry();
			const want = new Set(entries.map((e) => e.id));
			for (const s of [...registry.sources]) {
				if (want.has(s.id)) continue;
				registry.remove(s.id);
				detach(s.id);
			}
			// Edits come back too: an undo can be of a crop, key or erase alone.
			for (const e of entries) {
				if (registry.get(e.id)) {
					registry.setEdit(e.id, e.edit ?? createSourceEdit());
				}
			}
			const missing = entries.filter((e) => !registry.get(e.id));
			if (missing.length === 0) return;
			for (const e of missing) undoIds.add(e.id);
			try {
				await registry.add(missing.map((e) => e.file));
			} finally {
				for (const e of missing) undoIds.delete(e.id);
			}
			for (const e of missing) if (e.edit) registry.setEdit(e.id, e.edit);
			entries.forEach((e, to) => {
				const from = registry.sources.findIndex((s) => s.id === e.id);
				if (from !== -1) registry.reorder(from, to);
			});
		},

		removeSequenceSource(id: string) {
			if (!host.registry().get(id)) return;
			pushRemoval();
			dropFromPool(id);
		},

		/** Empty the pool; clips that drew from it lose their media. Undoable like a
		 * single removal. False when there was nothing to clear. */
		clearPool(): boolean {
			const registry = host.registry();
			if (registry.sources.length === 0) return false;
			pushRemoval();
			for (const src of registry.sources) detach(src.id);
			registry.clear();
			return true;
		},
	};
}
