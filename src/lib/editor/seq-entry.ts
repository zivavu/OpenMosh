/** A song's or project's saved timeline, and how every version of it is read back. */

import { records } from "../records";
import { withLegacyAutoChain, type ChainClip } from "./chain-clip";
import { normalizeFxLanes, type FxLane } from "./fx-lanes";
import { normalizeTextTimeline, type TextTimeline } from "../text/types";
import { normalizeMediaTimeline, type MediaTimeline } from "../media/types";
import { normalizeSourceEdits, type SourceEdit } from "../media/source-edit";

/** Bumped when what a saved entry means changes; see SeqEntry.v. v3 moved the song
 * onto an audio lane and gave the project its own length; v4 runs an auto clip's
 * chain after its roll. */
export const SEQ_ENTRY_VERSION = 4;

/** As much of a saved segment as the migration reads. */
export interface LegacySegmentEntry {
	sourceId?: string;
	[key: string]: unknown;
}

export interface SeqEntry {
	/** Absent on entries saved while the opening file was the segments' implicit media. */
	v?: number;
	/** The retired segment lane; folded into the fx and media lanes on load, never saved. */
	segments?: LegacySegmentEntry[];
	/** Absent on entries saved before BPM existed. */
	bpm?: number;
	/** Absent on entries saved before the text timeline existed. */
	text?: TextTimeline;
	/** Absent on entries saved before media layers existed. */
	media?: MediaTimeline;
	/** Absent on entries saved before fx lanes existed. */
	fx?: FxLane[];
	/** Per-source edits, keyed by source id. Sparse: only edited media. */
	sourceEdits?: Record<string, SourceEdit>;
	/** Sequence mode, from v3: the project's own length. Before, the song set it. */
	length?: number;
	/** The export span on the project timeline. */
	span?: { start: number; end: number };
	/** Library id of the song: the BPM source, and what the library shows as loaded. */
	song?: string | null;
	/** A pool source (a video's sound) the BPM was measured from instead of the song. */
	bpmSource?: string;
}

/** A saved entry, normalised into what the editor restores. */
export interface RestoredEntry {
	bpm: number;
	fx: FxLane[];
	text: TextTimeline | null;
	media: MediaTimeline | null;
	sourceEdits: Record<string, SourceEdit>;
	/** Waiting to be folded into the lanes once the song's length is known. */
	segments: LegacySegmentEntry[];
	/** Null when the project sizes itself from its song, as before v3. */
	length: number | null;
	span: { start: number; end: number } | null;
	song: string | null | undefined;
	bpmSource: string | null;
}

/** The span inside the project, or null when nothing of it is left. */
function clampSpan(
	span: SeqEntry["span"],
	length: number,
): { start: number; end: number } | null {
	if (!span || !Number.isFinite(span.start) || !Number.isFinite(span.end))
		return null;
	const start = Math.min(Math.max(0, span.start), length);
	const end = Math.min(span.end, length);
	return end > start ? { start, end } : null;
}

/** Every lane's auto clips, settled to how they rolled before v4. */
function legacyAutoChains<L extends { clips: ChainClip[] }>(lanes: L[]): L[] {
	return lanes.map((lane) => ({
		...lane,
		clips: lane.clips.map(withLegacyAutoChain),
	}));
}

/** `openedSourceId` is the file the editor opened with: before layers took the media
 * over, a segment with no source drew it. */
export function readSeqEntry(
	entry: SeqEntry,
	openedSourceId: string,
): RestoredEntry {
	const segments = records<LegacySegmentEntry>(entry.segments).map((seg) =>
		entry.v ? seg : { ...seg, sourceId: seg.sourceId ?? openedSourceId },
	);
	const length =
		(entry.v ?? 0) >= 3 && (entry.length ?? 0) > 0 ? entry.length! : null;
	const span = length !== null ? clampSpan(entry.span, length) : null;
	const fx = normalizeFxLanes(entry.fx);
	const text = entry.text ? normalizeTextTimeline(entry.text) : null;
	const media = entry.media ? normalizeMediaTimeline(entry.media) : null;
	const legacy = (entry.v ?? 0) < 4;
	return {
		bpm: entry.bpm ?? 0,
		fx: legacy ? legacyAutoChains(fx) : fx,
		text:
			legacy && text ? { ...text, lanes: legacyAutoChains(text.lanes) } : text,
		media:
			legacy && media
				? { ...media, lanes: legacyAutoChains(media.lanes) }
				: media,
		sourceEdits: normalizeSourceEdits(entry.sourceEdits),
		segments,
		length,
		span,
		song: entry.song,
		bpmSource: typeof entry.bpmSource === "string" ? entry.bpmSource : null,
	};
}
