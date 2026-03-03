<script lang="ts">
	import type {
		SlideshowConfig,
		BeatSubdivision,
		TimelineSegment,
		ManualSwitchPoint,
	} from '../slideshow/types';

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
	}

	let { config, trackDuration, onConfigChange }: Props = $props();

	let segments = $derived([...config.segments].sort((a, b) => a.startTime - b.startTime));
	let manualPoints = $derived(
		[...config.manualSwitchPoints].sort((a, b) => a.time - b.time),
	);

	let selectedSegmentId: string | null = $state(null);
	let dragging: {
		type: 'segment-edge'; segmentIndex: number;
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

	function startEdgeDrag(e: PointerEvent, segmentIndex: number) {
		e.stopPropagation();
		dragging = { type: 'segment-edge', segmentIndex };
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
		const time = getPointerTime(e);

		if (dragging.type === 'segment-edge') {
			const idx = dragging.segmentIndex;
			const sorted = [...config.segments].sort((a, b) => a.startTime - b.startTime);
			const seg = sorted[idx];
			if (!seg) return;
			const minTime = idx > 0 ? sorted[idx - 1].startTime + 0.01 : 0;
			const maxTime = idx < sorted.length - 1 ? sorted[idx + 1].startTime - 0.01 : trackDuration;
			const clamped = Math.max(minTime, Math.min(maxTime, time));
			emitConfig({
				segments: config.segments.map((s) =>
					s.id === seg.id ? { ...s, startTime: clamped } : s,
				),
			});
		} else if (dragging.type === 'segment-move') {
			segmentDidDrag = true;
			const { segmentId, offsetTime } = dragging;
			const sorted = [...config.segments].sort((a, b) => a.startTime - b.startTime);
			const sortedIdx = sorted.findIndex((s) => s.id === segmentId);
			if (sortedIdx === -1) return;
			const newStart = time - offsetTime;
			const minTime = sortedIdx > 0 ? sorted[sortedIdx - 1].startTime + 0.01 : 0;
			const maxTime = sortedIdx < sorted.length - 1 ? sorted[sortedIdx + 1].startTime - 0.01 : trackDuration;
			const clamped = Math.max(minTime, Math.min(maxTime, newStart));
			emitConfig({
				segments: config.segments.map((s) =>
					s.id === segmentId ? { ...s, startTime: clamped } : s,
				),
			});
		} else {
			const pointId = dragging.pointId;
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

	function updateSegmentSubdivision(id: string, sub: BeatSubdivision) {
		emitConfig({
			segments: config.segments.map((s) =>
				s.id === id ? { ...s, subdivision: sub } : s,
			),
		});
	}

	let selectedSegment = $derived(segments.find((s) => s.id === selectedSegmentId) ?? null);

	let showHint = $derived(segments.length === 0 && manualPoints.length === 0);
</script>

<svelte:window
	onpointermove={handlePointerMove}
	onpointerup={onPointerUp}
	onclick={closeContextMenu}
/>

<div class="timeline-segments-container">
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="track"
		bind:this={trackEl}
		ondblclick={handleDblClick}
	>
		{#if showHint}
			<span class="hint">Double-click to add segments or switch points</span>
		{/if}

		{#each segments as seg, i}
			{@const startPct = timeToPercent(seg.startTime)}
			{@const endPct = i < segments.length - 1 ? timeToPercent(segments[i + 1].startTime) : 100}
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

			{#if seg.startTime > 0}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="edge-handle"
					style:left="{startPct}%"
					onpointerdown={(e) => startEdgeDrag(e, i)}
				></div>
			{/if}
			{#if i < segments.length - 1}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="edge-handle"
					style:left="{endPct}%"
					onpointerdown={(e) => startEdgeDrag(e, i + 1)}
				></div>
			{/if}
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

	{#if selectedSegment}
		<div class="segment-picker">
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
			<button class="remove-btn" onclick={() => removeSegment(selectedSegment!.id)}>
				Remove
			</button>
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
