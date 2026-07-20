<script lang="ts">
	import { Dices, Repeat, Trash2 } from 'lucide-svelte';
	import { loadPresets, type Preset } from '../../effects';
	import {
		cloneSegmentForSplit,
		createSequenceSegment,
		DEFAULT_TRANSITION_DURATION,
		randomSeed,
		TRANSITION_OPTIONS,
		type SegmentTransition,
		type SequenceSegment,
		type SequenceSegmentMode,
		type TransitionType,
	} from '../../editor/sequence';
	import type { SegmentBoundaryController } from '../../editor/segment-boundary-controller.svelte';
	import { TimelineViewport } from '../../editor/timeline-viewport.svelte';

	const MIN_SEGMENT_DURATION = 0.125;
	const SVG_H = 48;
	const LINE_Y = 18;
	const DOT_R = 4;

	interface Props {
		segments: SequenceSegment[];
		trackDuration: number;
		boundaries: SegmentBoundaryController<SequenceSegment>;
		selectedSegmentId?: string | null;
		currentTime?: number;
		onSeek?: (time: number) => void;
		onApplyPreset: (segmentId: string, preset: Preset) => void;
		onRoll: (segmentId: string) => void;
		onModeChange: (
			segmentId: string,
			mode: SequenceSegmentMode,
			intervalSec?: number,
		) => void;
		/** Transition config edits; `null` transition = hard cut. */
		onTransitionChange: (
			segmentId: string,
			transition: SegmentTransition | null,
			transitionOnTick?: boolean,
		) => void;
		/** Loop playback inside the selected segment (for editing while playing). */
		segmentLoop?: boolean;
		onToggleSegmentLoop?: () => void;
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
		onModeChange,
		onTransitionChange,
		segmentLoop = false,
		onToggleSegmentLoop,
	}: Props = $props();

	let svgEl: SVGSVGElement | undefined = $state();
	let scrollbarEl: HTMLDivElement | undefined = $state();

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

	let selectedSegment = $derived(
		rawSegments.find((s) => s.id === selectedSegmentId) ?? null,
	);

	// Presets are read fresh on selection and on dropdown open, so ones saved
	// from the effects panel show up without leaving sequence mode.
	let presetList = $state<Preset[]>([]);
	$effect(() => {
		if (selectedSegment) presetList = loadPresets();
	});

	// Index of the selected segment's assigned preset, so the dropdown shows it
	// instead of the placeholder.
	let selectedPresetIndex = $derived(
		selectedSegment?.presetName
			? presetList.findIndex((p) => p.name === selectedSegment!.presetName)
			: -1,
	);

	// ── Transition toolbar ─────────────────────────────────────────────────
	let selectedTransitionType = $derived<TransitionType>(
		selectedSegment?.transition?.type ?? 'cut',
	);
	let selectedTransitionMeta = $derived(
		TRANSITION_OPTIONS.find((o) => o.value === selectedTransitionType)!,
	);

	function changeTransitionType(type: TransitionType) {
		const seg = selectedSegment;
		if (!seg) return;
		if (type === 'cut') {
			onTransitionChange(seg.id, null);
			return;
		}
		// Keep duration/seed/params when switching between non-cut types.
		const cur = seg.transition;
		onTransitionChange(seg.id, {
			type,
			durationSec: cur?.durationSec ?? DEFAULT_TRANSITION_DURATION,
			seed: cur?.seed ?? randomSeed(),
			direction: cur?.direction,
			density: cur?.density,
		});
	}

	function patchTransition(patch: Partial<SegmentTransition>) {
		const seg = selectedSegment;
		if (!seg?.transition) return;
		onTransitionChange(seg.id, { ...seg.transition, ...patch });
	}

	$effect(() => {
		if (selectedSegmentId && !selectedSegment) selectedSegmentId = null;
	});

	// ── Drag state ───────────────────────────────────────────────────────────
	type DragState =
		| { type: 'boundary'; leftSegId: string | null; rightSegId: string | null }
		| { type: 'seek' }
		| { type: 'seg-click'; segmentId: string }
		| {
				type: 'scroll-pan';
				startClientX: number;
				startViewStart: number;
				scrollWidth: number;
		  }
		| {
				type: 'rect-select';
				startTime: number;
				currentTime: number;
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
		transitionType: TransitionType;
		transitionDuration: number;
	}

	function segLabel(s: SequenceSegment): string {
		if (s.mode === 'interval') return `auto ${s.intervalSec ?? 0.25}s`;
		// "*" = hand-edited since it was filled (preset overwrites skip it).
		return s.modified ? `${s.label}*` : s.label;
	}

	let segVis = $derived.by((): SegVis[] =>
		segments.map((s) => {
			const endTime = Math.min(trackDuration, s.endTime ?? trackDuration);
			return {
				id: s.id,
				startX: vp.toPct(s.startTime),
				endX: vp.toPct(endTime),
				startTime: s.startTime,
				endTime,
				label: segLabel(s),
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
		dragging = { type: 'boundary', leftSegId, rightSegId };
		dragMoved = false;
		try {
			(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function startRectSelect(e: PointerEvent) {
		e.stopPropagation();
		const time = vp.clientXToTime(e.clientX);
		dragging = { type: 'rect-select', startTime: time, currentTime: time };
		dragMoved = false;
		try {
			(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function startSegClick(e: PointerEvent, segId: string) {
		e.stopPropagation();
		if (e.ctrlKey || e.metaKey) {
			splitAt(vp.clientXToTime(e.clientX));
			return;
		}
		dragging = { type: 'seg-click', segmentId: segId };
		dragMoved = false;
		try {
			(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function startScrollPan(e: PointerEvent) {
		e.stopPropagation();
		const rect = scrollbarEl?.getBoundingClientRect();
		if (!rect) return;
		dragging = {
			type: 'scroll-pan',
			startClientX: e.clientX,
			startViewStart: vp.viewStart,
			scrollWidth: rect.width,
		};
		dragMoved = false;
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function startSeekDrag(e: PointerEvent) {
		if (e.button !== 0) return;
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
		} else if (dragging.type === 'scroll-pan') {
			dragMoved = true;
			const { startClientX, startViewStart, scrollWidth } = dragging;
			const dur = vp.viewEnd - vp.viewStart;
			const delta = ((e.clientX - startClientX) / scrollWidth) * trackDuration;
			const ns = Math.max(
				0,
				Math.min(trackDuration - dur, startViewStart + delta),
			);
			vp.viewStart = ns;
			vp.viewEnd = ns + dur;
		}
	}

	function onPointerUp() {
		if (dragging?.type === 'seg-click' && !dragMoved) {
			const segId = dragging.segmentId;
			selectedSegmentId = selectedSegmentId === segId ? null : segId;
		}
		if (dragging?.type === 'rect-select') {
			if (dragMoved) {
				const minTime = Math.min(dragging.startTime, dragging.currentTime);
				const maxTime = Math.max(dragging.startTime, dragging.currentTime);
				boundaries.setSelectionFromRange(minTime, maxTime);
			} else {
				boundaries.clearSelection();
			}
		}
		dragging = null;
		dragMoved = false;
	}

	// ── Remove ───────────────────────────────────────────────────────────────
	function removeSegment(id: string) {
		const idx = segments.findIndex((s) => s.id === id);
		if (idx === -1) return;
		selectedSegmentId = null;

		if (segments.length === 1) {
			emit([]);
			return;
		}
		// Merge the freed span into a neighbour so coverage stays gapless
		const deleted = segments[idx];
		const neighbour = idx < segments.length - 1 ? segments[idx + 1] : segments[idx - 1];
		const merged: SequenceSegment = {
			...neighbour,
			startTime: Math.min(deleted.startTime, neighbour.startTime),
			endTime: Math.max(
				deleted.endTime ?? trackDuration,
				neighbour.endTime ?? trackDuration,
			),
		};
		emit(
			rawSegments
				.filter((s) => s.id !== id && s.id !== neighbour.id)
				.concat([merged]),
		);
	}

	function mergeBoundary(leftSegId: string | null, rightSegId: string | null) {
		if (!leftSegId || !rightSegId) return;
		const left = rawSegments.find((s) => s.id === leftSegId);
		const right = rawSegments.find((s) => s.id === rightSegId);
		if (!left || !right) return;
		if (selectedSegmentId === rightSegId) selectedSegmentId = leftSegId;
		emit(
			rawSegments
				.filter((s) => s.id !== leftSegId && s.id !== rightSegId)
				.concat([{ ...left, endTime: right.endTime ?? trackDuration }]),
		);
	}

	let hoveredDot: { leftSegId: string | null; rightSegId: string | null } | null =
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
		const t = e.target as HTMLElement;
		if (t.closest('input, textarea, select')) return;

		if (boundaries.onKeydown(e)) {
			e.stopPropagation();
			return;
		}

		if (e.key === 'Escape' && selectedSegmentId) {
			selectedSegmentId = null;
			return;
		}
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		if (hoveredDot) {
			e.preventDefault();
			mergeBoundary(hoveredDot.leftSegId, hoveredDot.rightSegId);
			hoveredDot = null;
			return;
		}
		if (boundaries.deleteSelection()) {
			e.preventDefault();
			return;
		}
		if (selectedSegmentId) {
			e.preventDefault();
			removeSegment(selectedSegmentId);
		}
	}

	let showHint = $derived(segments.length === 0);

	let svgCursor = $derived.by(() => {
		if (boundaries.pasteMode) return 'copy';
		if (!dragging) return onSeek ? 'crosshair' : 'default';
		if (dragging.type === 'rect-select') return 'crosshair';
		if (dragging.type === 'seek') return 'col-resize';
		return 'ew-resize';
	});

	// Boundary times currently inside the in-progress rect-select drag (for live highlighting)
	let rectHoverTimes = $derived.by((): number[] => {
		if (dragging?.type !== 'rect-select' || !dragMoved) return [];
		const minTime = Math.min(dragging.startTime, dragging.currentTime);
		const maxTime = Math.max(dragging.startTime, dragging.currentTime);
		return boundaries.boundaryTimesInRange(minTime, maxTime);
	});
</script>

<svelte:window
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onkeydowncapture={onKeydown}
/>

<div class="tl-container">
	<div class="tl-track">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<svg
			bind:this={svgEl}
			width="100%"
			height={SVG_H}
			class="step-svg"
			style:cursor={svgCursor}
			ondblclick={onDblClick}
			onpointerdown={startSeekDrag}
		>
			<line class="grid-row" x1="0%" y1={LINE_Y} x2="100%" y2={LINE_Y} />

			<!-- Tail lines for uncovered regions -->
			{#if segVis.length > 0}
				{#if segVis[0].startTime > 0.001}
					<line
						class="tail"
						x1="{vp.toPct(0)}%"
						y1={LINE_Y}
						x2="{segVis[0].startX}%"
						y2={LINE_Y}
					/>
				{/if}
				{#if segVis[segVis.length - 1].endTime < trackDuration - 0.001}
					<line
						class="tail"
						x1="{segVis[segVis.length - 1].endX}%"
						y1={LINE_Y}
						x2="{vp.toPct(trackDuration)}%"
						y2={LINE_Y}
					/>
				{/if}
			{/if}

			<!-- Segment hit areas + lines + labels -->
			{#each segVis as sv}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<line
					class="seg-hit"
					x1="{sv.startX}%"
					y1={LINE_Y}
					x2="{sv.endX}%"
					y2={LINE_Y}
					onpointerdown={(e) => startSegClick(e, sv.id)}
				/>
				<line
					class="seg"
					class:sel={selectedSegmentId === sv.id}
					x1="{sv.startX}%"
					y1={LINE_Y}
					x2="{sv.endX}%"
					y2={LINE_Y}
				/>
				{#if sv.endX - sv.startX > 6}
					{@const midX = (sv.startX + sv.endX) / 2}
					{@const lblX = Math.max(sv.startX + 2, Math.min(sv.endX - 2, midX))}
					<text
						class="seg-lbl"
						class:sel={selectedSegmentId === sv.id}
						x="{lblX}%"
						y={LINE_Y + 18}
						text-anchor="middle">{sv.label}</text
					>
				{/if}
			{/each}

			<!-- Fixed anchor dots -->
			{#if segVis.length > 0}
				<circle class="dot-anchor" cx="{vp.toPct(0)}%" cy={LINE_Y} r={DOT_R} />
				<circle
					class="dot-anchor"
					cx="{vp.toPct(trackDuration)}%"
					cy={LINE_Y}
					r={DOT_R}
				/>
			{/if}

			<!-- Interior boundary dots (draggable) + transition markers -->
			{#each segVis as sv, i}
				{#if sv.startTime > 0.001}
					{@const lId = i > 0 ? segVis[i - 1].id : null}
					{#if sv.transitionType !== 'cut'}
						<!-- Lightning zigzag above the boundary: this segment blends in -->
						<path
							class="trans-mark"
							d="M {sv.startX}% {LINE_Y - 13} l 3 4 l -2 0 l 3 4"
						>
							<title
								>{sv.transitionType} transition · {sv.transitionDuration}s</title
							>
						</path>
					{/if}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<circle
						class="dot-hit"
						cx="{sv.startX}%"
						cy={LINE_Y}
						r={14}
						onpointerdown={(e) => startBndDrag(e, lId, sv.id)}
					/>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<circle
						class="dot"
						class:dot-hovered={hoveredDot?.leftSegId === lId &&
							hoveredDot?.rightSegId === sv.id}
						class:dot-selected={boundaries.selectedBoundaryTimes.some(
							(t) => Math.abs(t - sv.startTime) < 0.001,
						) || rectHoverTimes.some((t) => Math.abs(t - sv.startTime) < 0.001)}
						cx="{sv.startX}%"
						cy={LINE_Y}
						r={DOT_R}
						onpointerenter={() =>
							(hoveredDot = { leftSegId: lId, rightSegId: sv.id })}
						onpointerleave={() => (hoveredDot = null)}
						onpointerdown={(e) => startBndDrag(e, lId, sv.id)}
						><title>Drag to move · Delete to merge · Shift-drag to select</title></circle
					>
				{/if}
			{/each}

			{#if showHint}
				<text class="hint" x="50%" y={LINE_Y + 4} text-anchor="middle">
					Double-click to create a segment · click a segment to edit its effects
				</text>
			{/if}

			<!-- Playhead -->
			{#if trackDuration > 0}
				{@const phx = vp.toPct(currentTime)}
				<line class="playhead-line" x1="{phx}%" y1="0" x2="{phx}%" y2={SVG_H} />
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
					height={SVG_H}
					pointer-events="none"
				/>
			{/if}

			<!-- Ghost paste preview (boundary splits) -->
			{#if boundaries.pasteMode && boundaries.clipboard.length > 0}
				{#each boundaries.clipboard as { offset }}
					{@const ghostTime = boundaries.pasteCursorTime + offset}
					{@const gx = vp.toPct(ghostTime)}
					<line class="ghost-split-line" x1="{gx}%" y1="0" x2="{gx}%" y2={SVG_H} />
				{/each}
			{/if}
		</svg>

		{#if vp.isZoomed}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="scrollbar" bind:this={scrollbarEl}>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="scrollbar-thumb"
					style:left="{(vp.viewStart / trackDuration) * 100}%"
					style:width="{Math.max(2, (vp.viewDuration / trackDuration) * 100)}%"
					onpointerdown={startScrollPan}
				></div>
			</div>
		{/if}
	</div>

	<!-- Toolbar row is always rendered so selecting a segment doesn't shift the layout -->
	<div class="seg-toolbar">
		{#if selectedSegment}
			<span class="seg-toolbar-label">SEGMENT</span>
			<select
				class="seg-select"
				value={selectedPresetIndex}
				onmousedown={() => (presetList = loadPresets())}
				onchange={(e) => {
					const idx = Number(e.currentTarget.value);
					const preset = presetList[idx];
					if (preset) onApplyPreset(selectedSegment!.id, preset);
				}}
			>
				<option value={-1} disabled>Preset…</option>
				{#each presetList as p, i}
					<option value={i}>{p.name}</option>
				{/each}
			</select>
			<button
				class="seg-btn"
				title={selectedSegment.mode === 'interval'
					? 'New random seed'
					: 'Random mosh for this segment'}
				onclick={() => onRoll(selectedSegment!.id)}
			>
				<Dices size={12} />
				MOSH
			</button>
			<div class="seg-mode">
				<button
					class="seg-btn"
					class:active={selectedSegment.mode === 'static'}
					onclick={() => onModeChange(selectedSegment!.id, 'static')}
				>
					STATIC
				</button>
				<button
					class="seg-btn"
					class:active={selectedSegment.mode === 'interval'}
					onclick={() => onModeChange(selectedSegment!.id, 'interval')}
				>
					AUTO
				</button>
			</div>
			{#if selectedSegment.mode === 'interval'}
				<select
					class="seg-select"
					value={selectedSegment.intervalSec ?? 0.25}
					onchange={(e) =>
						onModeChange(
							selectedSegment!.id,
							'interval',
							Number(e.currentTarget.value),
						)}
				>
					{#each [0.125, 0.25, 0.5, 1, 2] as sec}
						<option value={sec}>every {sec}s</option>
					{/each}
				</select>
			{/if}
			<span class="seg-toolbar-label">TRANS</span>
			<select
				class="seg-select"
				value={selectedTransitionType}
				title="How this segment blends in from the previous one"
				onchange={(e) =>
					changeTransitionType(e.currentTarget.value as TransitionType)}
			>
				{#each TRANSITION_OPTIONS as o}
					<option value={o.value}>{o.label}</option>
				{/each}
			</select>
			{#if selectedTransitionType !== 'cut' && selectedSegment.transition}
				<select
					class="seg-select"
					value={selectedSegment.transition.durationSec}
					title="Transition duration"
					onchange={(e) =>
						patchTransition({ durationSec: Number(e.currentTarget.value) })}
				>
					{#each [0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.2, 2] as sec}
						<option value={sec}>{sec}s</option>
					{/each}
				</select>
				{#if selectedTransitionMeta.hasDirection}
					<select
						class="seg-select"
						value={selectedSegment.transition.direction ?? 0}
						title="Wipe direction"
						onchange={(e) =>
							patchTransition({ direction: Number(e.currentTarget.value) })}
					>
						<option value={0}>→</option>
						<option value={1}>←</option>
						<option value={2}>↓</option>
						<option value={3}>↑</option>
					</select>
				{/if}
				{#if selectedTransitionMeta.hasDensity}
					<select
						class="seg-select"
						value={selectedSegment.transition.density ?? 1}
						title="Cell size"
						onchange={(e) =>
							patchTransition({ density: Number(e.currentTarget.value) })}
					>
						<option value={0}>coarse</option>
						<option value={1}>med</option>
						<option value={2}>fine</option>
					</select>
				{/if}
				{#if selectedTransitionMeta.hasSeed}
					<button
						class="seg-btn"
						title="Re-roll transition layout"
						onclick={() => patchTransition({ seed: randomSeed() })}
					>
						<Dices size={12} />
					</button>
				{/if}
				{#if selectedSegment.mode === 'interval'}
					<label
						class="seg-check"
						title="Blend at each re-roll tick inside this segment"
					>
						<input
							type="checkbox"
							checked={selectedSegment.transitionOnTick ?? false}
							onchange={(e) =>
								onTransitionChange(
									selectedSegment!.id,
									selectedSegment!.transition ?? null,
									e.currentTarget.checked,
								)}
						/>
						TICKS
					</label>
				{/if}
			{/if}
			{#if onToggleSegmentLoop}
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
				title="Delete segment"
				onclick={() => removeSegment(selectedSegment!.id)}
			>
				<Trash2 size={12} />
			</button>
		{:else}
			<span class="seg-toolbar-hint">
				{segments.length === 0
					? 'Double-click the timeline to create a segment'
					: 'Click a segment to assign a preset or mosh'}
			</span>
		{/if}
	</div>
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

	.grid-row {
		stroke: #1e1e1e;
		stroke-width: 1;
	}

	.tail {
		stroke: #333;
		stroke-width: 1;
		stroke-dasharray: 3 4;
	}

	.seg-hit {
		stroke: transparent;
		stroke-width: 18;
		pointer-events: all;
		cursor: pointer;
	}

	.seg {
		stroke: #b08ad0;
		stroke-width: 2;
		stroke-linecap: round;
		pointer-events: none;
	}

	.seg.sel {
		stroke: #d8b8f8;
		stroke-width: 3;
	}

	.seg-lbl {
		fill: #9a70b8;
		font-size: 11px;
		font-family: monospace;
		pointer-events: none;
		user-select: none;
	}

	.seg-lbl.sel {
		fill: #d8b8f8;
	}

	.dot-anchor {
		fill: #b08ad0;
		stroke: none;
		pointer-events: none;
	}

	.dot-hit {
		fill: transparent;
		stroke: none;
		cursor: ew-resize;
	}

	.dot {
		fill: #111;
		stroke: #b08ad0;
		stroke-width: 1.5;
		cursor: ew-resize;
	}

	.dot:hover,
	.dot-hovered,
	.dot-selected {
		fill: #b08ad0;
	}

	.dot-selected {
		stroke: #d8b8f8;
		stroke-width: 2;
	}

	.dot-hovered {
		stroke: #ff7070;
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

	.scrollbar {
		position: relative;
		height: 5px;
		background: #161616;
		border-top: 1px solid #2a2a2a;
		cursor: default;
	}

	.scrollbar-thumb {
		position: absolute;
		top: 0;
		height: 100%;
		min-width: 8px;
		background: #6a4a8a;
		border-radius: 2px;
		cursor: grab;
	}

	.scrollbar-thumb:hover {
		background: #7a5a9a;
	}

	.scrollbar-thumb:active {
		cursor: grabbing;
		background: #b08ad0;
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
		.tl-track {
			border-radius: 0;
			border-left: none;
			border-right: none;
		}
	}
</style>
