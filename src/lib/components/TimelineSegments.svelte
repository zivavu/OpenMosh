<script lang="ts">
	import type {
		SlideshowConfig,
		BeatSubdivision,
		TimelineSegment,
		ManualSwitchPoint,
	} from '../slideshow/types';

	const MIN_SEGMENT_DURATION = 0.5; // seconds; segments cannot be resized smaller than this

	const SEGMENT_COLORS = [
		'#3a5a8c',
		'#5a3a8c',
		'#8c3a5a',
		'#3a8c5a',
		'#8c7a3a',
		'#3a8c8c',
	];

	const SUBDIVISION_OPTIONS: { value: BeatSubdivision; label: string }[] = [
		{ value: 0.0625, label: '1/16' },
		{ value: 0.125, label: '1/8' },
		{ value: 0.25, label: '1/4' },
		{ value: 0.5, label: '1/2' },
		{ value: 1, label: '1' },
		{ value: 2, label: '2' },
		{ value: 4, label: '4' },
	];

	function subdivisionLabel(s: BeatSubdivision): string {
		return SUBDIVISION_OPTIONS.find((o) => o.value === s)?.label ?? String(s);
	}

	interface Props {
		config: SlideshowConfig;
		trackDuration: number;
		onConfigChange: (config: SlideshowConfig) => void;
		/** Element to align the track width with (the audio timeline track). */
		alignToEl?: HTMLElement;
		/** Selected segment id; bound so parent (e.g. sidebar) can sync. */
		selectedSegmentId?: string | null;
	}

	let { config, trackDuration, onConfigChange, alignToEl, selectedSegmentId = $bindable(null) }: Props = $props();

	// Align track position/width with the audio timeline track
	let alignStyle = $state('');
	$effect(() => {
		if (!alignToEl) return;
		const update = () => {
			const parent = trackEl?.parentElement;
			if (!parent || !alignToEl) return;
			const parentRect = parent.getBoundingClientRect();
			const targetRect = alignToEl.getBoundingClientRect();
			const left = targetRect.left - parentRect.left;
			const width = targetRect.width;
			alignStyle = `margin-left: ${left}px; width: ${width}px`;
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(alignToEl);
		return () => observer.disconnect();
	});

	let segments = $derived([...config.segments].sort((a, b) => a.startTime - b.startTime));
	let manualPoints = $derived(
		[...config.manualSwitchPoints].sort((a, b) => a.time - b.time),
	);

	// Clear selection if the selected segment was removed from config
	$effect(() => {
		if (selectedSegmentId && !config.segments.some((s) => s.id === selectedSegmentId)) {
			selectedSegmentId = null;
		}
	});

	let dragging: {
		type: 'segment-edge'; segmentId: string; side: 'start' | 'end';
	} | {
		type: 'segment-move'; segmentId: string; offsetTime: number;
	} | {
		type: 'manual'; pointId: string;
	} | null = $state(null);
	let trackEl: HTMLDivElement | undefined = $state();

	// Context menu state
	let contextMenu: { x: number; y: number; time: number } | null = $state(null);

	function timeToPercent(time: number): number {
		if (trackDuration <= 0) return 0;
		return (time / trackDuration) * 100;
	}

	function percentToTime(pct: number): number {
		return (pct / 100) * trackDuration;
	}


	function emitConfig(patch: Partial<SlideshowConfig>) {
		onConfigChange({ ...config, ...patch });
	}

	function handleDblClick(e: MouseEvent) {
		if (!trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
		const time = percentToTime(pct);
		contextMenu = { x: e.clientX, y: e.clientY, time };
	}

	function addSegmentAt(time: number) {
		const newSeg: TimelineSegment = {
			id: crypto.randomUUID(),
			startTime: time,
			endTime: trackDuration,
			subdivision: config.subdivision,
		};
		emitConfig({ segments: [...config.segments, newSeg] });
		contextMenu = null;
	}

	function addManualPointAt(time: number) {
		const newPt: ManualSwitchPoint = {
			id: crypto.randomUUID(),
			time,
		};
		emitConfig({ manualSwitchPoints: [...config.manualSwitchPoints, newPt] });
		contextMenu = null;
	}

	function closeContextMenu() {
		contextMenu = null;
	}

	// Track whether pointer moved during a segment pointerdown (to distinguish click vs drag)
	let segmentDidDrag = false;

	function handleSegmentPointerDown(e: PointerEvent, id: string) {
		e.stopPropagation();
		const time = getPointerTime(e);
		const seg = config.segments.find((s) => s.id === id);
		if (!seg) return;
		segmentDidDrag = false;
		dragging = { type: 'segment-move', segmentId: id, offsetTime: time - seg.startTime };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handleSegmentPointerUp(e: PointerEvent, id: string) {
		if (!segmentDidDrag) {
			// It was a click, not a drag — toggle selection
			selectedSegmentId = selectedSegmentId === id ? null : id;
		}
	}

	function startEdgeDrag(e: PointerEvent, segmentId: string, side: 'start' | 'end') {
		e.stopPropagation();
		dragging = { type: 'segment-edge', segmentId, side };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function startManualDrag(e: PointerEvent, pointId: string) {
		e.stopPropagation();
		dragging = { type: 'manual', pointId };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handleManualDblClick(e: MouseEvent, pointId: string) {
		e.stopPropagation();
		emitConfig({
			manualSwitchPoints: config.manualSwitchPoints.filter((p) => p.id !== pointId),
		});
	}

	function getPointerTime(e: PointerEvent | MouseEvent): number {
		if (!trackEl) return 0;
		const rect = trackEl.getBoundingClientRect();
		const pct = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
		return percentToTime(pct);
	}

	function onPointerUp() {
		dragging = null;
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragging || !trackEl) return;
		const currentDrag = dragging;
		const time = getPointerTime(e);

		if (currentDrag.type === 'segment-edge') {
			const sorted = [...config.segments].sort((a, b) => a.startTime - b.startTime);
			const idx = sorted.findIndex((s) => s.id === currentDrag.segmentId);
			if (idx === -1) return;
			const seg = sorted[idx];
			const minLen = MIN_SEGMENT_DURATION;

			if (currentDrag.side === 'start') {
				const prevEnd =
					idx > 0 ? (sorted[idx - 1].endTime ?? trackDuration) : 0;
				const segEnd = seg.endTime ?? trackDuration;
				const maxTime = segEnd - minLen;
				const minTime = Math.min(prevEnd, maxTime);
				const clamped = Math.max(minTime, Math.min(maxTime, time));
				emitConfig({
					segments: config.segments.map((s) =>
						s.id === seg.id ? { ...s, startTime: clamped } : s,
					),
				});
			} else {
				const segStart = seg.startTime;
				const nextStart =
					idx < sorted.length - 1 ? sorted[idx + 1].startTime : trackDuration;
				const minTime = segStart + minLen;
				const maxTime = nextStart;
				const clamped = Math.max(minTime, Math.min(maxTime, time));
				emitConfig({
					segments: config.segments.map((s) =>
						s.id === seg.id ? { ...s, endTime: clamped } : s,
					),
				});
			}
		} else if (dragging.type === 'segment-move') {
			segmentDidDrag = true;
			const { segmentId, offsetTime } = dragging;
			const sorted = [...config.segments].sort((a, b) => a.startTime - b.startTime);
			const sortedIdx = sorted.findIndex((s) => s.id === segmentId);
			if (sortedIdx === -1) return;
			const seg = sorted[sortedIdx];
			const segEnd = seg.endTime ?? trackDuration;
			const duration = segEnd - seg.startTime;
			const newStart = time - offsetTime;
			const minStart = sortedIdx > 0 ? (sorted[sortedIdx - 1].endTime ?? trackDuration) + 0.01 : 0;
			const maxEnd = sortedIdx < sorted.length - 1 ? sorted[sortedIdx + 1].startTime - 0.01 : trackDuration;
			const clampedStart = Math.max(minStart, Math.min(maxEnd - duration, newStart));
			const clampedEnd = clampedStart + duration;
			emitConfig({
				segments: config.segments.map((s) =>
					s.id === segmentId ? { ...s, startTime: clampedStart, endTime: clampedEnd } : s,
				),
			});
		} else {
			const pointId = (dragging as { type: 'manual'; pointId: string }).pointId;
			const clamped = Math.max(0, Math.min(trackDuration, time));
			emitConfig({
				manualSwitchPoints: config.manualSwitchPoints.map((p) =>
					p.id === pointId ? { ...p, time: clamped } : p,
				),
			});
		}
	}

	function removeSegment(id: string) {
		selectedSegmentId = null;
		emitConfig({ segments: config.segments.filter((s) => s.id !== id) });
	}

	function clearAllSegments() {
		selectedSegmentId = null;
		emitConfig({ segments: [] });
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		const target = e.target as HTMLElement;
		if (target.closest('input, textarea, select')) return;
		if (selectedSegmentId) {
			e.preventDefault();
			removeSegment(selectedSegmentId);
		}
	}

	function updateSegmentSubdivision(id: string, sub: BeatSubdivision) {
		emitConfig({
			segments: config.segments.map((s) =>
				s.id === id ? { ...s, subdivision: sub } : s,
			),
		});
	}

	let selectedSegment = $derived(segments.find((s) => s.id === selectedSegmentId) ?? null);

	let showHint = $derived(segments.length === 0 && manualPoints.length === 0);

	/** Unique boundaries (position, left segment, right segment). One handle per boundary; at shared edges we resize the selected segment. */
	let boundaries = $derived.by(() => {
		const list: { pct: number; leftSeg: TimelineSegment | null; rightSeg: TimelineSegment | null }[] = [];
		for (let i = 0; i < segments.length; i++) {
			const seg = segments[i];
			const startPct = timeToPercent(seg.startTime);
			const endTime = Math.min(trackDuration, seg.endTime ?? trackDuration);
			const endPct = timeToPercent(endTime);
			if (i === 0 && seg.startTime > 0) {
				list.push({ pct: startPct, leftSeg: null, rightSeg: seg });
			}
			list.push({
				pct: endPct,
				leftSeg: seg,
				rightSeg: i + 1 < segments.length ? segments[i + 1]! : null,
			});
		}
		// Merge duplicate positions (adjacent segments: same pct for end of i and start of i+1)
		const byPct = new Map<number, { leftSeg: TimelineSegment | null; rightSeg: TimelineSegment | null }>();
		for (const b of list) {
			const existing = byPct.get(b.pct);
			byPct.set(b.pct, {
				leftSeg: existing?.leftSeg ?? b.leftSeg,
				rightSeg: existing?.rightSeg ?? b.rightSeg,
			});
		}
		return Array.from(byPct.entries(), ([pct, { leftSeg, rightSeg }]) => ({ pct, leftSeg, rightSeg }));
	});

	function startBoundaryDrag(e: PointerEvent, leftSeg: TimelineSegment | null, rightSeg: TimelineSegment | null) {
		e.stopPropagation();
		// Prioritize selected segment: if left is selected resize its end; if right is selected resize its start
		if (leftSeg && selectedSegmentId === leftSeg.id) {
			dragging = { type: 'segment-edge', segmentId: leftSeg.id, side: 'end' };
		} else if (rightSeg && selectedSegmentId === rightSeg.id) {
			dragging = { type: 'segment-edge', segmentId: rightSeg.id, side: 'start' };
		} else if (leftSeg) {
			dragging = { type: 'segment-edge', segmentId: leftSeg.id, side: 'end' };
		} else if (rightSeg) {
			dragging = { type: 'segment-edge', segmentId: rightSeg.id, side: 'start' };
		} else {
			return;
		}
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
</script>

<svelte:window
	onpointermove={handlePointerMove}
	onpointerup={onPointerUp}
	onclick={closeContextMenu}
	onkeydown={handleKeydown}
/>

<div class="timeline-segments-container">
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="track"
		bind:this={trackEl}
		style={alignStyle}
		ondblclick={handleDblClick}
	>
		{#if showHint}
			<span class="hint">Double-click to add segments or switch points</span>
		{/if}

		{#each segments as seg, i}
			{@const startPct = timeToPercent(seg.startTime)}
			{@const endTime = Math.min(trackDuration, seg.endTime ?? trackDuration)}
			{@const endPct = timeToPercent(endTime)}
			{@const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length]}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="segment"
				class:selected={selectedSegmentId === seg.id}
				style:left="{startPct}%"
				style:width="{endPct - startPct}%"
				style:background="{color}44"
				onpointerdown={(e) => handleSegmentPointerDown(e, seg.id)}
				onpointerup={(e) => handleSegmentPointerUp(e, seg.id)}
			>
				<span class="segment-label">{subdivisionLabel(seg.subdivision)}</span>
			</div>

		{/each}

		{#each boundaries as b}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="edge-handle"
				style:left="{b.pct}%"
				onpointerdown={(e) => startBoundaryDrag(e, b.leftSeg, b.rightSeg)}
			></div>
		{/each}

		{#each manualPoints as pt}
			{@const pct = timeToPercent(pt.time)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="manual-point"
				style:left="{pct}%"
				onpointerdown={(e) => startManualDrag(e, pt.id)}
				ondblclick={(e) => handleManualDblClick(e, pt.id)}
			></div>
		{/each}
	</div>

	{#if contextMenu}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="context-menu"
			style:left="{contextMenu.x}px"
			style:bottom="{window.innerHeight - contextMenu.y}px"
			onclick={(e) => e.stopPropagation()}
		>
			<button onclick={() => addSegmentAt(contextMenu!.time)}>Add segment</button>
			<button onclick={() => addManualPointAt(contextMenu!.time)}>Add switch point</button>
		</div>
	{/if}

	{#if selectedSegment || segments.length > 0}
		<div class="segment-picker">
			{#if selectedSegment}
				<select
					value={selectedSegment.subdivision}
					onchange={(e) =>
						updateSegmentSubdivision(
							selectedSegment!.id,
							Number((e.target as HTMLSelectElement).value) as BeatSubdivision,
						)}
				>
					{#each SUBDIVISION_OPTIONS as opt}
						<option value={opt.value}>{opt.label} beat</option>
					{/each}
				</select>
				<button class="remove-btn" onclick={() => removeSegment(selectedSegment!.id)} title="Remove segment (Delete)">
					Remove
				</button>
			{/if}
			{#if segments.length > 0}
				<button
					class="clear-all-btn"
					onclick={clearAllSegments}
					title="Clear all segments"
				>
					Clear all
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.timeline-segments-container {
		margin: 0 0.5rem;
	}

	.track {
		position: relative;
		height: 24px;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 3px;
		overflow: hidden;
	}

	.hint {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #666;
		font-size: 0.7rem;
		pointer-events: none;
		user-select: none;
	}

	.segment {
		position: absolute;
		top: 0;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: grab;
		box-sizing: border-box;
	}

	.segment.selected {
		outline: 1px solid #e0e0e0;
		outline-offset: -1px;
	}

	.segment-label {
		font-size: 0.65rem;
		color: #e0e0e0;
		pointer-events: none;
		user-select: none;
	}

	.edge-handle {
		position: absolute;
		top: 0;
		width: 8px;
		height: 100%;
		transform: translateX(-50%);
		cursor: col-resize;
		z-index: 2;
		background: transparent;
	}

	.edge-handle:hover,
	.edge-handle:active {
		background: rgba(255, 255, 255, 0.2);
	}

	.manual-point {
		position: absolute;
		top: 0;
		width: 3px;
		height: 100%;
		background: #ff6b6b;
		transform: translateX(-50%);
		cursor: grab;
		z-index: 3;
	}

	.manual-point:hover {
		width: 5px;
		background: #ff8888;
	}

	.segment-picker {
		display: flex;
		flex-direction: row;
		gap: 0.5rem;
		margin: 0.25rem 0.5rem;
		font-size: 0.72rem;
		align-items: center;
	}

	.segment-picker select {
		background: #1a1a1a;
		color: #e0e0e0;
		border: 1px solid #333;
		border-radius: 3px;
		padding: 0.15rem 0.3rem;
		font-size: 0.72rem;
	}

	.remove-btn {
		background: none;
		border: none;
		color: #ff6b6b;
		cursor: pointer;
		font-size: 0.72rem;
		padding: 0.15rem 0.3rem;
	}

	.remove-btn:hover {
		color: #ff8888;
	}

	.clear-all-btn {
		background: none;
		border: 1px solid #444;
		color: #999;
		cursor: pointer;
		font-size: 0.72rem;
		padding: 0.15rem 0.3rem;
		border-radius: 3px;
		margin-left: auto;
	}

	.clear-all-btn:hover {
		border-color: #666;
		color: #ccc;
	}

	.context-menu {
		position: fixed;
		z-index: 100;
		background: #252525;
		border: 1px solid #444;
		border-radius: 4px;
		padding: 0.2rem 0;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
		min-width: 140px;
	}

	.context-menu button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		color: #e0e0e0;
		padding: 0.35rem 0.75rem;
		font-size: 0.75rem;
		cursor: pointer;
		font-family: inherit;
	}

	.context-menu button:hover {
		background: #3a3a3a;
	}
</style>
