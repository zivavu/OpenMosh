<script lang="ts">
	import { Dices, Trash2 } from 'lucide-svelte';
	import { loadPresets, type Preset } from '../../effects';
	import {
		cloneSegmentForSplit,
		createSequenceSegment,
		type SequenceSegment,
		type SequenceSegmentMode,
	} from '../../editor/sequence';

	const MIN_SEGMENT_DURATION = 0.125;
	const SVG_H = 48;
	const LINE_Y = 18;
	const DOT_R = 4;
	const MIN_ZOOM_FRACTION = 1 / 200;

	interface Props {
		segments: SequenceSegment[];
		trackDuration: number;
		onSegmentsChange: (segments: SequenceSegment[]) => void;
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
	}

	let {
		segments: rawSegments,
		trackDuration,
		onSegmentsChange,
		selectedSegmentId = $bindable(null),
		currentTime = 0,
		onSeek,
		onApplyPreset,
		onRoll,
		onModeChange,
	}: Props = $props();

	let svgEl: SVGSVGElement | undefined = $state();
	let scrollbarEl: HTMLDivElement | undefined = $state();

	// ── View window (zoom / pan) ─────────────────────────────────────────────
	let viewStart = $state(0);
	let viewEnd = $state(0);
	let viewDuration = $derived(Math.max(0.001, viewEnd - viewStart));
	let isZoomed = $derived(
		trackDuration > 0 && (viewStart > 0.001 || viewEnd < trackDuration - 0.001),
	);

	$effect(() => {
		const td = trackDuration;
		if (td > 0 && (viewEnd <= 0 || viewEnd > td)) viewEnd = td;
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
		| null;

	let dragging: DragState = $state(null);
	let dragMoved = $state(false);

	// ── Helpers ──────────────────────────────────────────────────────────────
	function emit(segs: SequenceSegment[]) {
		onSegmentsChange(segs);
	}

	function getRect(): DOMRect | null {
		return svgEl?.getBoundingClientRect() ?? null;
	}

	function clientXToTime(cx: number): number {
		const r = getRect();
		if (!r || viewDuration <= 0) return 0;
		const frac = Math.max(0, Math.min(1, (cx - r.left) / r.width));
		return viewStart + frac * viewDuration;
	}

	function toPct(time: number): number {
		if (viewDuration <= 0) return 0;
		return ((time - viewStart) / viewDuration) * 100;
	}

	// ── Zoom / pan ───────────────────────────────────────────────────────────
	function panView(delta: number) {
		const dur = viewEnd - viewStart;
		let ns = viewStart + delta;
		let ne = ns + dur;
		if (ns < 0) {
			ne -= ns;
			ns = 0;
		}
		if (ne > trackDuration) {
			ns -= ne - trackDuration;
			ne = trackDuration;
		}
		viewStart = Math.max(0, ns);
		viewEnd = Math.min(trackDuration, ne);
	}

	function zoomView(factor: number, cursorFrac: number) {
		const minDur = Math.max(trackDuration * MIN_ZOOM_FRACTION, 0.1);
		const curDur = viewEnd - viewStart;
		const newDur = Math.max(minDur, Math.min(trackDuration, curDur * factor));
		const cursorTime = viewStart + cursorFrac * curDur;
		let ns = cursorTime - cursorFrac * newDur;
		let ne = ns + newDur;
		if (ns < 0) {
			ne -= ns;
			ns = 0;
		}
		if (ne > trackDuration) {
			ns -= ne - trackDuration;
			ne = trackDuration;
		}
		viewStart = Math.max(0, ns);
		viewEnd = Math.min(trackDuration, ne);
	}

	$effect(() => {
		if (!svgEl) return;
		function handleWheel(e: WheelEvent) {
			e.preventDefault();
			e.stopPropagation();
			if (trackDuration <= 0) return;
			const r = svgEl!.getBoundingClientRect();
			const cursorFrac = Math.max(
				0,
				Math.min(1, (e.clientX - r.left) / r.width),
			);
			if (e.shiftKey) {
				panView(viewDuration * 0.25 * Math.sign(e.deltaY));
			} else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
				panView((e.deltaX / 200) * viewDuration);
			} else {
				zoomView(e.deltaY > 0 ? 1.2 : 1 / 1.2, cursorFrac);
			}
		}
		svgEl.addEventListener('wheel', handleWheel, { passive: false });
		return () => svgEl!.removeEventListener('wheel', handleWheel);
	});

	// ── Derived visuals ──────────────────────────────────────────────────────
	interface SegVis {
		id: string;
		startX: number;
		endX: number;
		startTime: number;
		endTime: number;
		label: string;
	}

	function segLabel(s: SequenceSegment): string {
		if (s.mode === 'interval') return `auto ${s.intervalSec ?? 0.25}s`;
		return s.label;
	}

	let segVis = $derived.by((): SegVis[] =>
		segments.map((s) => {
			const endTime = Math.min(trackDuration, s.endTime ?? trackDuration);
			return {
				id: s.id,
				startX: toPct(s.startTime),
				endX: toPct(endTime),
				startTime: s.startTime,
				endTime,
				label: segLabel(s),
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
		emit(
			rawSegments
				.filter((s) => s.id !== hit.id)
				.concat([
					cloneSegmentForSplit(hit, hit.startTime, time),
					cloneSegmentForSplit(hit, time, end),
				]),
		);
	}

	function onDblClick(e: MouseEvent) {
		splitAt(clientXToTime(e.clientX));
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

	function startSegClick(e: PointerEvent, segId: string) {
		e.stopPropagation();
		if (e.ctrlKey || e.metaKey) {
			splitAt(clientXToTime(e.clientX));
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
			startViewStart: viewStart,
			scrollWidth: rect.width,
		};
		dragMoved = false;
		try {
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function startSeekDrag(e: PointerEvent) {
		if (e.button !== 0) return;
		if (e.ctrlKey || e.metaKey) {
			splitAt(clientXToTime(e.clientX));
			return;
		}
		if (!onSeek) return;
		const time = Math.max(0, Math.min(trackDuration, clientXToTime(e.clientX)));
		onSeek(time);
		dragging = { type: 'seek' };
		dragMoved = false;
		try {
			(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
		} catch {}
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;

		if (dragging.type === 'boundary') {
			dragMoved = true;
			const time = clientXToTime(e.clientX);
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
				emit(
					rawSegments.map((s) =>
						updates[s.id] ? { ...s, ...updates[s.id] } : s,
					),
				);
			}
		} else if (dragging.type === 'seek') {
			dragMoved = true;
			const time = Math.max(
				0,
				Math.min(trackDuration, clientXToTime(e.clientX)),
			);
			onSeek?.(time);
		} else if (dragging.type === 'scroll-pan') {
			dragMoved = true;
			const { startClientX, startViewStart, scrollWidth } = dragging;
			const dur = viewEnd - viewStart;
			const delta = ((e.clientX - startClientX) / scrollWidth) * trackDuration;
			const ns = Math.max(
				0,
				Math.min(trackDuration - dur, startViewStart + delta),
			);
			viewStart = ns;
			viewEnd = ns + dur;
		}
	}

	function onPointerUp() {
		if (dragging?.type === 'seg-click' && !dragMoved) {
			const segId = dragging.segmentId;
			selectedSegmentId = selectedSegmentId === segId ? null : segId;
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

	function onKeydown(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (t.closest('input, textarea, select')) return;
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
		if (selectedSegmentId) {
			e.preventDefault();
			removeSegment(selectedSegmentId);
		}
	}

	let showHint = $derived(segments.length === 0);

	let svgCursor = $derived.by(() => {
		if (!dragging) return onSeek ? 'crosshair' : 'default';
		if (dragging.type === 'seek') return 'col-resize';
		return 'ew-resize';
	});
</script>

<svelte:window
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onkeydown={onKeydown}
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
						x1="{toPct(0)}%"
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
						x2="{toPct(trackDuration)}%"
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
				<circle class="dot-anchor" cx="{toPct(0)}%" cy={LINE_Y} r={DOT_R} />
				<circle
					class="dot-anchor"
					cx="{toPct(trackDuration)}%"
					cy={LINE_Y}
					r={DOT_R}
				/>
			{/if}

			<!-- Interior boundary dots (draggable) -->
			{#each segVis as sv, i}
				{#if sv.startTime > 0.001}
					{@const lId = i > 0 ? segVis[i - 1].id : null}
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
						cx="{sv.startX}%"
						cy={LINE_Y}
						r={DOT_R}
						onpointerenter={() =>
							(hoveredDot = { leftSegId: lId, rightSegId: sv.id })}
						onpointerleave={() => (hoveredDot = null)}
						onpointerdown={(e) => startBndDrag(e, lId, sv.id)}
						><title>Drag to move · Delete to merge</title></circle
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
				{@const phx = toPct(currentTime)}
				<line class="playhead-line" x1="{phx}%" y1="0" x2="{phx}%" y2={SVG_H} />
				<circle class="playhead-head" cx="{phx}%" cy="1" r="3" />
			{/if}
		</svg>

		{#if isZoomed}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="scrollbar" bind:this={scrollbarEl}>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="scrollbar-thumb"
					style:left="{(viewStart / trackDuration) * 100}%"
					style:width="{Math.max(2, (viewDuration / trackDuration) * 100)}%"
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
				value={-1}
				onmousedown={() => (presetList = loadPresets())}
				onchange={(e) => {
					const idx = Number(e.currentTarget.value);
					const preset = presetList[idx];
					if (preset) onApplyPreset(selectedSegment!.id, preset);
					e.currentTarget.value = '-1';
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
	.dot-hovered {
		fill: #b08ad0;
	}

	.dot-hovered {
		stroke: #ff7070;
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
		padding: 0.35rem 0.25rem 0;
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
