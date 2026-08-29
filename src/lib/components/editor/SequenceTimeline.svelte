<script lang="ts">
	import { Dices, Eraser, Repeat, Shuffle, Trash2 } from 'lucide-svelte';
	import { loadPresets, type Preset } from '../../effects';
	import {
		cloneSegmentForSplit,
		createSequenceSegment,
		BEAT_INTERVALS,
		DEFAULT_TRANSITION_DURATION,
		intervalLabel,
		randomSeed,
		TRANSITION_OPTIONS,
		type SegmentTransition,
		type SegmentTransitionChange,
		type SequenceSegment,
		type SequenceSegmentMode,
		type TransitionType,
	} from '../../editor/sequence';
	import type { SegmentBoundaryController } from '../../editor/segment-boundary-controller.svelte';
	import {
		copySegments,
		pasteClipsAt,
		pasteContentOnto,
		type SegmentClip,
	} from '../../editor/sequence-clipboard';
	import {
		applyChainToSegment,
		chainClipboard,
	} from '../../editor/chain-clipboard';
	import {
		clampGroupDelta,
		collectGroupBoundaries,
		groupBoundaryTimesAfter,
		groupDeltaUpdates,
		nonSelectedBoundaryTimes,
		type GroupBoundary,
	} from '../../editor/boundary-group-drag';
	import {
		isInteractiveTarget,
		isTextEntryTarget,
	} from '../../editor/shortcut-target';
	import { getTimelineStack } from '../../editor/timeline-stack.svelte';
	import { isModalKeyboardOpen } from '../../modal-keyboard';
	import {
		SOURCE_DND_TYPE,
		sourceColor,
	} from '../../editor/sequence-source-ui';
	import type { SequenceSource } from '../../editor/sequence-sources.svelte';

	/**
	 * How short a boundary drag may squeeze a segment. Held in beats rather than
	 * seconds so the floor means the same musical thing at any tempo: 1/32 of a
	 * beat is finer than a mosh can be read at, while still keeping a drag from
	 * collapsing a segment to nothing.
	 */
	const MIN_SEGMENT_BEATS = 1 / 32;
	/** With no tempo to divide, 1/32 of a second — 1/32 beat at 60 BPM. */
	const MIN_SEGMENT_NO_TEMPO = 1 / 32;
	// Segments are drawn as clip blocks in one lane row, matching the text
	// timeline's geometry: a 22px block inset in a 30px row.
	const ROW_PAD = 4;
	const SEG_H = 22;
	/** Half-width of a boundary's invisible grab strip. */
	const BND_GRAB = 5;
	/** Kept out of the markup: the formatter wraps a long <title> body across
	 * lines, and the native tooltip renders that break as a real one. */
	const BND_TIP =
		'Click to set the transition · drag to move (whole selection if selected) · Delete to merge · Shift-drag to select';
	/** Height of the source colour band along a block's bottom edge. */
	const SRC_BAND = 3;
	/**
	 * Below this a label is all ellipsis and no word — a song's worth of
	 * quarter-note segments becomes a row of "mo…", which reads as noise. The
	 * block's tooltip still spells everything out.
	 */
	const MIN_LABEL_PX = 46;

	interface Props {
		segments: SequenceSegment[];
		boundaries: SegmentBoundaryController<SequenceSegment>;
		selectedSegmentId?: string | null;
		/** The whole selection, for toolbar actions that live outside this lane. */
		selectedSegmentIds?: string[];
		onSeek?: (time: number) => void;
		onApplyPreset: (segmentIds: string[], preset: Preset) => void;
		onRoll: (segmentIds: string[]) => void;
		/** Reset the segments to a clean (all effects off) static state. */
		onClear: (segmentIds: string[]) => void;
		onModeChange: (
			segmentIds: string[],
			mode: SequenceSegmentMode,
			intervalSec?: number,
			intervalBeats?: number | null,
		) => void;
		/** 0 when no BPM is known yet — the AUTO picker then offers only seconds. */
		bpm?: number;
		/** Transition config edits, one entry per segment; `null` = hard cut. */
		onTransitionChange: (changes: SegmentTransitionChange[]) => void;
		/** Loop playback inside the selected segment (for editing while playing). */
		segmentLoop?: boolean;
		onToggleSegmentLoop?: () => void;
		/** Media pool the segments draw from, for their number and colour band.
		 * The pool itself is arranged in the grid view, not in here. */
		sources?: SequenceSource[];
		/** Segments with no explicit sourceId render as this one. */
		primarySourceId?: string | null;
		/** Takes a source card dragged out of the grid view onto a segment. */
		onAssignSource?: (segmentIds: string[], sourceId: string) => void;
		/** Deal the pool across an auto segment's re-roll ticks. */
		onSourceRollChange?: (segmentIds: string[], on: boolean) => void;
	}

	let {
		segments: rawSegments,
		boundaries,
		selectedSegmentId = $bindable(null),
		selectedSegmentIds = $bindable([]),
		onSeek,
		onApplyPreset,
		onRoll,
		onClear,
		onModeChange,
		bpm = 0,
		onTransitionChange,
		segmentLoop = false,
		onToggleSegmentLoop,
		sources = [],
		primarySourceId = null,
		onAssignSource,
		onSourceRollChange,
	}: Props = $props();

	let minSegmentDuration = $derived(
		bpm > 0 ? (60 / bpm) * MIN_SEGMENT_BEATS : MIN_SEGMENT_NO_TEMPO,
	);

	let multiSource = $derived(sources.length > 1);
	const segH = SEG_H;
	const svgH = SEG_H + ROW_PAD * 2;
	const labelY = ROW_PAD + SEG_H / 2 + 4;
	// Indexed rather than scanned: segVis recomputes on every zoom/pan frame,
	// and a linear find per segment over a few hundred sources showed up as
	// drag lag.
	let sourceIndex = $derived(
		new Map(sources.map((s, i) => [s.id, { src: s, n: i + 1 }])),
	);

	function sourceOf(s: SequenceSegment): SequenceSource | undefined {
		return sourceIndex.get(s.sourceId ?? primarySourceId ?? '')?.src;
	}


	let svgEl: SVGSVGElement | undefined = $state();
	/** Track width in px, for sizing labels to their blocks. */
	let trackWidth = $state(0);

	// One axis for the whole stack: the view window, the playhead and the
	// duration-change reset all live in TimelineStack.
	const stack = getTimelineStack();
	const vp = stack.vp;
	const laneTrack = stack.lane;
	let trackDuration = $derived(stack.trackDuration);

	let segments = $derived(
		[...rawSegments].sort((a, b) => a.startTime - b.startTime),
	);

	// ── Multi-selection ──────────────────────────────────────────────────────
	// All selected segment ids; the bindable selectedSegmentId is the primary
	// (last-selected) one, which Editor uses for the effects panel and loop.
	// Held in the bindable prop so the stack toolbar — which lives outside this
	// lane — can act on the selection too; this alias keeps the rest of the file
	// reading as it did.
	let selectedIds = $derived(selectedSegmentIds);

	/**
	 * Boundaries only ever get selected as part of a span drag over segments, so
	 * a new segment selection — including an empty one, however it was made —
	 * retires the old boundary set with it. Left behind, those dots stayed lit
	 * with nothing selected, and the next Ctrl+C copied a span the user could no
	 * longer see.
	 *
	 * `keepBoundaries` is for the callers that aren't a fresh pick: the span
	 * drag itself, which sets both, and the remaps that only rewrite ids.
	 */
	function setSelection(ids: string[], keepBoundaries = false) {
		selectedSegmentIds = ids;
		selectedSegmentId = ids.length > 0 ? ids[ids.length - 1] : null;
		if (!keepBoundaries) boundaries.clearSelection();
	}

	/** Where a shift+click range measures from: the segment picked on its own,
	 * or the far end of the last range. Survives the range clicks themselves, so
	 * a second shift+click re-extends from the same place rather than walking. */
	let selectionAnchorId = $state<string | null>(null);

	function toggleInSelection(id: string) {
		if (selectedIds.includes(id)) setSelection(selectedIds.filter((x) => x !== id));
		else setSelection([...selectedIds, id]);
		selectionAnchorId = id;
	}

	/** Select every segment between the anchor and `segId`, inclusive. Falls
	 * back to a plain pick when there is no live anchor to measure from. */
	function selectRangeTo(segId: string) {
		const from = segments.findIndex((s) => s.id === selectionAnchorId);
		const to = segments.findIndex((s) => s.id === segId);
		if (to === -1) return;
		if (from === -1 || from === to) {
			setSelection([segId]);
			selectionAnchorId = segId;
			return;
		}
		const ids = segments
			.slice(Math.min(from, to), Math.max(from, to) + 1)
			.map((s) => s.id);
		// Clicked segment last, so it becomes the primary the panel edits.
		setSelection(to < from ? ids.reverse() : ids);
	}

	let selectedSegments = $derived(
		segments.filter((s) => selectedIds.includes(s.id)),
	);

	// Drop ids whose segments were removed (merge/undo/track change).
	$effect(() => {
		const alive = new Set(rawSegments.map((s) => s.id));
		if (selectedIds.some((id) => !alive.has(id))) {
			setSelection(selectedIds.filter((id) => alive.has(id)), true);
		}
	});

	// Editor clears selectedSegmentId externally (e.g. picking an fx clip, or
	// loading a saved sequence).
	$effect(() => {
		if (!selectedSegmentId && selectedIds.length > 0) setSelection([]);
	});

	// Presets are read fresh on selection and on dropdown open, so ones saved
	// from the effects panel show up without leaving sequence mode.
	let presetList = $state<Preset[]>([]);
	$effect(() => {
		if (selectedSegments.length > 0) presetList = loadPresets();
	});

	/** Value shared by every selected segment, or undefined when mixed. */
	function commonValue<T>(values: T[]): T | undefined {
		return values.every((v) => v === values[0]) ? values[0] : undefined;
	}

	// Index of the selection's shared preset, so the dropdown shows it instead
	// of the placeholder (also the placeholder when the selection is mixed).
	let commonPresetName = $derived(
		commonValue(selectedSegments.map((s) => s.presetName)),
	);
	let selectedPresetIndex = $derived(
		commonPresetName
			? presetList.findIndex((p) => p.name === commonPresetName)
			: -1,
	);

	let commonMode = $derived(commonValue(selectedSegments.map((s) => s.mode)));
	let commonSourceRoll = $derived(
		commonValue(selectedSegments.map((s) => !!s.sourceRoll)),
	);

	// ── Drop a source onto a segment ─────────────────────────────────────────
	// HTML5 drag events, deliberately: they're a separate stream from the
	// pointer events every other timeline interaction uses, so nothing here can
	// be mistaken for a boundary drag, a rect-select or a seek.
	/** A source drag is over the track. The drag itself starts in the grid view,
	 * which shares no state with us — the payload's type is all we go on. */
	let sourceDragOver = $state(false);
	let dropSegId = $state<string | null>(null);

	/** Segments a drop would land on — the whole selection when the target is
	 * part of it, matching how the toolbar actions fan out. */
	let dropTargetIds = $derived(
		dropSegId
			? selectedIds.includes(dropSegId)
				? selectedIds
				: [dropSegId]
			: [],
	);

	function endSourceDrag() {
		sourceDragOver = false;
		dropSegId = null;
	}

	function segmentAtTime(t: number): SequenceSegment | undefined {
		return segments.find((s) => {
			const end = Math.min(trackDuration, s.endTime ?? trackDuration);
			return t >= s.startTime && t < end;
		});
	}

	function isSourceDrag(e: DragEvent): boolean {
		return !!e.dataTransfer?.types.includes(SOURCE_DND_TYPE);
	}

	function onTimelineDragOver(e: DragEvent) {
		if (!isSourceDrag(e)) return;
		// Without preventDefault the browser refuses the drop entirely.
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		sourceDragOver = true;
		dropSegId = segmentAtTime(vp.clientXToTime(e.clientX))?.id ?? null;
	}

	function onTimelineDragLeave(e: DragEvent) {
		if (
			e.currentTarget instanceof Element &&
			e.relatedTarget instanceof Node &&
			e.currentTarget.contains(e.relatedTarget)
		) {
			return;
		}
		sourceDragOver = false;
		dropSegId = null;
	}

	function onTimelineDrop(e: DragEvent) {
		if (!isSourceDrag(e)) return;
		e.preventDefault();
		const sourceId = e.dataTransfer?.getData(SOURCE_DND_TYPE) ?? '';
		const targets = dropTargetIds;
		endSourceDrag();
		if (sourceId && targets.length > 0) onAssignSource?.(targets, sourceId);
	}
	let commonIntervalSec = $derived(
		commonValue(selectedSegments.map((s) => s.intervalSec ?? 0.25)),
	);
	let commonIntervalBeats = $derived(
		commonValue(selectedSegments.map((s) => s.intervalBeats ?? 0)),
	);

	/** The picker's value: a `b`-prefixed beat count when the spacing is tied to
	 * the beat, otherwise the raw seconds. Blank when the selection disagrees. */
	/** True once any selected segment carries a spacing of its own to go back to. */
	let hasInterval = $derived(
		selectedSegments.some(
			(s) => s.intervalSec !== undefined || s.intervalBeats !== undefined,
		),
	);

	/**
	 * Auto starts on a beat where one is known, a second otherwise — spacing a
	 * re-roll to the music is the point of the mode, and either beats landing on
	 * whatever the segment happened to inherit. Segments that were already on
	 * Auto keep the spacing they had.
	 */
	function switchToAuto() {
		if (hasInterval) onModeChange(selectedIds, 'interval');
		else if (bpm > 0) onModeChange(selectedIds, 'interval', 60 / bpm, 1);
		else onModeChange(selectedIds, 'interval', 1, null);
	}

	let intervalValue = $derived.by(() => {
		if (commonIntervalBeats) return `b${commonIntervalBeats}`;
		if (commonIntervalBeats === undefined || commonIntervalSec === undefined) {
			return '';
		}
		return String(commonIntervalSec);
	});

	// ── Transitions ────────────────────────────────────────────────────────
	// A transition belongs to the boundary it plays on, not to a segment, so it
	// is edited from a popover on the boundary itself. The stored value still
	// hangs off the segment being blended into — the one to the boundary's
	// right — which is what these targets are.
	/** Open popover: the boundary it hangs off, and the segments it edits. */
	let transPopover = $state<{ time: number; segIds: string[] } | null>(null);
	let popEl: HTMLDivElement | undefined = $state();
	/** Lane geometry at the time the popover opened, for placing it. Read once
	 * rather than per frame: the lane only moves when the window resizes. */
	let laneBox = $state<{ left: number; top: number; width: number } | null>(null);

	let transTargets = $derived(
		transPopover
			? segments.filter((s) => transPopover!.segIds.includes(s.id))
			: [],
	);

	/** Segments that start on the given boundary times. */
	function rightSegIdsAt(times: number[]): string[] {
		return times
			.map((t) => segments.find((s) => Math.abs(s.startTime - t) < 0.001)?.id)
			.filter((id): id is string => !!id);
	}

	function openTransitionPopover(rightSegId: string | null) {
		// No right-hand segment means the track's leading edge: nothing blends in
		// there, so there's no transition to configure.
		if (!rightSegId) return;
		const seg = segments.find((s) => s.id === rightSegId);
		if (!seg) return;
		const sel = boundaries.selectedBoundaryTimes;
		const inSelection = sel.some((t) => Math.abs(t - seg.startTime) < 0.001);
		const rect = getRect();
		if (!rect) return;
		laneBox = { left: rect.left, top: rect.top, width: rect.width };
		transPopover = {
			time: seg.startTime,
			// Editing one boundary of a selected run edits the whole run, the same
			// way dragging one of them moves them all.
			segIds:
				inSelection && sel.length > 1 ? rightSegIdsAt(sel) : [seg.id],
		};
	}

	function closeTransitionPopover() {
		transPopover = null;
	}

	// The boundary can be dragged away, merged or undone out of existence while
	// the popover is open; it has nothing to point at then.
	$effect(() => {
		if (transPopover && transTargets.length === 0) closeTransitionPopover();
	});

	/** Fixed-position placement, so the lane's own overflow can't clip it. */
	let popPos = $derived.by(() => {
		if (!transPopover || !laneBox) return null;
		const x = laneBox.left + (vp.toPct(transPopover.time) / 100) * laneBox.width;
		return {
			left: Math.max(8, Math.min(window.innerWidth - 8, x)),
			bottom: window.innerHeight - laneBox.top + 6,
		};
	});

	// Each value is undefined when the targeted boundaries disagree; the control
	// then renders blank until the user picks a value, which applies to all.
	let commonTransitionType = $derived(
		commonValue(
			transTargets.map((s): TransitionType => s.transition?.type ?? 'cut'),
		),
	);
	let commonTransitionMeta = $derived(
		commonTransitionType
			? TRANSITION_OPTIONS.find((o) => o.value === commonTransitionType)
			: undefined,
	);
	let commonTransitionDuration = $derived(
		commonValue(transTargets.map((s) => s.transition?.durationSec)),
	);
	let commonTransitionDirection = $derived(
		commonValue(transTargets.map((s) => s.transition?.direction ?? 0)),
	);
	let commonTransitionDensity = $derived(
		commonValue(transTargets.map((s) => s.transition?.density ?? 1)),
	);
	let commonTransitionOnTick = $derived(
		commonValue(transTargets.map((s) => s.transitionOnTick ?? false)),
	);
	/** Ticks only means anything on a segment that re-rolls. */
	let transTargetsAuto = $derived(
		transTargets.length > 0 && transTargets.every((s) => s.mode === 'interval'),
	);

	function changeTransitionType(type: TransitionType) {
		if (transTargets.length === 0) return;
		onTransitionChange(
			transTargets.map((seg) => ({
				segmentId: seg.id,
				// Keep each segment's duration/seed/params when switching between
				// non-cut types.
				transition:
					type === 'cut'
						? null
						: {
								type,
								durationSec:
									seg.transition?.durationSec ?? DEFAULT_TRANSITION_DURATION,
								seed: seg.transition?.seed ?? randomSeed(),
								direction: seg.transition?.direction,
								density: seg.transition?.density,
							},
			})),
		);
	}

	function patchTransition(patch: Partial<SegmentTransition>) {
		const changes = transTargets
			.filter((s) => s.transition)
			.map((seg) => ({
				segmentId: seg.id,
				transition: { ...seg.transition!, ...patch },
			}));
		if (changes.length > 0) onTransitionChange(changes);
	}

	/** Each segment gets its own fresh seed so layouts don't all match. */
	function rerollTransitionSeeds() {
		const changes = transTargets
			.filter((s) => s.transition)
			.map((seg) => ({
				segmentId: seg.id,
				transition: { ...seg.transition!, seed: randomSeed() },
			}));
		if (changes.length > 0) onTransitionChange(changes);
	}

	function setTransitionOnTick(on: boolean) {
		const changes = transTargets
			.filter((s) => s.mode === 'interval')
			.map((seg) => ({
				segmentId: seg.id,
				transition: seg.transition ?? null,
				transitionOnTick: on,
			}));
		if (changes.length > 0) onTransitionChange(changes);
	}

	// ── Segment clipboard ────────────────────────────────────────────────────
	// A span copy (shift+drag, covers boundaries) is placed by clicking; a plain
	// segment copy drops straight onto the current selection.
	let segClipboard = $state<SegmentClip[]>([]);
	let clipIsSpan = $state(false);
	let spanPasteMode = $state(false);
	let spanPasteCursor = $state(0);
	/** chainClipboard.stamp as it stood when this clipboard was last filled, so
	 * a paste can tell whether a chain has been copied since. */
	let segClipStamp = $state(-1);

	function copySelectedSegments(): boolean {
		if (selectedSegments.length === 0) return false;
		segClipboard = copySegments(selectedSegments, trackDuration);
		clipIsSpan = boundaries.selectedBoundaryTimes.length > 0;
		// Published to the shared clipboard as well: the same Ctrl+C has to be
		// pasteable onto an fx clip, which can take the chain but not the span or
		// the media that come with a whole segment.
		chainClipboard.copy(selectedSegments);
		segClipStamp = chainClipboard.stamp;
		return segClipboard.length > 0;
	}

	/** True when a chain was copied elsewhere — an fx clip — since this
	 * clipboard was filled, so that is the newer of the two. */
	function chainIsNewer(): boolean {
		return chainClipboard.stamp > segClipStamp;
	}

	/** Paste chains onto the selected segments, keeping their spans and media. */
	function pasteChainsOntoSelection(): boolean {
		if (chainClipboard.clips.length === 0 || selectedIds.length === 0) {
			return false;
		}
		const order = rawSegments
			.filter((s) => selectedIds.includes(s.id))
			.sort((a, b) => a.startTime - b.startTime)
			.map((s) => s.id);
		emit(
			rawSegments.map((s) => {
				const i = order.indexOf(s.id);
				if (i === -1) return s;
				const chain = chainClipboard.at(i);
				return chain ? applyChainToSegment(s, chain) : s;
			}),
		);
		return true;
	}

	function pasteSegments(): boolean {
		// A chain copied from an fx lane can only be pasted as a chain: it has no
		// span to stamp and no media to bring with it.
		if (chainIsNewer()) return pasteChainsOntoSelection();
		if (segClipboard.length === 0) return false;
		if (!clipIsSpan && selectedIds.length > 0) {
			emit(pasteContentOnto(rawSegments, selectedIds, segClipboard));
			return true;
		}
		spanPasteMode = true;
		boundaries.clearSelection();
		return true;
	}

	function pasteSpanAt(time: number) {
		spanPasteMode = false;
		const next = pasteClipsAt(rawSegments, segClipboard, time, trackDuration);
		if (next !== rawSegments) emit(next);
	}

	// ── Drag state ───────────────────────────────────────────────────────────
	type DragState =
		| { type: 'boundary'; leftSegId: string | null; rightSegId: string | null }
		| {
				type: 'boundary-group';
				anchorTime: number;
				/** The boundary actually grabbed — a click without a drag opens its
				 * transition popover. */
				clickTime: number;
				group: GroupBoundary[];
				nonSelected: number[];
		  }
		| { type: 'static' }
		| { type: 'seg-click'; segmentId: string }
		| {
				type: 'rect-select';
				startTime: number;
				currentTime: number;
				/** Segment under the pointer at drag start. Without a drag the
				 * gesture is a click on it: shift extends the selection to it,
				 * alt toggles it. */
				clickSegId?: string;
				clickAction?: 'range' | 'toggle';
		  }
		| null;

	let dragging: DragState = $state(null);
	let dragMoved = $state(false);

	// ── Helpers ──────────────────────────────────────────────────────────────
	/** Discrete, undoable edit (split, remove, merge, drag-release). */
	function emit(segs: SequenceSegment[]) {
		boundaries.commit(segs);
	}

	function getRect(): DOMRect | null {
		return svgEl?.getBoundingClientRect() ?? null;
	}

	// ── Derived visuals ──────────────────────────────────────────────────────
	interface SegVis {
		id: string;
		startX: number;
		endX: number;
		startTime: number;
		endTime: number;
		label: string;
		/** Everything the block can't show at this width. */
		tip: string;
		transitionType: TransitionType;
		transitionDuration: number;
		/** Bottom band colour tagging which source plays; null in single-source
		 * songs, where every block would carry the same band. */
		srcColor: string | null;
		/** Re-rolling segments get a hatched body, so they still read as auto
		 * once the block is too narrow for its label. */
		auto: boolean;
	}

	function segLabel(s: SequenceSegment): string {
		if (s.mode === 'interval') {
			const roll = s.sourceRoll && multiSource ? ' · media' : '';
			return `auto ${intervalLabel(s.intervalSec, s.intervalBeats)}${roll}`;
		}
		// "*" = hand-edited since it was filled (preset overwrites skip it).
		return s.modified ? `${s.label}*` : s.label;
	}

	/** Trim a label to what fits inside its block, so text can't spill onto the
	 * neighbouring segments. Nothing at all below MIN_LABEL_PX — see there. */
	function fitLabel(text: string, boxPx: number, charPx: number): string {
		if (boxPx < MIN_LABEL_PX) return '';
		const max = Math.floor((boxPx - 6) / charPx);
		return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
	}

	let segVis = $derived.by((): SegVis[] =>
		segments.map((s) => {
			const endTime = Math.min(trackDuration, s.endTime ?? trackDuration);
			const startX = vp.toPct(s.startTime);
			const endX = vp.toPct(endTime);
			const boxPx = ((endX - startX) / 100) * trackWidth;
			// A rolling segment plays the whole pool, so it gets no source band and
			// no source line — either would name one clip out of the deck.
			const rolls = multiSource && !!s.sourceRoll && s.mode === 'interval';
			const source =
				multiSource && !rolls
					? sourceIndex.get(s.sourceId ?? primarySourceId ?? '')
					: undefined;
			const full = segLabel(s);
			const trans = s.transition?.type ?? 'cut';
			return {
				id: s.id,
				startX,
				endX,
				startTime: s.startTime,
				endTime,
				label: fitLabel(full, boxPx, 6.6),
				tip: [
					full,
					rolls ? 'media rolls with the mosh' : null,
					source ? `source ${source.n}: ${source.src.name}` : null,
					trans === 'cut' ? null : `${trans} ${s.transition?.durationSec ?? 0}s`,
				]
					.filter(Boolean)
					.join(' · '),
				transitionType: trans,
				transitionDuration: s.transition?.durationSec ?? 0,
				srcColor: source ? sourceColor(source.n) : null,
				auto: s.mode === 'interval',
			};
		}),
	);

	// The stack owns one bar for every lane's selection; we hand it ours while
	// something is selected. Registering rather than rendering a row of our own
	// keeps the lanes below from being pushed down on every click.
	$effect(() => {
		if (selectedSegments.length === 0) return;
		return stack.registerSelectionBar('mosh', segmentBar);
	});

	// ── Split / create ───────────────────────────────────────────────────────
	// The Mosh lane splits at the playhead with S; it is also the default target
	// until the user touches another lane, so a fresh timeline still splits here.
	$effect(() => {
		const unregister = stack.registerSplitter('mosh', (t) => splitAt(t));
		if (stack.activeLaneId === null) stack.markLaneUsed('mosh');
		return unregister;
	});

	function splitAt(time: number) {
		if (trackDuration <= 0) return;
		if (rawSegments.length === 0) {
			emit([createSequenceSegment(0, trackDuration)]);
			return;
		}
		const hit = segments.find((s) => {
			const end = s.endTime ?? trackDuration;
			return time > s.startTime + 0.01 && time < end - 0.01;
		});
		if (!hit) return;
		const end = hit.endTime ?? trackDuration;
		const tail = cloneSegmentForSplit(hit, time, end);
		// The tail continues the same region — a transition configured for
		// entering `hit` from its predecessor must not replay at the split.
		tail.transition = undefined;
		tail.transitionOnTick = undefined;
		emit(
			rawSegments
				.filter((s) => s.id !== hit.id)
				.concat([cloneSegmentForSplit(hit, hit.startTime, time), tail]),
		);
	}

	// ── Drags ────────────────────────────────────────────────────────────────
	function startBndDrag(
		e: PointerEvent,
		leftSegId: string | null,
		rightSegId: string | null,
	) {
		e.stopPropagation();
		const selected = boundaries.selectedBoundaryTimes;
		const time = boundaryTimeOf(leftSegId, rightSegId);
		// Grabbing a boundary that's part of a multi-selection moves the whole set.
		if (
			time !== null &&
			selected.length > 1 &&
			selected.some((t) => Math.abs(t - time) < 0.001)
		) {
			dragging = {
				type: 'boundary-group',
				anchorTime: vp.clientXToTime(e.clientX),
				clickTime: time,
				group: collectGroupBoundaries(segments, selected, trackDuration),
				nonSelected: nonSelectedBoundaryTimes(segments, selected, trackDuration),
			};
		} else {
			dragging = { type: 'boundary', leftSegId, rightSegId };
		}
		dragMoved = false;
		try {
			(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function boundaryTimeOf(
		leftSegId: string | null,
		rightSegId: string | null,
	): number | null {
		if (leftSegId) {
			const seg = rawSegments.find((s) => s.id === leftSegId);
			if (seg) return seg.endTime ?? trackDuration;
		}
		if (rightSegId) {
			const seg = rawSegments.find((s) => s.id === rightSegId);
			if (seg) return seg.startTime;
		}
		return null;
	}

	function startRectSelect(
		e: PointerEvent,
		clickSegId?: string,
		clickAction: 'range' | 'toggle' = 'range',
	) {
		e.stopPropagation();
		const time = vp.clientXToTime(e.clientX);
		dragging = {
			type: 'rect-select',
			startTime: time,
			currentTime: time,
			clickSegId,
			clickAction,
		};
		dragMoved = false;
		try {
			(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function startSegClick(e: PointerEvent, segId: string) {
		e.stopPropagation();
		// Segment bodies cover most of the timeline — placing must work over them.
		if (spanPasteMode) {
			pasteSpanAt(vp.clientXToTime(e.clientX));
			return;
		}
		if (e.ctrlKey || e.metaKey) {
			splitAt(vp.clientXToTime(e.clientX));
			return;
		}
		// Shift: extend the selection to this segment on click, or rect-select on
		// drag — same gesture as on the empty timeline. Alt picks a single
		// segment in or out, which shift used to do; Ctrl is taken by the split.
		if (e.altKey) {
			startRectSelect(e, segId, 'toggle');
			return;
		}
		if (e.shiftKey) {
			startRectSelect(e, segId, 'range');
			return;
		}
		dragging = { type: 'seg-click', segmentId: segId };
		dragMoved = false;
		try {
			(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function onLanePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		// Place the copied span with its first segment starting at the click
		if (spanPasteMode) {
			e.stopPropagation();
			pasteSpanAt(vp.clientXToTime(e.clientX));
			return;
		}
		// If in paste mode, split segments at clipboard offsets from the clicked time
		if (boundaries.pasteMode && boundaries.clipboard.length > 0) {
			e.stopPropagation();
			boundaries.pasteAt(vp.clientXToTime(e.clientX));
			return;
		}
		if (e.ctrlKey || e.metaKey) {
			splitAt(vp.clientXToTime(e.clientX));
			return;
		}
		if (e.shiftKey) {
			startRectSelect(e);
			return;
		}
		if (!onSeek) return;
		boundaries.clearSelection();
		// Default: place the start marker, which takes the clock with it.
		stack.seekStatic(Math.max(0, Math.min(trackDuration, vp.clientXToTime(e.clientX))));
		dragging = { type: 'static' };
		dragMoved = false;
		try {
			(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function onPointerMove(e: PointerEvent) {
		if (boundaries.pasteMode) {
			boundaries.pasteCursorTime = vp.clientXToTime(e.clientX);
		}
		if (spanPasteMode) {
			spanPasteCursor = vp.clientXToTime(e.clientX);
		}
		if (!dragging) return;

		if (dragging.type === 'boundary') {
			if (!dragMoved) boundaries.snapshotForDrag();
			dragMoved = true;
			const time = vp.clientXToTime(e.clientX);
			const { leftSegId, rightSegId } = dragging;
			const updates: Record<string, Partial<SequenceSegment>> = {};

			if (leftSegId) {
				const lseg = rawSegments.find((s) => s.id === leftSegId);
				if (lseg) {
					const minEnd = lseg.startTime + minSegmentDuration;
					const maxEnd = rightSegId
						? (rawSegments.find((s) => s.id === rightSegId)?.endTime ??
								trackDuration) - minSegmentDuration
						: trackDuration;
					const clamped = Math.max(minEnd, Math.min(maxEnd, time));
					updates[leftSegId] = { endTime: clamped };
					if (rightSegId) updates[rightSegId] = { startTime: clamped };
				}
			} else if (rightSegId) {
				const rseg = rawSegments.find((s) => s.id === rightSegId);
				if (rseg) {
					const maxStart =
						(rseg.endTime ?? trackDuration) - minSegmentDuration;
					const clamped = Math.max(0, Math.min(maxStart, time));
					updates[rightSegId] = { startTime: clamped };
				}
			}

			if (Object.keys(updates).length > 0) {
				boundaries.live(
					rawSegments.map((s) =>
						updates[s.id] ? { ...s, ...updates[s.id] } : s,
					),
				);
			}
		} else if (dragging.type === 'boundary-group') {
			if (!dragMoved) boundaries.snapshotForDrag();
			dragMoved = true;
			const delta = clampGroupDelta(
				vp.clientXToTime(e.clientX) - dragging.anchorTime,
				dragging.group,
				dragging.nonSelected,
				trackDuration,
				minSegmentDuration,
			);
			const updates = groupDeltaUpdates(dragging.group, delta);
			boundaries.live(
				rawSegments.map((s) => (updates[s.id] ? { ...s, ...updates[s.id] } : s)),
			);
		} else if (dragging.type === 'rect-select') {
			dragMoved = true;
			dragging = { ...dragging, currentTime: vp.clientXToTime(e.clientX) };
		} else if (dragging.type === 'static') {
			dragMoved = true;
			stack.seekStatic(
				Math.max(0, Math.min(trackDuration, vp.clientXToTime(e.clientX))),
			);
		}
	}

	/** Segment ids overlapping [minTime, maxTime]. */
	function segmentIdsInRange(minTime: number, maxTime: number): string[] {
		return segments
			.filter((s) => {
				const end = Math.min(trackDuration, s.endTime ?? trackDuration);
				return end > minTime && s.startTime < maxTime;
			})
			.map((s) => s.id);
	}

	function onPointerUp() {
		if (dragging?.type === 'boundary-group' && dragMoved) {
			// Follow the boundaries to their new times so the selection survives.
			boundaries.selectedBoundaryTimes = groupBoundaryTimesAfter(
				dragging.group,
				rawSegments,
				trackDuration,
			);
		}
		// A boundary grabbed but not moved is a click on it: configure how the
		// next segment blends in.
		if (dragging?.type === 'boundary' && !dragMoved) {
			openTransitionPopover(dragging.rightSegId);
		}
		if (dragging?.type === 'boundary-group' && !dragMoved) {
			openTransitionPopover(rightSegIdsAt([dragging.clickTime])[0] ?? null);
		}
		if (dragging?.type === 'seg-click' && !dragMoved) {
			const segId = dragging.segmentId;
			const soleSelected = selectedIds.length === 1 && selectedIds[0] === segId;
			setSelection(soleSelected ? [] : [segId]);
			selectionAnchorId = soleSelected ? null : segId;
		}
		if (dragging?.type === 'rect-select') {
			if (dragMoved) {
				const minTime = Math.min(dragging.startTime, dragging.currentTime);
				const maxTime = Math.max(dragging.startTime, dragging.currentTime);
				boundaries.setSelectionFromRange(minTime, maxTime);
				const ids = segmentIdsInRange(minTime, maxTime);
				setSelection(ids, true);
				// A later shift+click extends from where the drag began.
				selectionAnchorId = ids[0] ?? null;
			} else if (dragging.clickSegId) {
				if (dragging.clickAction === 'toggle') toggleInSelection(dragging.clickSegId);
				else selectRangeTo(dragging.clickSegId);
			} else {
				boundaries.clearSelection();
			}
		}
		dragging = null;
		dragMoved = false;
	}

	// ── Remove ───────────────────────────────────────────────────────────────
	/** Remove segments, merging each freed span into a neighbour so coverage
	 *  stays gapless. One history commit for the whole batch. */
	function removeSegments(ids: string[]) {
		if (ids.length === 0) return;
		setSelection([]);
		let working = [...rawSegments];
		for (const id of ids) {
			const sorted = [...working].sort((a, b) => a.startTime - b.startTime);
			const idx = sorted.findIndex((s) => s.id === id);
			if (idx === -1) continue;
			if (sorted.length === 1) {
				working = [];
				break;
			}
			const deleted = sorted[idx];
			const neighbour = idx < sorted.length - 1 ? sorted[idx + 1] : sorted[idx - 1];
			const merged: SequenceSegment = {
				...neighbour,
				startTime: Math.min(deleted.startTime, neighbour.startTime),
				endTime: Math.max(
					deleted.endTime ?? trackDuration,
					neighbour.endTime ?? trackDuration,
				),
			};
			working = working
				.filter((s) => s.id !== id && s.id !== neighbour.id)
				.concat([merged]);
		}
		emit(working);
	}

	function mergeBoundary(leftSegId: string | null, rightSegId: string | null) {
		if (!leftSegId || !rightSegId) return;
		const left = rawSegments.find((s) => s.id === leftSegId);
		const right = rawSegments.find((s) => s.id === rightSegId);
		if (!left || !right) return;
		if (selectedIds.includes(rightSegId)) {
			setSelection(
				[...new Set(selectedIds.map((id) => (id === rightSegId ? leftSegId : id)))],
				true,
			);
		}
		emit(
			rawSegments
				.filter((s) => s.id !== leftSegId && s.id !== rightSegId)
				.concat([{ ...left, endTime: right.endTime ?? trackDuration }]),
		);
	}

	let hoveredBoundary: { leftSegId: string | null; rightSegId: string | null } | null =
		$state(null);

	/**
	 * Runs in the capture phase (see the `onkeydowncapture` binding below) so it
	 * gets first look at the key, before Editor.svelte's own window-level
	 * shortcut handler (bubble phase). When boundaries.onKeydown() consumes a
	 * key (undo/redo/copy/paste/escape acting on boundary selection or paste
	 * mode) we stop propagation so Editor's Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y never
	 * see it; otherwise the event proceeds untouched, so those global shortcuts
	 * keep working exactly as before whenever there's nothing local to do.
	 */
	function onKeydown(e: KeyboardEvent) {
		if (isTextEntryTarget(e.target)) return;
		// The media lightbox owns the keyboard while it's up: it handles Escape
		// and the arrows itself, and Delete must not reach the segments behind it.
		if (isModalKeyboardOpen()) return;

		// Outranks the boundary clipboard; falls through when nothing is selected.
		const key = e.key.toLowerCase();
		if (e.ctrlKey || e.metaKey) {
			if (key === 'c' && copySelectedSegments()) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			if (key === 'v' && pasteSegments()) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
		}

		if (e.key === 'Escape' && transPopover) {
			closeTransitionPopover();
			e.stopPropagation();
			return;
		}

		if (e.key === 'Escape' && spanPasteMode) {
			spanPasteMode = false;
			e.stopPropagation();
			return;
		}

		// Undo/redo still apply while a toolbar dropdown holds focus, which is
		// exactly where focus sits right after a preset/transition change.
		if (boundaries.onKeydown(e)) {
			e.stopPropagation();
			return;
		}

		// The rest are bare keys — they belong to a focused control.
		if (isInteractiveTarget(e.target)) return;

		if (e.key === 'Escape' && selectedIds.length > 0) {
			setSelection([]);
			return;
		}
		// S: split the item under the playhead on the lane the user last touched.
		if (e.key.toLowerCase() === 's') {
			e.preventDefault();
			(stack.activeLaneSplitAt ?? splitAt)(stack.currentTime);
			return;
		}
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		if (hoveredBoundary) {
			e.preventDefault();
			mergeBoundary(hoveredBoundary.leftSegId, hoveredBoundary.rightSegId);
			hoveredBoundary = null;
			return;
		}
		if (boundaries.deleteSelection()) {
			e.preventDefault();
			return;
		}
		if (selectedIds.length > 0) {
			e.preventDefault();
			removeSegments(selectedIds);
		}
	}

	let showHint = $derived(segments.length === 0);

	let svgCursor = $derived.by(() => {
		if (boundaries.pasteMode || spanPasteMode) return 'copy';
		if (!dragging) return onSeek ? 'crosshair' : 'default';
		if (dragging.type === 'rect-select') return 'crosshair';
		if (dragging.type === 'static') return 'col-resize';
		if (dragging.type === 'boundary-group') return 'grabbing';
		return 'ew-resize';
	});

	// Boundary times currently inside the in-progress rect-select drag (for live highlighting)
	let rectHoverTimes = $derived.by((): number[] => {
		if (dragging?.type !== 'rect-select' || !dragMoved) return [];
		const minTime = Math.min(dragging.startTime, dragging.currentTime);
		const maxTime = Math.max(dragging.startTime, dragging.currentTime);
		return boundaries.boundaryTimesInRange(minTime, maxTime);
	});

	// Segment ids the in-progress rect-select drag would select
	let rectHoverSegIds = $derived.by((): string[] => {
		if (dragging?.type !== 'rect-select' || !dragMoved) return [];
		const minTime = Math.min(dragging.startTime, dragging.currentTime);
		const maxTime = Math.max(dragging.startTime, dragging.currentTime);
		return segmentIdsInRange(minTime, maxTime);
	});
</script>

<svelte:window
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onkeydowncapture={onKeydown}
	onpointerdown={(e) => {
		// Runs before the pointerup that opens one, so clicking a second boundary
		// closes the first popover and then opens the new one.
		if (transPopover && !popEl?.contains(e.target as Node)) {
			closeTransitionPopover();
		}
	}}
	onresize={closeTransitionPopover}
/>

<div class="tl-container">
	<div class="tl-row">
		<div class="tl-gutter">
			<span class="tl-gutter-label">Mosh</span>
		</div>
		<div
			class="tl-lane tl-track"
			class:drop-active={sourceDragOver}
			bind:clientWidth={trackWidth}
			ondragover={onTimelineDragOver}
			ondragleave={onTimelineDragLeave}
			ondrop={onTimelineDrop}
			role="presentation"
		>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<svg
			bind:this={svgEl}
			use:laneTrack={'mosh'}
			width="100%"
			height={svgH}
			class="step-svg"
			style:cursor={svgCursor}
			onpointerdown={onLanePointerDown}
		>
			<defs>
				<!-- 45° hatch for auto segments. userSpaceOnUse, not the default
				     objectBoundingBox: per-object tiling would stretch the lines by
				     each block's width and they'd stop lining up across the row. -->
				<pattern
					id="seg-auto-hatch"
					width="6"
					height="6"
					patternUnits="userSpaceOnUse"
				>
					<path class="hatch-line" d="M -1 1 l 2 -2 M 0 6 l 6 -6 M 5 7 l 2 -2" />
				</pattern>
			</defs>

			<!-- Tails for uncovered regions, on the row's centre line -->
			{#if segVis.length > 0}
				{@const midY = ROW_PAD + segH / 2}
				{#if segVis[0].startTime > 0.001}
					<line
						class="tail"
						x1="{vp.toPct(0)}%"
						y1={midY}
						x2="{segVis[0].startX}%"
						y2={midY}
					/>
				{/if}
				{#if segVis[segVis.length - 1].endTime < trackDuration - 0.001}
					<!-- Drawn end→start so the dash pattern anchors at the track end;
					     with start-anchored dashes the phase could leave a gap there -->
					<line
						class="tail"
						x1="{vp.toPct(trackDuration)}%"
						y1={midY}
						x2="{segVis[segVis.length - 1].endX}%"
						y2={midY}
					/>
				{/if}
			{/if}

			<!-- Segment blocks + labels. The block is its own hit area. -->
			{#each segVis as sv}
				{@const sel =
					selectedIds.includes(sv.id) || rectHoverSegIds.includes(sv.id)}
				{@const drop = dropTargetIds.includes(sv.id)}
				{@const midX = (sv.startX + sv.endX) / 2}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<rect
					class="seg"
					class:sel
					class:drop
					x="{sv.startX}%"
					y={ROW_PAD}
					width="{Math.max(0, sv.endX - sv.startX)}%"
					height={segH}
					rx="3"
					onpointerdown={(e) => startSegClick(e, sv.id)}><title>{sv.tip}</title></rect
				>
				{#if sv.auto}
					<rect
						class="seg-hatch"
						x="{sv.startX}%"
						y={ROW_PAD}
						width="{Math.max(0, sv.endX - sv.startX)}%"
						height={segH}
						rx="3"
						fill="url(#seg-auto-hatch)"
						pointer-events="none"
					/>
				{/if}
				{#if sv.srcColor}
					<!-- Which source this segment plays, as a band along the bottom edge:
					     after a shuffle the whole row reads at a glance, and the colours
					     match the grid cards' index chips. -->
					<rect
						class="seg-src"
						x="{sv.startX}%"
						y={ROW_PAD + segH - SRC_BAND}
						width="{Math.max(0, sv.endX - sv.startX)}%"
						height={SRC_BAND}
						fill={sv.srcColor}
						pointer-events="none"
					/>
				{/if}
				{#if sv.label}
					<text
						class="seg-lbl"
						class:sel
						class:drop
						x="{midX}%"
						y={labelY}
						text-anchor="middle">{sv.label}</text
					>
				{/if}
			{/each}

			<!-- Interior boundaries (draggable) + transition markers -->
			{#each segVis as sv, i}
				{#if sv.startTime > 0.001}
					{@const lId = i > 0 ? segVis[i - 1].id : null}
					{@const hovered =
						hoveredBoundary?.leftSegId === lId &&
						hoveredBoundary?.rightSegId === sv.id}
					{@const bndSel =
						boundaries.selectedBoundaryTimes.some(
							(t) => Math.abs(t - sv.startTime) < 0.001,
						) || rectHoverTimes.some((t) => Math.abs(t - sv.startTime) < 0.001)}
					{#if sv.transitionType !== 'cut'}
						<!-- Lightning zigzag inside the block's leading edge: this segment
						     blends in rather than cutting -->
						<path
							class="trans-mark"
							d="M {sv.startX}% {ROW_PAD + 3} l 3 4 l -2 0 l 3 4"
						>
							<title
								>{sv.transitionType} transition · {sv.transitionDuration}s</title
							>
						</path>
					{/if}
					<line
						class="bnd"
						class:hovered
						class:sel={bndSel}
						x1="{sv.startX}%"
						y1={ROW_PAD}
						x2="{sv.startX}%"
						y2={ROW_PAD + segH}
					/>
					<!-- Grab strip, wider than the line it draws — same trick as the text
					     timeline's clip boundaries. -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<rect
						class="bnd-hit"
						x="{sv.startX}%"
						y={ROW_PAD}
						width={BND_GRAB * 2}
						height={segH}
						transform="translate({-BND_GRAB},0)"
						onpointerenter={() =>
							(hoveredBoundary = { leftSegId: lId, rightSegId: sv.id })}
						onpointerleave={() => (hoveredBoundary = null)}
						onpointerdown={(e) => startBndDrag(e, lId, sv.id)}
					><title
							>{BND_TIP}</title
						></rect
					>
				{/if}
			{/each}

			{#if showHint}
				<text class="hint" x="50%" y={ROW_PAD + segH / 2 + 4} text-anchor="middle">
					Ctrl+click to create a segment · click a segment to edit its effects
				</text>
			{/if}

			<!-- Rectangle selection overlay -->
			{#if dragging?.type === 'rect-select' && dragMoved}
				{@const minX = Math.min(vp.toPct(dragging.startTime), vp.toPct(dragging.currentTime))}
				{@const maxX = Math.max(vp.toPct(dragging.startTime), vp.toPct(dragging.currentTime))}
				<rect
					class="select-rect"
					x="{minX}%"
					y="0"
					width="{maxX - minX}%"
					height={svgH}
					pointer-events="none"
				/>
			{/if}

			<!-- Ghost paste preview (copied segment spans) -->
			{#if spanPasteMode}
				{#each segClipboard as clip}
					{@const gStart = vp.toPct(spanPasteCursor + clip.offsetStart)}
					{@const gEnd = vp.toPct(spanPasteCursor + clip.offsetEnd)}
					<rect
						class="ghost-span"
						x="{gStart}%"
						y={ROW_PAD}
						width="{Math.max(0, gEnd - gStart)}%"
						height={segH}
						rx="3"
						pointer-events="none"
					/>
					<line
						class="ghost-split-line"
						x1="{gStart}%"
						y1="0"
						x2="{gStart}%"
						y2={svgH}
					/>
				{/each}
			{/if}

			<!-- Ghost paste preview (boundary splits) -->
			{#if boundaries.pasteMode && boundaries.clipboard.length > 0}
				{#each boundaries.clipboard as { offset }}
					{@const ghostTime = boundaries.pasteCursorTime + offset}
					{@const gx = vp.toPct(ghostTime)}
					<line class="ghost-split-line" x1="{gx}%" y1="0" x2="{gx}%" y2={svgH} />
				{/each}
			{/if}
		</svg>
		</div>
	</div>

</div>

{#snippet segmentBar()}
	{#if selectedSegments.length > 0}
		{@const many = selectedSegments.length > 1}
		<!-- Three columns, never taller than a row: the middle one is centred on
		     the bar whatever the actions column holds, and a wrapping bar changed
		     the stack's height every time a control appeared. -->
		<div class="seg-bar">
			<div class="seg-spacer"></div>
			<div class="seg-groups">
				<span class="seg-title">
					{many ? `${selectedSegments.length} segments` : 'Segment'}
				</span>

				<div class="tl-tool-sep"></div>
				<span class="tl-tool-label">Fill</span>
				<select
					class="seg-select"
					value={selectedPresetIndex}
					onmousedown={() => (presetList = loadPresets())}
					onchange={(e) => {
						const idx = Number(e.currentTarget.value);
						const preset = presetList[idx];
						if (preset) onApplyPreset(selectedIds, preset);
					}}
				>
					<option value={-1} disabled>Preset…</option>
					{#each presetList as p, i}
						<option value={i}>{p.name}</option>
					{/each}
				</select>
				<button
					class="tl-tool-btn"
					title={commonMode === 'interval'
						? 'New random seed'
						: many
							? 'Random mosh for each selected segment'
							: 'Random mosh for this segment'}
					onclick={() => onRoll(selectedIds)}
				>
					<Dices size={12} /> Mosh
				</button>
				<button
					class="tl-tool-btn"
					title={many
						? "Clear the selected segments' effects"
						: "Clear this segment's effects"}
					onclick={() => onClear(selectedIds)}
				>
					<Eraser size={12} /> Clear
				</button>


				<div class="tl-tool-sep"></div>
				<span class="tl-tool-label">Mode</span>
				<div class="seg-mode">
					<button
						class="tl-tool-btn"
						class:active={commonMode === 'static'}
						onclick={() => onModeChange(selectedIds, 'static')}
					>
						Static
					</button>
					<button
						class="tl-tool-btn"
						class:active={commonMode === 'interval'}
						onclick={switchToAuto}
					>
						Auto
					</button>
				</div>
				{#if commonMode === 'interval'}
					<select
						class="seg-select"
						value={intervalValue}
						title="How often this segment re-rolls its mosh"
						onchange={(e) => {
							const v = e.currentTarget.value;
							if (v === '') return;
							if (v.startsWith('b')) {
								const beats = Number(v.slice(1));
								onModeChange(selectedIds, 'interval', (60 / bpm) * beats, beats);
							} else {
								// Picking a plain duration drops the beat link, so a later
								// BPM change leaves it alone.
								onModeChange(selectedIds, 'interval', Number(v), null);
							}
						}}
					>
						{#if intervalValue === ''}
							<option value="" disabled>—</option>
						{/if}
						{#if bpm > 0}
							{#each BEAT_INTERVALS as opt}
								<option value={`b${opt.beats}`}>{opt.label}</option>
							{/each}
						{/if}
						{#each [0.125, 0.25, 0.5, 1, 2] as sec}
							<!-- String, not the number: the select's value is a string, and
							     Svelte matches an option by strict equality — a numeric
							     option value never matches and the picker renders blank. -->
							<option value={String(sec)}>every {sec}s</option>
						{/each}
					</select>
					{#if multiSource && onSourceRollChange}
						<button
							class="tl-tool-btn"
							class:active={commonSourceRoll === true}
							title="Cut to another clip from the pool on every re-roll"
							onclick={() =>
								onSourceRollChange(selectedIds, commonSourceRoll !== true)}
						>
							<Shuffle size={12} /> Media
						</button>
					{/if}
				{/if}

			</div>
			<!-- Right-aligned in their own column, so Loop coming and going with
			     the selection size can't shift the controls above. -->
			<div class="seg-actions">
				{#if onToggleSegmentLoop && !many}
					<button
						class="tl-tool-btn"
						class:active={segmentLoop}
						title="Loop playback inside this segment"
						onclick={onToggleSegmentLoop}
					>
						<Repeat size={12} />
					</button>
				{/if}
				<button
					class="tl-tool-btn danger"
					title={many ? 'Delete selected segments' : 'Delete segment'}
					onclick={() => removeSegments(selectedIds)}
				>
					<Trash2 size={12} />
				</button>
			</div>
		</div>
	{/if}
{/snippet}

{#if transPopover && popPos}
	<!-- Anchored to the boundary it belongs to, positioned fixed so the lane's
	     own overflow can't clip it. -->
	<div
		bind:this={popEl}
		class="trans-pop"
		style:left="{popPos.left}px"
		style:bottom="{popPos.bottom}px"
		role="dialog"
		aria-label="Transition"
	>
		<div class="trans-pop-head">
			<span class="trans-pop-title">Transition</span>
			{#if transTargets.length > 1}
				<span class="trans-pop-count">{transTargets.length} boundaries</span>
			{/if}
			<button
				class="trans-pop-close"
				title="Close (Esc)"
				onclick={closeTransitionPopover}>&#10005;</button
			>
		</div>

		<div class="trans-row">
			<span class="trans-label">Type</span>
			<select
				class="seg-select"
				value={commonTransitionType ?? ''}
				title="How the next segment blends in from this one"
				onchange={(e) => {
					const v = e.currentTarget.value;
					if (v !== '') changeTransitionType(v as TransitionType);
				}}
			>
				{#if commonTransitionType === undefined}
					<option value="" disabled>&#8212;</option>
				{/if}
				{#each TRANSITION_OPTIONS as o}
					<option value={o.value}>{o.label}</option>
				{/each}
			</select>
		</div>

		{#if commonTransitionType && commonTransitionType !== 'cut'}
			<div class="trans-row">
				<span class="trans-label">Length</span>
				<select
					class="seg-select"
					value={commonTransitionDuration ?? ''}
					onchange={(e) => {
						const v = e.currentTarget.value;
						if (v !== '') patchTransition({ durationSec: Number(v) });
					}}
				>
					{#if commonTransitionDuration === undefined}
						<option value="" disabled>&#8212;</option>
					{/if}
					{#each [0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.2, 2] as sec}
						<option value={sec}>{sec}s</option>
					{/each}
				</select>
			</div>

			{#if commonTransitionMeta?.hasDirection}
				<div class="trans-row">
					<span class="trans-label">Direction</span>
					<select
						class="seg-select"
						value={commonTransitionDirection ?? ''}
						title="Wipe direction"
						onchange={(e) => {
							const v = e.currentTarget.value;
							if (v !== '') patchTransition({ direction: Number(v) });
						}}
					>
						{#if commonTransitionDirection === undefined}
							<option value="" disabled>&#8212;</option>
						{/if}
						<option value={0}>&#8594;</option>
						<option value={1}>&#8592;</option>
						<option value={2}>&#8595;</option>
						<option value={3}>&#8593;</option>
					</select>
				</div>
			{/if}

			{#if commonTransitionMeta?.hasDensity}
				<div class="trans-row">
					<span class="trans-label">Cells</span>
					<select
						class="seg-select"
						value={commonTransitionDensity ?? ''}
						title="Cell size"
						onchange={(e) => {
							const v = e.currentTarget.value;
							if (v !== '') patchTransition({ density: Number(v) });
						}}
					>
						{#if commonTransitionDensity === undefined}
							<option value="" disabled>&#8212;</option>
						{/if}
						<option value={0}>coarse</option>
						<option value={1}>med</option>
						<option value={2}>fine</option>
					</select>
				</div>
			{/if}

			{#if commonTransitionMeta?.hasSeed}
				<div class="trans-row">
					<span class="trans-label">Layout</span>
					<button
						class="tl-tool-btn"
						title="Re-roll transition layout"
						onclick={rerollTransitionSeeds}
					>
						<Dices size={12} /> Re-roll
					</button>
				</div>
			{/if}

			{#if transTargetsAuto}
				<label
					class="seg-check trans-check"
					title="Blend at each re-roll tick inside the segment too, not just here"
				>
					<input
						type="checkbox"
						checked={commonTransitionOnTick === true}
						indeterminate={commonTransitionOnTick === undefined}
						onchange={(e) => setTransitionOnTick(e.currentTarget.checked)}
					/>
					Also on re-roll ticks
				</label>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.tl-container {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.tl-track {
		background: var(--ink);
		border: 1px solid var(--line);
		border-radius: 4px;
		overflow: hidden;
	}

	.step-svg {
		display: block;
		width: 100%;
		overflow: hidden;
	}

	.tail {
		stroke: var(--text-4);
		stroke-width: 1;
		stroke-dasharray: 3 4;
	}

	/* Segment blocks, styled like the text timeline's clips: a filled body with
	   its label inside, rather than a line with the label hung underneath. */
	.seg {
		fill: #2b2038;
		stroke: var(--mosh-dim);
		stroke-width: 1;
		pointer-events: all;
		cursor: pointer;
	}

	.seg:hover {
		stroke: var(--mosh-dim);
	}

	.seg.sel {
		fill: #3d2c52;
		stroke: var(--mosh);
	}

	/* Drop preview — deliberately a different hue from selection purple, so
	   "where this will land" reads apart from "what is selected". */
	.seg.drop {
		fill: #14382e;
		stroke: var(--live);
		stroke-width: 2;
	}

	.seg-lbl.drop {
		fill: var(--live);
	}

	.tl-track.drop-active {
		outline: 1px dashed #3d6b5c;
		outline-offset: -1px;
	}

	.hatch-line {
		stroke: rgba(176, 138, 208, 0.28);
		stroke-width: 1;
		fill: none;
	}

	.seg-hatch {
		pointer-events: none;
	}

	/* Sits under the block's rounded corners rather than following them: 3px of
	   square edge at each end is invisible next to a 3px radius. */
	.seg-src {
		opacity: 0.85;
	}

	.seg-lbl {
		fill: #c3a4dc;
		font-size: 11px;
		font-family: monospace;
		pointer-events: none;
		user-select: none;
	}

	.seg-lbl.sel {
		fill: var(--mosh);
	}

	/* Boundary handles: a hairline between two blocks with a wider invisible
	   grab strip over it, the same shape as the text timeline's clip
	   boundaries. */
	.bnd {
		stroke: var(--mosh-dim);
		stroke-width: 1;
		pointer-events: none;
	}

	.bnd.hovered {
		stroke: var(--rec);
		stroke-width: 2;
	}

	.bnd.sel {
		stroke: var(--mosh);
		stroke-width: 2;
	}

	.bnd-hit {
		fill: transparent;
		stroke: none;
		cursor: ew-resize;
	}

	.trans-mark {
		stroke: var(--mosh);
		stroke-width: 1.5;
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
		pointer-events: none;
	}

	.select-rect {
		fill: rgba(176, 138, 208, 0.1);
		stroke: rgba(176, 138, 208, 0.5);
		stroke-width: 1;
		stroke-dasharray: 3 3;
	}

	.ghost-split-line {
		stroke: rgba(176, 138, 208, 0.4);
		stroke-width: 1;
		stroke-dasharray: 3 4;
		pointer-events: none;
	}

	.ghost-span {
		fill: rgba(176, 138, 208, 0.18);
		stroke: rgba(176, 138, 208, 0.45);
		stroke-width: 1;
		rx: 2;
	}

	.hint {
		fill: var(--text-4);
		font-size: 8.5px;
		pointer-events: none;
		user-select: none;
	}


	/* Fills the stack's selection bar. Three columns so the middle run stays put
	   whatever the actions column holds, and never taller than a row — a
	   wrapping bar resized the stack every time a control appeared. */
	.seg-bar {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
	}

	.seg-groups {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0 0.25rem;
	}

	.seg-actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		justify-self: end;
		padding: 0 0.25rem;
	}

	.seg-title {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--mosh);
		white-space: nowrap;
	}

	/* One pill out of two buttons. */
	.seg-mode {
		display: flex;
	}

	.seg-mode :global(.tl-tool-btn:first-child) {
		border-right-color: transparent;
		border-radius: 4px 0 0 4px;
	}

	.seg-mode :global(.tl-tool-btn:last-child) {
		border-radius: 0 4px 4px 0;
	}

	/* The lane's own accent, rather than the stack toolbar's blue. */
	.seg-mode :global(.tl-tool-btn.active) {
		border-color: var(--mosh);
		background: rgba(176, 138, 208, 0.12);
		color: var(--mosh);
	}

	.seg-check {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.68rem;
		color: var(--text-2);
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
	}

	.seg-check:hover {
		color: var(--text);
	}

	.seg-check input {
		accent-color: var(--mosh);
		margin: 0;
	}

	/* Anchored on the boundary's x, opening upwards over the preview: the lane
	   is only 30px tall and the row below it is the segment toolbar. */
	.trans-pop {
		position: fixed;
		z-index: 60;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		min-width: 172px;
		padding: 0.45rem 0.5rem 0.5rem;
		border: 1px solid var(--line);
		border-radius: 5px;
		background: #131313;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
	}

	.trans-pop-head {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-bottom: 0.1rem;
	}

	.trans-pop-title {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--mosh);
	}

	.trans-pop-count {
		font-size: 0.6rem;
		color: var(--text-4);
	}

	.trans-pop-close {
		margin-left: auto;
		padding: 0 0.15rem;
		border: none;
		background: none;
		color: #3d3d3d;
		font-size: 0.7rem;
		line-height: 1;
		cursor: pointer;
	}

	.trans-pop-close:hover {
		color: var(--text-2);
	}

	.trans-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.trans-label {
		flex: 1;
		font-size: 0.62rem;
		color: var(--text-4);
		letter-spacing: 0.03em;
		text-transform: uppercase;
	}

	.trans-row .seg-select {
		min-width: 82px;
	}

	.trans-check {
		font-size: 0.62rem;
		white-space: normal;
	}

	/* Matches .tl-tool-btn, so the bar reads as one set of controls. */
	.seg-select {
		padding: 0.15rem 0.4rem;
		border: 1px solid #2e2e2e;
		border-radius: 4px;
		background: #191919;
		color: var(--text-2);
		font-size: 0.68rem;
		font-family: inherit;
		cursor: pointer;
		outline: none;
	}

	.seg-select:hover {
		border-color: var(--text-4);
		color: var(--text);
	}

	.seg-select:focus {
		border-color: var(--text-4);
	}

</style>
