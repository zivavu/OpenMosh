<script lang="ts">
	import { Dices, Repeat, Trash2 } from 'lucide-svelte';
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
	import { TimelineViewport } from '../../editor/timeline-viewport.svelte';
	import TimelineScrollbar from '../ui/TimelineScrollbar.svelte';
	import type { SequenceSource } from '../../editor/sequence-sources.svelte';

	const MIN_SEGMENT_DURATION = 0.125;
	// Segments are drawn as clip blocks in one lane row, matching the text
	// timeline's geometry: a 22px block inset in a 30px row, growing by a line
	// once the pool has more than one source and each block names its own.
	const ROW_PAD = 4;
	const SEG_H_BASE = 22;
	const SEG_H_SOURCE = 34;
	/** Half-width of a boundary's invisible grab strip. */
	const BND_GRAB = 5;

	interface Props {
		segments: SequenceSegment[];
		trackDuration: number;
		boundaries: SegmentBoundaryController<SequenceSegment>;
		selectedSegmentId?: string | null;
		currentTime?: number;
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
		/** Media pool the segments draw from. One entry = the media bin is hidden. */
		sources?: SequenceSource[];
		/** Segments with no explicit sourceId render as this one. */
		primarySourceId?: string | null;
		onAssignSource?: (segmentIds: string[], sourceId: string) => void;
		onAddSources?: (files: File[]) => void;
		onRemoveSource?: (sourceId: string) => void;
		/** Empty the pool back to the primary source. */
		onClearSources?: () => void;
	}

	let {
		segments: rawSegments,
		trackDuration,
		boundaries,
		selectedSegmentId = $bindable(null),
		currentTime = 0,
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
		onAddSources,
		onRemoveSource,
		onClearSources,
	}: Props = $props();

	// The hint only teaches things the ? shortcuts modal also lists, so hiding
	// it for good costs no discoverability.
	const HINT_KEY = 'openmosh-seq-hint-dismissed';
	const BIN_KEY = 'openmosh-seq-bin-open';
	let hintDismissed = $state(readFlag(HINT_KEY, false));

	function readFlag(key: string, fallback: boolean): boolean {
		try {
			const raw = localStorage.getItem(key);
			return raw === null ? fallback : raw === '1';
		} catch {
			return fallback;
		}
	}

	function writeFlag(key: string, on: boolean) {
		try {
			localStorage.setItem(key, on ? '1' : '0');
		} catch {
			// Private mode / storage blocked — remembered for this session only.
		}
	}

	function dismissHint() {
		hintDismissed = true;
		writeFlag(HINT_KEY, true);
	}

	let hasMediaBin = $derived(!!onAddSources);
	let multiSource = $derived(sources.length > 1);
	let segH = $derived(multiSource ? SEG_H_SOURCE : SEG_H_BASE);
	let svgH = $derived(segH + ROW_PAD * 2);
	/** Baseline of the segment's own label: centred when it's the only line. */
	let labelY = $derived(ROW_PAD + (multiSource ? 14 : segH / 2 + 4));
	let sourceLabelY = $derived(ROW_PAD + 27);
	let sourceInput = $state<HTMLInputElement>(undefined!);
	// Collapsed by default: a grid of chips is the tallest thing in the timeline
	// stack and it's only needed while assigning sources. The choice is
	// remembered, so anyone who works with it open keeps it open.
	let binOpen = $state(readFlag(BIN_KEY, false));

	function toggleBin() {
		binOpen = !binOpen;
		writeFlag(BIN_KEY, binOpen);
	}

	// Indexed rather than scanned: segVis recomputes on every zoom/pan frame,
	// and a linear find per segment over a few hundred sources showed up as
	// drag lag.
	let sourceIndex = $derived(
		new Map(sources.map((s, i) => [s.id, { src: s, n: i + 1 }])),
	);

	function sourceOf(s: SequenceSegment): SequenceSource | undefined {
		return sourceIndex.get(s.sourceId ?? primarySourceId ?? '')?.src;
	}

	/** Filenames from one export batch share a long prefix, so keep the tail
	 * (and the extension) rather than truncating from the right. */
	function shortName(name: string, max = 16): string {
		if (name.length <= max) return name;
		const dot = name.lastIndexOf('.');
		const ext = dot > 0 && name.length - dot <= 5 ? name.slice(dot) : '';
		const stem = ext ? name.slice(0, dot) : name;
		// A slice(0) would return the whole stem, so never let the budget hit 0.
		const keep = Math.max(1, max - ext.length - 1);
		return `…${stem.slice(-keep)}${ext}`;
	}

	let svgEl: SVGSVGElement | undefined = $state();
	/** Track width in px, for sizing labels to their blocks. */
	let trackWidth = $state(0);

	// ── View window (zoom / pan) ─────────────────────────────────────────────
	const vp = new TimelineViewport(
		() => trackDuration,
		() => svgEl?.getBoundingClientRect() ?? null,
	);

	// Reset to fully zoomed out whenever the master duration changes (e.g. a
	// track loads after the video) — keeping the old window left the timeline
	// near-max zoomed on init.
	let lastDuration = 0;
	$effect(() => {
		const td = trackDuration;
		if (td > 0 && td !== lastDuration) {
			lastDuration = td;
			vp.viewStart = 0;
			vp.viewEnd = td;
		}
	});

	let segments = $derived(
		[...rawSegments].sort((a, b) => a.startTime - b.startTime),
	);

	// ── Multi-selection ──────────────────────────────────────────────────────
	// All selected segment ids; the bindable selectedSegmentId is the primary
	// (last-selected) one, which Editor uses for the effects panel and loop.
	let selectedIds = $state<string[]>([]);

	function setSelection(ids: string[]) {
		selectedIds = ids;
		selectedSegmentId = ids.length > 0 ? ids[ids.length - 1] : null;
	}

	function toggleInSelection(id: string) {
		if (selectedIds.includes(id)) setSelection(selectedIds.filter((x) => x !== id));
		else setSelection([...selectedIds, id]);
	}

	let selectedSegments = $derived(
		segments.filter((s) => selectedIds.includes(s.id)),
	);

	// Drop ids whose segments were removed (merge/undo/track change).
	$effect(() => {
		const alive = new Set(rawSegments.map((s) => s.id));
		if (selectedIds.some((id) => !alive.has(id))) {
			setSelection(selectedIds.filter((id) => alive.has(id)));
		}
	});

	// Editor clears selectedSegmentId externally (e.g. loading a saved sequence).
	$effect(() => {
		if (!selectedSegmentId && selectedIds.length > 0) selectedIds = [];
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

	// Highlights the bin chip the selection uses; null when they disagree.
	let selectedSourceId = $derived(
		commonValue(selectedSegments.map((s) => s.sourceId ?? primarySourceId)) ??
			null,
	);

	let commonMode = $derived(commonValue(selectedSegments.map((s) => s.mode)));

	// ── Drag a source onto a segment ─────────────────────────────────────────
	// HTML5 drag events, deliberately: they're a separate stream from the
	// pointer events every other timeline interaction uses, so nothing here can
	// be mistaken for a boundary drag, a rect-select or a seek.
	let dragSourceId = $state<string | null>(null);
	let dropSegId = $state<string | null>(null);
	let gridEl = $state<HTMLDivElement | null>(null);
	let gridScrollTop = 0;

	/** Segments a drop would land on — the whole selection when the target is
	 * part of it, matching how the toolbar actions fan out. */
	let dropTargetIds = $derived(
		dropSegId
			? selectedIds.includes(dropSegId)
				? selectedIds
				: [dropSegId]
			: [],
	);

	function startSourceDrag(e: DragEvent, sourceId: string) {
		gridScrollTop = gridEl?.scrollTop ?? 0;
		dragSourceId = sourceId;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'copy';
			// Some browsers cancel a drag that carries no data at all.
			e.dataTransfer.setData('text/plain', sourceId);
		}
	}

	function endSourceDrag() {
		dragSourceId = null;
		dropSegId = null;
		// Toggling overflow back can clamp scrollTop; put it back where it was.
		if (gridEl) gridEl.scrollTop = gridScrollTop;
	}

	function segmentAtTime(t: number): SequenceSegment | undefined {
		return segments.find((s) => {
			const end = Math.min(trackDuration, s.endTime ?? trackDuration);
			return t >= s.startTime && t < end;
		});
	}

	function onTimelineDragOver(e: DragEvent) {
		if (!dragSourceId) return;
		// Without preventDefault the browser refuses the drop entirely.
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
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
		dropSegId = null;
	}

	function onTimelineDrop(e: DragEvent) {
		if (!dragSourceId) return;
		e.preventDefault();
		const sourceId = dragSourceId;
		const targets = dropTargetIds;
		endSourceDrag();
		if (targets.length > 0) onAssignSource?.(targets, sourceId);
	}
	let commonIntervalSec = $derived(
		commonValue(selectedSegments.map((s) => s.intervalSec ?? 0.25)),
	);
	let commonIntervalBeats = $derived(
		commonValue(selectedSegments.map((s) => s.intervalBeats ?? 0)),
	);

	/** The picker's value: a `b`-prefixed beat count when the spacing is tied to
	 * the beat, otherwise the raw seconds. Blank when the selection disagrees. */
	let intervalValue = $derived.by(() => {
		if (commonIntervalBeats) return `b${commonIntervalBeats}`;
		if (commonIntervalBeats === undefined || commonIntervalSec === undefined) {
			return '';
		}
		return String(commonIntervalSec);
	});

	// ── Transition toolbar ─────────────────────────────────────────────────
	// Each value is undefined when the selected segments disagree; the controls
	// then render blank until the user picks a value, which applies to all.
	let commonTransitionType = $derived(
		commonValue(
			selectedSegments.map((s): TransitionType => s.transition?.type ?? 'cut'),
		),
	);
	let commonTransitionMeta = $derived(
		commonTransitionType
			? TRANSITION_OPTIONS.find((o) => o.value === commonTransitionType)
			: undefined,
	);
	let commonTransitionDuration = $derived(
		commonValue(selectedSegments.map((s) => s.transition?.durationSec)),
	);
	let commonTransitionDirection = $derived(
		commonValue(selectedSegments.map((s) => s.transition?.direction ?? 0)),
	);
	let commonTransitionDensity = $derived(
		commonValue(selectedSegments.map((s) => s.transition?.density ?? 1)),
	);
	let commonTransitionOnTick = $derived(
		commonValue(selectedSegments.map((s) => s.transitionOnTick ?? false)),
	);

	function changeTransitionType(type: TransitionType) {
		if (selectedSegments.length === 0) return;
		onTransitionChange(
			selectedSegments.map((seg) => ({
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
		const changes = selectedSegments
			.filter((s) => s.transition)
			.map((seg) => ({
				segmentId: seg.id,
				transition: { ...seg.transition!, ...patch },
			}));
		if (changes.length > 0) onTransitionChange(changes);
	}

	/** Each segment gets its own fresh seed so layouts don't all match. */
	function rerollTransitionSeeds() {
		const changes = selectedSegments
			.filter((s) => s.transition)
			.map((seg) => ({
				segmentId: seg.id,
				transition: { ...seg.transition!, seed: randomSeed() },
			}));
		if (changes.length > 0) onTransitionChange(changes);
	}

	function setTransitionOnTick(on: boolean) {
		const changes = selectedSegments
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

	function copySelectedSegments(): boolean {
		if (selectedSegments.length === 0) return false;
		segClipboard = copySegments(selectedSegments, trackDuration);
		clipIsSpan = boundaries.selectedBoundaryTimes.length > 0;
		return segClipboard.length > 0;
	}

	function pasteSegments(): boolean {
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
				group: GroupBoundary[];
				nonSelected: number[];
		  }
		| { type: 'seek' }
		| { type: 'seg-click'; segmentId: string }
		| {
				type: 'rect-select';
				startTime: number;
				currentTime: number;
				/** Segment under the pointer at drag start: shift-click (no move) toggles it. */
				toggleSegId?: string;
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

	$effect(() => {
		if (!svgEl) return;
		return vp.attachWheel(svgEl);
	});

	// ── Derived visuals ──────────────────────────────────────────────────────
	interface SegVis {
		id: string;
		startX: number;
		endX: number;
		startTime: number;
		endTime: number;
		label: string;
		/** Null when the pool has one source — nothing to distinguish. */
		sourceLabel: string | null;
		transitionType: TransitionType;
		transitionDuration: number;
	}

	function segLabel(s: SequenceSegment): string {
		if (s.mode === 'interval') {
			return `auto ${intervalLabel(s.intervalSec, s.intervalBeats)}`;
		}
		// "*" = hand-edited since it was filled (preset overwrites skip it).
		return s.modified ? `${s.label}*` : s.label;
	}

	/** Trim a label to what fits inside its block, so text can't spill onto the
	 * neighbouring segments the way a centred label under a line couldn't. */
	function fitLabel(text: string, boxPx: number, charPx: number): string {
		const max = Math.floor((boxPx - 6) / charPx);
		if (max < 2) return '';
		return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
	}

	let segVis = $derived.by((): SegVis[] =>
		segments.map((s) => {
			const endTime = Math.min(trackDuration, s.endTime ?? trackDuration);
			const startX = vp.toPct(s.startTime);
			const endX = vp.toPct(endTime);
			const boxPx = ((endX - startX) / 100) * trackWidth;
			const source = multiSource
				? sourceIndex.get(s.sourceId ?? primarySourceId ?? '')
				: undefined;
			return {
				id: s.id,
				startX,
				endX,
				startTime: s.startTime,
				endTime,
				label: fitLabel(segLabel(s), boxPx, 6.6),
				sourceLabel: source
					? fitLabel(`${source.n}· ${shortName(source.src.name, 14)}`, boxPx, 5.4)
					: null,
				transitionType: s.transition?.type ?? 'cut',
				transitionDuration: s.transition?.durationSec ?? 0,
			};
		}),
	);

	// ── Split / create ───────────────────────────────────────────────────────
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

	function onDblClick(e: MouseEvent) {
		splitAt(vp.clientXToTime(e.clientX));
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

	function startRectSelect(e: PointerEvent, toggleSegId?: string) {
		e.stopPropagation();
		const time = vp.clientXToTime(e.clientX);
		dragging = { type: 'rect-select', startTime: time, currentTime: time, toggleSegId };
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
		// Shift: toggle this segment into the selection on click, or rect-select
		// on drag — same gesture as on the empty timeline.
		if (e.shiftKey) {
			startRectSelect(e, segId);
			return;
		}
		dragging = { type: 'seg-click', segmentId: segId };
		dragMoved = false;
		try {
			(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function startSeekDrag(e: PointerEvent) {
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
		const time = Math.max(0, Math.min(trackDuration, vp.clientXToTime(e.clientX)));
		onSeek(time);
		dragging = { type: 'seek' };
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
					const minEnd = lseg.startTime + MIN_SEGMENT_DURATION;
					const maxEnd = rightSegId
						? (rawSegments.find((s) => s.id === rightSegId)?.endTime ??
								trackDuration) - MIN_SEGMENT_DURATION
						: trackDuration;
					const clamped = Math.max(minEnd, Math.min(maxEnd, time));
					updates[leftSegId] = { endTime: clamped };
					if (rightSegId) updates[rightSegId] = { startTime: clamped };
				}
			} else if (rightSegId) {
				const rseg = rawSegments.find((s) => s.id === rightSegId);
				if (rseg) {
					const maxStart =
						(rseg.endTime ?? trackDuration) - MIN_SEGMENT_DURATION;
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
				MIN_SEGMENT_DURATION,
			);
			const updates = groupDeltaUpdates(dragging.group, delta);
			boundaries.live(
				rawSegments.map((s) => (updates[s.id] ? { ...s, ...updates[s.id] } : s)),
			);
		} else if (dragging.type === 'rect-select') {
			dragMoved = true;
			dragging = { ...dragging, currentTime: vp.clientXToTime(e.clientX) };
		} else if (dragging.type === 'seek') {
			dragMoved = true;
			const time = Math.max(
				0,
				Math.min(trackDuration, vp.clientXToTime(e.clientX)),
			);
			onSeek?.(time);
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
		if (dragging?.type === 'seg-click' && !dragMoved) {
			const segId = dragging.segmentId;
			const soleSelected = selectedIds.length === 1 && selectedIds[0] === segId;
			setSelection(soleSelected ? [] : [segId]);
		}
		if (dragging?.type === 'rect-select') {
			if (dragMoved) {
				const minTime = Math.min(dragging.startTime, dragging.currentTime);
				const maxTime = Math.max(dragging.startTime, dragging.currentTime);
				boundaries.setSelectionFromRange(minTime, maxTime);
				setSelection(segmentIdsInRange(minTime, maxTime));
			} else if (dragging.toggleSegId) {
				toggleInSelection(dragging.toggleSegId);
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
			setSelection([
				...new Set(selectedIds.map((id) => (id === rightSegId ? leftSegId : id))),
			]);
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
		if (dragging.type === 'seek') return 'col-resize';
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
/>

<div class="tl-container">
	{#if hasMediaBin}
		{@const assignable = selectedIds.length > 0}
		<div class="media-bin">
			<div class="media-bin-head">
				<button
					class="media-bin-toggle"
					aria-expanded={binOpen}
					onclick={toggleBin}
				>
					<span class="media-bin-caret" class:open={binOpen}>▸</span>
					SOURCES
					<span class="media-bin-count">{sources.length}</span>
				</button>
				{#if binOpen}
					<span class="media-bin-hint">
						{#if dragSourceId}
							DROP ON A SEGMENT
						{:else if assignable}
							CLICK OR DRAG ONTO {selectedIds.length > 1
								? `${selectedIds.length} SEGMENTS`
								: 'A SEGMENT'}
						{:else}
							DRAG ONTO A SEGMENT, OR SELECT ONE FIRST
						{/if}
					</span>
				{/if}
				<input
					bind:this={sourceInput}
					type="file"
					accept="image/*,video/*"
					multiple
					hidden
					onchange={(e) => {
						const picked = Array.from(e.currentTarget.files ?? []);
						if (picked.length > 0) onAddSources?.(picked);
						e.currentTarget.value = '';
					}}
				/>
				<div class="media-bin-actions">
					{#if onClearSources && multiSource}
						<button
							class="media-bin-btn danger"
							title="Remove every added source from this song"
							onclick={onClearSources}
						>
							<Trash2 size={11} />
							CLEAR
						</button>
					{/if}
					<button
						class="media-bin-btn"
						title="Add images or videos to the pool"
						onclick={() => sourceInput.click()}>+ ADD</button
					>
				</div>
			</div>
			<!-- Capped height with its own scroll: letting a few hundred chips
			     wrap freely pushes the preview clean off the screen. -->
			<div
					bind:this={gridEl}
					class="media-grid"
					class:collapsed={!binOpen}
					class:drag-locked={!!dragSourceId}
				>
				{#each sources as src, i (src.id)}
					<div
						class="media-chip"
						class:active={selectedSourceId === src.id}
						class:dragging={dragSourceId === src.id}
					>
						<button
							class="media-chip-assign"
							class:assignable
							draggable="true"
							title={assignable
								? `Use "${src.name}" for the selected segment${selectedIds.length > 1 ? 's' : ''}, or drag it onto one`
								: `${src.name}. Drag it onto a segment, or select one and click`}
							ondragstart={(e) => startSourceDrag(e, src.id)}
							ondragend={endSourceDrag}
							onclick={() => {
								if (assignable) onAssignSource?.(selectedIds, src.id);
							}}
						>
							{#if src.thumbUrl}
								<img
									class="media-chip-img"
									src={src.thumbUrl}
									alt=""
									loading="lazy"
									decoding="async"
									draggable="false"
								/>
							{/if}
							<span class="media-chip-num">
								{i + 1}{#if src.kind === 'video'}<span class="media-chip-kind"
										>▶</span
									>{/if}
							</span>
							<span class="media-chip-name">{shortName(src.name, 18)}</span>
						</button>
						{#if !src.primary}
							<button
								class="media-chip-remove"
								title="Remove from the pool"
								onclick={() => onRemoveSource?.(src.id)}>✕</button
							>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
	<div
		class="tl-track"
		class:drop-active={!!dragSourceId}
		bind:clientWidth={trackWidth}
		ondragover={onTimelineDragOver}
		ondragleave={onTimelineDragLeave}
		ondrop={onTimelineDrop}
		role="presentation"
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<svg
			bind:this={svgEl}
			width="100%"
			height={svgH}
			class="step-svg"
			style:cursor={svgCursor}
			ondblclick={onDblClick}
			onpointerdown={startSeekDrag}
		>
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
					onpointerdown={(e) => startSegClick(e, sv.id)}
				/>
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
				{#if sv.sourceLabel}
					<text
						class="seg-src-lbl"
						class:sel
						class:drop
						x="{midX}%"
						y={sourceLabelY}
						text-anchor="middle">{sv.sourceLabel}</text
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
							>Drag to move (whole selection if selected) · Delete to merge ·
							Shift-drag to select</title
						></rect
					>
				{/if}
			{/each}

			{#if showHint}
				<text class="hint" x="50%" y={ROW_PAD + segH / 2 + 4} text-anchor="middle">
					Double-click to create a segment · click a segment to edit its effects
				</text>
			{/if}

			<!-- Playhead -->
			{#if trackDuration > 0}
				{@const phx = vp.toPct(currentTime)}
				<line class="playhead-line" x1="{phx}%" y1="0" x2="{phx}%" y2={svgH} />
				<circle class="playhead-head" cx="{phx}%" cy="1" r="3" />
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

	<div class="tl-scroll-row">
		<TimelineScrollbar {vp} {trackDuration} accent="purple" />
	</div>

	<!-- Kept mounted while the hint shows so selecting a segment doesn't shift
	     the layout. Once the hint is dismissed there's nothing to reserve space
	     for, and the row collapses until something is selected. -->
	{#if selectedSegments.length > 0 || !hintDismissed}
		<div class="seg-toolbar">
			{#if selectedSegments.length > 0}
			{@const many = selectedSegments.length > 1}
			<span class="seg-toolbar-label">
				{many ? `${selectedSegments.length} SEGMENTS` : 'SEGMENT'}
			</span>
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
				class="seg-btn"
				title={commonMode === 'interval'
					? 'New random seed'
					: many
						? 'Random mosh for each selected segment'
						: 'Random mosh for this segment'}
				onclick={() => onRoll(selectedIds)}
			>
				<Dices size={12} />
				MOSH
			</button>
			<button
				class="seg-btn"
				title={many
					? "Clear the selected segments' effects"
					: "Clear this segment's effects"}
				onclick={() => onClear(selectedIds)}
			>
				<Trash2 size={12} />
				CLEAR
			</button>
			<div class="seg-mode">
				<button
					class="seg-btn"
					class:active={commonMode === 'static'}
					onclick={() => onModeChange(selectedIds, 'static')}
				>
					STATIC
				</button>
				<button
					class="seg-btn"
					class:active={commonMode === 'interval'}
					onclick={() => onModeChange(selectedIds, 'interval')}
				>
					AUTO
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
							onModeChange(
								selectedIds,
								'interval',
								(60 / bpm) * beats,
								beats,
							);
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
						<option value={sec}>every {sec}s</option>
					{/each}
				</select>
		{/if}
			<span class="seg-toolbar-label">TRANSITION</span>
			<select
				class="seg-select"
				value={commonTransitionType ?? ''}
				title="How each selected segment blends in from the previous one"
				onchange={(e) => {
					const v = e.currentTarget.value;
					if (v !== '') changeTransitionType(v as TransitionType);
				}}
			>
				{#if commonTransitionType === undefined}
					<option value="" disabled>—</option>
				{/if}
				{#each TRANSITION_OPTIONS as o}
					<option value={o.value}>{o.label}</option>
				{/each}
			</select>
			{#if commonTransitionType && commonTransitionType !== 'cut'}
				<select
					class="seg-select"
					value={commonTransitionDuration ?? ''}
					title="Transition duration"
					onchange={(e) => {
						const v = e.currentTarget.value;
						if (v !== '') patchTransition({ durationSec: Number(v) });
					}}
				>
					{#if commonTransitionDuration === undefined}
						<option value="" disabled>—</option>
					{/if}
					{#each [0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.2, 2] as sec}
						<option value={sec}>{sec}s</option>
					{/each}
				</select>
				{#if commonTransitionMeta?.hasDirection}
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
							<option value="" disabled>—</option>
						{/if}
						<option value={0}>→</option>
						<option value={1}>←</option>
						<option value={2}>↓</option>
						<option value={3}>↑</option>
					</select>
				{/if}
				{#if commonTransitionMeta?.hasDensity}
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
							<option value="" disabled>—</option>
						{/if}
						<option value={0}>coarse</option>
						<option value={1}>med</option>
						<option value={2}>fine</option>
					</select>
				{/if}
				{#if commonTransitionMeta?.hasSeed}
					<button
						class="seg-btn"
						title="Re-roll transition layout"
						onclick={rerollTransitionSeeds}
					>
						<Dices size={12} />
					</button>
				{/if}
				{#if commonMode === 'interval'}
					<label
						class="seg-check"
						title="Blend at each re-roll tick inside the segment"
					>
						<input
							type="checkbox"
							checked={commonTransitionOnTick === true}
							indeterminate={commonTransitionOnTick === undefined}
							onchange={(e) => setTransitionOnTick(e.currentTarget.checked)}
						/>
						TICKS
					</label>
				{/if}
			{/if}
			{#if onToggleSegmentLoop && !many}
				<button
					class="seg-btn"
					class:active={segmentLoop}
					title="Loop playback inside this segment"
					onclick={onToggleSegmentLoop}
				>
					<Repeat size={12} />
				</button>
			{/if}
			<button
				class="seg-btn danger"
				title={many ? 'Delete selected segments' : 'Delete segment'}
				onclick={() => removeSegments(selectedIds)}
			>
				<Trash2 size={12} />
			</button>
		{:else}
			<span class="seg-toolbar-hint">
				{segments.length === 0
					? 'Double-click the timeline to create a segment'
					: 'Click a segment to edit · shift-click or shift-drag to select several'}
			</span>
			<button
				class="hint-dismiss"
				title="Hide this hint. The shortcuts stay in the ? menu."
				onclick={dismissHint}>✕</button
			>
		{/if}
		</div>
	{/if}
</div>

<style>
	.tl-container {
		margin: 0 0.5rem;
	}

	.tl-track {
		position: relative;
		background: #111;
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		overflow: hidden;
	}

	.step-svg {
		display: block;
		width: 100%;
		overflow: hidden;
	}

	/* Outside the bordered track, so the bar doesn't sit inside a second frame. */
	.tl-scroll-row {
		display: flex;
		margin-top: 3px;
	}

	.tail {
		stroke: #333;
		stroke-width: 1;
		stroke-dasharray: 3 4;
	}

	/* Segment blocks, styled like the text timeline's clips: a filled body with
	   its label inside, rather than a line with the label hung underneath. */
	.seg {
		fill: #2b2038;
		stroke: #6a5080;
		stroke-width: 1;
		pointer-events: all;
		cursor: pointer;
	}

	.seg:hover {
		stroke: #9a70b8;
	}

	.seg.sel {
		fill: #3d2c52;
		stroke: #d8b8f8;
	}

	/* Drop preview — deliberately a different hue from selection purple, so
	   "where this will land" reads apart from "what is selected". */
	.seg.drop {
		fill: #14382e;
		stroke: #6ee7c0;
		stroke-width: 2;
	}

	.seg-src-lbl.drop,
	.seg-lbl.drop {
		fill: #6ee7c0;
	}

	.tl-track.drop-active {
		outline: 1px dashed #3d6b5c;
		outline-offset: -1px;
	}

	.seg-lbl {
		fill: #c3a4dc;
		font-size: 11px;
		font-family: monospace;
		pointer-events: none;
		user-select: none;
	}

	.seg-lbl.sel {
		fill: #d8b8f8;
	}

	.seg-src-lbl {
		fill: #8e76a6;
		font-size: 9px;
		font-family: monospace;
		pointer-events: none;
		user-select: none;
	}

	.seg-src-lbl.sel {
		fill: #a888c4;
	}

	/* ── Media bin ── */
	.media-bin {
		padding-bottom: 0.5rem;
	}

	.media-bin-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0 0.1rem 0.35rem;
	}

	.media-bin-toggle {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0;
		border: none;
		background: none;
		color: #7a5f94;
		font-size: 0.62rem;
		font-family: monospace;
		font-weight: 700;
		letter-spacing: 0.1em;
		cursor: pointer;
	}

	.media-bin-toggle:hover {
		color: #b08ad0;
	}

	.media-bin-caret {
		display: inline-block;
		font-size: 0.6rem;
		transition: transform 0.15s;
	}

	.media-bin-caret.open {
		transform: rotate(90deg);
	}

	.media-bin-count {
		padding: 1px 5px;
		border-radius: 999px;
		background: #221a2c;
		color: #b08ad0;
		font-size: 0.58rem;
		letter-spacing: 0;
	}

	.media-bin-hint {
		color: #4a3c58;
		font-size: 0.62rem;
		font-family: monospace;
		letter-spacing: 0.04em;
	}

	.media-bin-actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-left: auto;
	}

	.media-bin-btn {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.2rem 0.6rem;
		border: 1px solid #2e2438;
		border-radius: 4px;
		background: transparent;
		color: #7a5f94;
		font-size: 0.6rem;
		font-family: monospace;
		font-weight: 700;
		letter-spacing: 0.08em;
		cursor: pointer;
	}

	.media-bin-btn:hover {
		border-color: #6a5080;
		color: #d8b8f8;
	}

	.media-bin-btn.danger:hover {
		border-color: #8a3a4a;
		color: #f0a0b0;
	}

	/* Two rows tall, then scrolls — a wrapping grid of a few hundred chips
	   would take the whole viewport and leave nothing for the preview. */
	.media-grid {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		gap: 0.35rem;
		max-height: 94px;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		scrollbar-color: #3a2e48 transparent;
		/* Reserved so locking the scroll mid-drag can't reflow the chips. */
		scrollbar-gutter: stable;
	}

	/* Dragging a chip toward the timeline drags it past the grid's bottom edge,
	   which the browser reads as "autoscroll this container" — the chips slide
	   away under the cursor mid-drag. Freezing the scroll for the duration is
	   the only reliable way to stop it; the position is kept either way. */
	.media-grid.drag-locked {
		overflow-y: hidden;
	}

	.media-grid.collapsed {
		display: none;
	}

	.media-chip {
		position: relative;
		flex: 0 0 auto;
		width: 44px;
		height: 44px;
		border: 1.5px solid #2e2438;
		border-radius: 6px;
		overflow: hidden;
		transition: border-color 0.15s;
	}

	.media-chip:hover {
		border-color: #6a5080;
	}

	.media-chip.active {
		border-color: #d8b8f8;
		box-shadow: 0 0 0 1px rgba(216, 184, 248, 0.35);
	}

	.media-chip.dragging {
		opacity: 0.45;
		border-color: #6ee7c0;
	}

	.media-chip-assign {
		display: block;
		position: relative;
		width: 100%;
		height: 100%;
		padding: 0;
		border: none;
		background: #14101a;
		/* Always draggable, so grab beats pointer even with nothing selected. */
		cursor: grab;
	}

	.media-chip-assign:active {
		cursor: grabbing;
	}

	/* A real <img> rather than a background: object-fit centres the crop
	   predictably, and loading="lazy" keeps a few hundred offscreen chips from
	   being decoded at once. */
	.media-chip-img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
	}

	.media-chip-num {
		position: absolute;
		top: 0;
		left: 0;
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 1px 4px;
		border-bottom-right-radius: 5px;
		background: rgba(10, 6, 16, 0.82);
		color: #d8b8f8;
		font-size: 9px;
		font-family: monospace;
		font-weight: 700;
		line-height: 1.3;
	}

	.media-chip-kind {
		color: #9a70b8;
		font-size: 7px;
	}

	/* Names in one batch share a long prefix, so showing them all the time is
	   noise that also covers the thumbnail. Reveal on hover instead. */
	.media-chip-name {
		position: absolute;
		inset: auto 0 0 0;
		padding: 2px 3px;
		background: rgba(10, 6, 16, 0.86);
		color: #cdb6e0;
		font-size: 8px;
		font-family: monospace;
		line-height: 1.25;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		opacity: 0;
		transition: opacity 0.12s;
	}

	.media-chip:hover .media-chip-name {
		opacity: 1;
	}

	.media-chip-remove {
		position: absolute;
		top: 1px;
		right: 1px;
		width: 15px;
		height: 15px;
		display: none;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: none;
		border-radius: 3px;
		background: rgba(10, 6, 16, 0.8);
		color: #e0c8f0;
		font-size: 9px;
		line-height: 1;
		cursor: pointer;
	}

	.media-chip:hover .media-chip-remove {
		display: flex;
	}

	.media-chip-remove:hover {
		background: #8a3a4a;
	}


	/* Boundary handles: a hairline between two blocks with a wider invisible
	   grab strip over it, the same shape as the text timeline's clip
	   boundaries. */
	.bnd {
		stroke: #6a5080;
		stroke-width: 1;
		pointer-events: none;
	}

	.bnd.hovered {
		stroke: #ff7070;
		stroke-width: 2;
	}

	.bnd.sel {
		stroke: #d8b8f8;
		stroke-width: 2;
	}

	.bnd-hit {
		fill: transparent;
		stroke: none;
		cursor: ew-resize;
	}

	.trans-mark {
		stroke: #d8b8f8;
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

	.playhead-line {
		stroke: rgba(255, 210, 80, 0.75);
		stroke-width: 1;
		pointer-events: none;
	}

	.playhead-head {
		fill: rgba(255, 210, 80, 0.9);
		stroke: none;
		pointer-events: none;
	}

	.hint {
		fill: #3a3a3a;
		font-size: 8.5px;
		pointer-events: none;
		user-select: none;
	}


	.seg-toolbar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.25rem;
		flex-wrap: wrap;
		min-height: 28px;
	}

	.seg-toolbar-hint {
		font-size: 0.62rem;
		color: #555;
		letter-spacing: 0.03em;
	}

	.hint-dismiss {
		padding: 0 0.3rem;
		border: none;
		background: none;
		color: #3d3d3d;
		font-size: 0.7rem;
		line-height: 1;
		cursor: pointer;
	}

	.hint-dismiss:hover {
		color: #999;
	}

	.seg-toolbar-label {
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #9a70b8;
	}

	.seg-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid #444;
		border-radius: 4px;
		background: #1a1a1a;
		color: #aaa;
		font-size: 0.62rem;
		font-weight: 600;
		font-family: inherit;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.seg-btn:hover {
		border-color: #777;
		color: #ddd;
	}

	.seg-btn.active {
		border-color: #b08ad0;
		color: #d8b8f8;
		background: rgba(176, 138, 208, 0.1);
	}

	.seg-btn.danger:hover {
		border-color: #c05050;
		color: #e88;
	}

	.seg-mode {
		display: flex;
		gap: 0;
	}

	.seg-mode .seg-btn:first-child {
		border-radius: 4px 0 0 4px;
		border-right: none;
	}

	.seg-mode .seg-btn:last-child {
		border-radius: 0 4px 4px 0;
	}

	.seg-check {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.62rem;
		font-weight: 600;
		color: #aaa;
		letter-spacing: 0.04em;
		cursor: pointer;
		user-select: none;
	}

	.seg-check:hover {
		color: #ddd;
	}

	.seg-check input {
		accent-color: #b08ad0;
		margin: 0;
	}

	.seg-select {
		background: #1a1a1a;
		color: #aaa;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		font-size: 0.62rem;
		font-family: inherit;
		cursor: pointer;
		outline: none;
	}

	.seg-select:focus {
		border-color: #555;
	}

	@media (max-width: 800px) {
		.tl-container {
			margin: 0 8px;
		}

		/* Smaller chips still — a phone has no screen to spare. */
		.media-chip,
		.media-chip-assign {
			width: 38px;
			height: 38px;
		}

		.media-grid {
			max-height: 82px;
			gap: 0.3rem;
		}

		/* No hover on touch: show the name band permanently instead. */
		.media-chip-name {
			opacity: 1;
		}

		.media-chip-remove {
			display: flex;
		}

		.media-bin-hint {
			display: none;
		}
		.tl-track {
			border-radius: 0;
			border-left: none;
			border-right: none;
		}
	}
</style>
