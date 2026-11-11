/** Files going into the editor's pool, and toasts for the ones that didn't. */

import { showToast } from "../components/ui/toast.svelte";
import {
	updateMediaLane,
	type MediaClip,
	type MediaLane,
	type MediaTimeline,
} from "../media";
import { isMeshFile } from "../mesh";
import {
	diagnoseModel,
	isOtherModelFile,
	type ModelProblem,
} from "../mesh/support";
import type { ChainTimelineState } from "./chain-timeline-state.svelte";
import { stableSourceId } from "./sequence-media-store";
import type { SequenceSourceRegistry } from "./sequence-sources.svelte";

export interface PoolAddsHost {
	registry: SequenceSourceRegistry;
	media(): ChainTimelineState<MediaTimeline, MediaLane, MediaClip>;
	/** Editor mode: the pool persists and takes models. */
	persistent(): boolean;
	slideOnlyIds(): ReadonlySet<string>;
	setSlideOnlyIds(ids: ReadonlySet<string>): void;
	/** 3D files turned down, for the dialog that says why. */
	reportModelProblems(problems: ModelProblem[]): void;
}

export function createPoolAdds(host: PoolAddsHost) {
	const { registry } = host;

	/** Files the pool holds already, or that repeat one earlier in the batch. */
	function alreadyPooled(files: File[]): File[] {
		const seen = new Set<string>();
		return files.filter((f) => {
			const id = stableSourceId(f);
			const repeat = seen.has(id) || !!registry.get(id);
			seen.add(id);
			return repeat;
		});
	}

	/** Say why models that didn't make the pool were turned down; returns how many. */
	async function explainRejectedModels(files: File[]): Promise<number> {
		const rejected = files.filter(
			(f) =>
				isOtherModelFile(f) ||
				(isMeshFile(f) && !registry.get(stableSourceId(f))),
		);
		if (rejected.length === 0) return 0;
		host.reportModelProblems(await Promise.all(rejected.map(diagnoseModel)));
		return rejected.length;
	}

	async function addSequenceSources(files: File[]) {
		const persist = host.persistent();
		if (!persist && files.some(isMeshFile)) {
			showToast("3D models work in the Editor", "error");
			files = files.filter((f) => !isMeshFile(f));
		}
		const otherModels = files.filter(isOtherModelFile);
		files = files.filter((f) => !isOtherModelFile(f));
		const repeats = alreadyPooled(files);
		// Added on its own, a slideshow's slide joins the pool's list.
		const hidden = host.slideOnlyIds();
		const own = files.map(stableSourceId).filter((id) => hidden.has(id));
		if (own.length > 0) {
			host.setSlideOnlyIds(
				new Set([...hidden].filter((id) => !own.includes(id))),
			);
		}
		// Single mode's pool is session-scoped: no song to persist under.
		const added = await registry.add(files, { persist });
		if (persist && added.some((s) => s.kind === "model")) {
			showToast("To turn a model, add a 3D Transform to its clip", "info");
		}
		const rejectedModels = await explainRejectedModels([
			...otherModels,
			...files,
		]);
		const skipped =
			files.length -
			added.length -
			repeats.length -
			(rejectedModels - otherModels.length);
		if (skipped > 0) {
			showToast(
				`Skipped ${skipped} file${skipped === 1 ? "" : "s"} that couldn't be decoded`,
				"error",
			);
		}
		if (repeats.length > 0 && added.length === 0 && skipped <= 0) {
			showToast(
				repeats.length === 1
					? `"${repeats[0].name}" is already in the pool`
					: `Those ${repeats.length} files are already in the pool`,
				"info",
			);
		}
		return added;
	}

	return {
		addSequenceSources,
		explainRejectedModels,

		/** Add to the pool, then seat a source-less lane on the first file added. */
		async addLayerSources(files: File[]) {
			const added = await addSequenceSources(files);
			// An image the browser couldn't read may already be out of the pool.
			const first = added.find((s) => registry.get(s.id));
			if (!first) return;
			const media = host.media();
			// Nothing anywhere on the lane to draw; clips that each point somewhere
			// already carry media.
			const unset = media.timeline.lanes.find(
				(l) => !l.sourceId && l.clips.every((c) => !c.sourceId),
			);
			if (!unset) return;
			media.pushHistory();
			media.set(
				updateMediaLane(media.timeline, unset.id, (l) => ({
					...l,
					sourceId: first.id,
				})),
			);
		},
	};
}
