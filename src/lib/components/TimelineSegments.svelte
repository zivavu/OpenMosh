<script lang="ts">
	import type {
		BeatSubdivision,
		SlideshowConfig,
		TimelineSegment,
	} from '../slideshow/types';

	const MIN_SEGMENT_DURATION = 0.25;

	// Ordered top→bottom: fast (1/32) to slow (4) — lower = higher beat value
	const SUBDIVISIONS: BeatSubdivision[] = [0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4];
	const SUBLABELS = ['¹⁄₃₂', '¹⁄₁₆', '⅛', '¼', '½', '1', '2', '4'];

	const SVG_H = 76;
	const PAD_V = 10;
	const ROW_H = (SVG_H - PAD_V * 2) / (SUBDIVISIONS.length - 1);
	const DOT_R = 4;
	const DRAG_THRESHOLD_PX = 5;
	const MIN_ZOOM_FRACTION = 1 / 200; // 200× max zoom

	function subToY(sub: BeatSubdivision): number {
		const idx = SUBDIVISIONS.indexOf(sub);
		return PAD_V + (idx === -1 ? 2 : idx) * ROW_H;
	}

	function yToSub(svgY: number): BeatSubdivision {
		const idx = Math.round((svgY - PAD_V) / ROW_H);
		return SUBDIVISIONS[Math.max(0, Math.min(SUBDIVISIONS.length - 1, idx))];
	}

	function subLabel(sub: BeatSubdivision): string {
		const idx = SUBDIVISIONS.indexOf(sub);
		return SUBLABELS[idx] ?? String(sub);
	}

	interface Props {
		config: SlideshowConfig;
		trackDuration: number;
		onConfigChange: (config: SlideshowConfig) => void;
		/** Element to align the track width with (the audio timeline track). */
		alignToEl?: HTMLElement;
		/** Selected segment id; bound so parent can sync. */
		selectedSegmentId?: string | null;
		/** Current audio playback position in seconds. */
		currentTime?: number;
		/** Called when the user seeks by clicking/dragging the timeline. */
		onSeek?: (time: number) => void;
	}

	let {
		config,
		trackDuration,
		onConfigChange,
		alignToEl,
		selectedSegmentId = $bindable(null),
		currentTime = 0,
		onSeek,
	}: Props = $props();

	let alignStyle = $state('');
	let wrapperEl: HTMLDivElement | undefined = $state();
	let svgEl: SVGSVGElement | undefined = $state();
	let scrollbarEl: HTMLDivElement | undefined = $state();

	// ── View window (zoom / pan) ─────────────────────────────────────────────────
	let viewStart = $state(0);
	let viewEnd = $state(0); // initialised by effect below
	let viewDuration = $derived(Math.max(0.001, viewEnd - viewStart));
	let isZoomed = $derived(
		trackDuration > 0 &&
			(viewStart > 0.001 || viewEnd < trackDuration - 0.001),
	);

	// Initialise / clamp viewEnd when trackDuration changes (e.g. audio loaded)
	$effect(() => {
		const td = trackDuration;
		if (td > 0 && (viewEnd <= 0 || viewEnd > td)) viewEnd = td;
	});

	// ── Alignment with audio timeline ────────────────────────────────────────────
	$effect(() => {
		if (!alignToEl) return;
		const update = () => {
			const parent = wrapperEl?.parentElement;
			if (!parent || !alignToEl) return;
			const pr = parent.getBoundingClientRect();
			const tr = alignToEl.getBoundingClientRect();
			alignStyle = `margin-left: ${tr.left - pr.left}px; width: ${tr.width}px`;
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(alignToEl);
		return () => ro.disconnect();
	});

	let segments = $derived(
		[...config.segments].sort((a, b) => a.startTime - b.startTime),
	);
	let manualPoints = $derived(
		[...config.manualSwitchPoints].sort((a, b) => a.time - b.time),
	);

	$effect(() => {
		if (
			selectedSegmentId &&
			!config.segments.some((s) => s.id === selectedSegmentId)
		) {
			selectedSegmentId = null;
		}
	});

	// ── Drag state ───────────────────────────────────────────────────────────────
	type DragState =
		| { type: 'boundary'; leftSegId: string | null; rightSegId: string | null }
		| {
				type: 'seg-y';
				segmentId: string;
				snapSub: BeatSubdivision;
				startClientY: number;
		  }
		| { type: 'manual'; pointId: string }
		| {
				type: 'scroll-pan';
				startClientX: number;
				startViewStart: number;
				scrollWidth: number;
		  }
		| { type: 'seek' }
		| null;

	let dragging: DragState = $state(null);
	let dragMoved = $state(false);

	// Tracks which interior boundary dot the pointer is currently over
	let hoveredDot: { leftSegId: string | null; rightSegId: string | null } | null =
		$state(null);

	// ── Helpers ──────────────────────────────────────────────────────────────────
	function emit(patch: Partial<SlideshowConfig>) {
		onConfigChange({ ...config, ...patch });
	}

	function getRect(): DOMRect | null {
		return svgEl?.getBoundingClientRect() ?? null;
	}

	/** Convert clientX to absolute track time via the current view window. */
	function clientXToTime(cx: number): number {
		const r = getRect();
		if (!r || viewDuration <= 0) return 0;
		const frac = Math.max(0, Math.min(1, (cx - r.left) / r.width));
		return viewStart + frac * viewDuration;
	}

	function clientYToSvgY(cy: number): number {
		const r = getRect();
		if (!r || r.height === 0) return SVG_H / 2;
		return ((cy - r.top) / r.height) * SVG_H;
	}

	/** Convert absolute track time to a view-relative percentage (can be <0 or >100). */
	function toPct(time: number): number {
		if (viewDuration <= 0) return 0;
		return ((time - viewStart) / viewDuration) * 100;
	}

	// ── Zoom / pan ───────────────────────────────────────────────────────────────
	function panView(delta: number) {
		const dur = viewEnd - viewStart;
		let ns = viewStart + delta;
		let ne = ns + dur;
		if (ns < 0) { ne -= ns; ns = 0; }
		if (ne > trackDuration) { ns -= ne - trackDuration; ne = trackDuration; }
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
		if (ns < 0) { ne -= ns; ns = 0; }
		if (ne > trackDuration) { ns -= ne - trackDuration; ne = trackDuration; }
		viewStart = Math.max(0, ns);
		viewEnd = Math.min(trackDuration, ne);
	}

	// Attach wheel handler with { passive: false } so we can call preventDefault
	$effect(() => {
		if (!svgEl) return;
		function handleWheel(e: WheelEvent) {
			e.preventDefault();
			e.stopPropagation();
			if (trackDuration <= 0) return;
			const r = svgEl!.getBoundingClientRect();
			const cursorFrac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
			if (e.shiftKey) {
				// Shift + scroll → pan
				panView(viewDuration * 0.25 * Math.sign(e.deltaY));
			} else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
				// Horizontal trackpad swipe → pan
				panView((e.deltaX / 200) * viewDuration);
			} else {
				// Vertical scroll → zoom centred on cursor
				zoomView(e.deltaY > 0 ? 1.2 : 1 / 1.2, cursorFrac);
			}
		}
		svgEl.addEventListener('wheel', handleWheel, { passive: false });
		return () => svgEl!.removeEventListener('wheel', handleWheel);
	});

	// ── Derived visuals ──────────────────────────────────────────────────────────
	interface SegVis {
		id: string;
		startX: number;    // view-relative %
		endX: number;      // view-relative %
		y: number;         // svg-px
		sub: BeatSubdivision;
		startTime: number; // absolute track time
		endTime: number;   // absolute track time
	}

	let segVis = $derived.by((): SegVis[] =>
		segments.map((s) => {
			const activeSub =
				dragging?.type === 'seg-y' && dragging.segmentId === s.id
					? dragging.snapSub
					: s.subdivision;
			const endTime = Math.min(trackDuration, s.endTime ?? trackDuration);
			return {
				id: s.id,
				startX: toPct(s.startTime),
				endX: toPct(endTime),
				y: subToY(activeSub),
				sub: activeSub,
				startTime: s.startTime,
				endTime,
			};
		}),
	);

	interface Connector {
		xPct: number;
		y1: number;
		y2: number;
		leftSegId: string;
		rightSegId: string;
	}

	let connectors = $derived.by((): Connector[] => {
		const list: Connector[] = [];
		for (let i = 0; i < segments.length - 1; i++) {
			const lend = segments[i].endTime ?? trackDuration;
			if (Math.abs(lend - segments[i + 1].startTime) < 0.001) {
				const lv = segVis[i];
				const rv = segVis[i + 1];
				list.push({
					xPct: toPct(lend),
					y1: Math.min(lv.y, rv.y),
					y2: Math.max(lv.y, rv.y),
					leftSegId: segments[i].id,
					rightSegId: segments[i + 1].id,
				});
			}
		}
		return list;
	});

	// Y of the fixed anchor dots (always at time=0 and time=trackDuration)
	let anchorStartY = $derived(
		segVis.length > 0 ? segVis[0].y : subToY(config.subdivision),
	);
	let anchorEndY = $derived(
		segVis.length > 0 ? segVis[segVis.length - 1].y : subToY(config.subdivision),
	);

	// ── Event handlers ───────────────────────────────────────────────────────────
	function onDblClick(e: MouseEvent) {
		if (trackDuration <= 0) return;
		const time = clientXToTime(e.clientX);
		const svgY = clientYToSvgY(e.clientY);

		if (config.segments.length === 0) {
			emit({
				segments: [
					{
						id: crypto.randomUUID(),
						startTime: 0,
						endTime: trackDuration,
						subdivision: yToSub(svgY),
					},
				],
			});
			return;
		}

		const sorted = [...config.segments].sort((a, b) => a.startTime - b.startTime);
		const hit = sorted.find((s) => {
			const end = s.endTime ?? trackDuration;
			return time > s.startTime + 0.01 && time < end - 0.01;
		});
		if (!hit) return;

		const end = hit.endTime ?? trackDuration;
		emit({
			segments: config.segments
				.filter((s) => s.id !== hit.id)
				.concat([
					{
						id: crypto.randomUUID(),
						startTime: hit.startTime,
						endTime: time,
						subdivision: hit.subdivision,
					},
					{
						id: crypto.randomUUID(),
						startTime: time,
						endTime: end,
						subdivision: hit.subdivision,
					},
				]),
		});
	}

	function startBndDrag(
		e: PointerEvent,
		leftSegId: string | null,
		rightSegId: string | null,
	) {
		e.stopPropagation();
		dragging = { type: 'boundary', leftSegId, rightSegId };
		dragMoved = false;
		(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
	}

	function startSegYDrag(e: PointerEvent, segId: string) {
		e.stopPropagation();
		const seg = config.segments.find((s) => s.id === segId);
		if (!seg) return;
		dragging = {
			type: 'seg-y',
			segmentId: segId,
			snapSub: seg.subdivision,
			startClientY: e.clientY,
		};
		dragMoved = false;
		(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
	}

	function startManDrag(e: PointerEvent, pointId: string) {
		e.stopPropagation();
		dragging = { type: 'manual', pointId };
		dragMoved = false;
		(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
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
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function startSeekDrag(e: PointerEvent) {
		if (e.button !== 0 || !onSeek) return;
		const time = Math.max(0, Math.min(trackDuration, clientXToTime(e.clientX)));
		onSeek(time);
		dragging = { type: 'seek' };
		dragMoved = false;
		(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
	}

	function onManualDblClick(e: MouseEvent, pointId: string) {
		e.stopPropagation();
		emit({
			manualSwitchPoints: config.manualSwitchPoints.filter(
				(p) => p.id !== pointId,
			),
		});
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;

		if (dragging.type === 'boundary') {
			dragMoved = true;
			const time = clientXToTime(e.clientX);
			const { leftSegId, rightSegId } = dragging;
			const updates: Record<string, Partial<TimelineSegment>> = {};

			if (leftSegId) {
				const lseg = config.segments.find((s) => s.id === leftSegId);
				if (lseg) {
					const minEnd = lseg.startTime + MIN_SEGMENT_DURATION;
					const maxEnd = rightSegId
						? (config.segments.find((s) => s.id === rightSegId)?.endTime ??
								trackDuration) - MIN_SEGMENT_DURATION
						: trackDuration;
					const clamped = Math.max(minEnd, Math.min(maxEnd, time));
					updates[leftSegId] = { endTime: clamped };
					if (rightSegId) updates[rightSegId] = { startTime: clamped };
				}
			} else if (rightSegId) {
				const rseg = config.segments.find((s) => s.id === rightSegId);
				if (rseg) {
					const maxStart =
						(rseg.endTime ?? trackDuration) - MIN_SEGMENT_DURATION;
					const clamped = Math.max(0, Math.min(maxStart, time));
					updates[rightSegId] = { startTime: clamped };
				}
			}

			if (Object.keys(updates).length > 0) {
				emit({
					segments: config.segments.map((s) =>
						updates[s.id] ? { ...s, ...updates[s.id] } : s,
					),
				});
			}
		} else if (dragging.type === 'seg-y') {
			if (Math.abs(e.clientY - dragging.startClientY) > DRAG_THRESHOLD_PX) {
				dragMoved = true;
				const snap = yToSub(clientYToSvgY(e.clientY));
				if (snap !== dragging.snapSub) {
					dragging = { ...dragging, snapSub: snap };
				}
			}
		} else if (dragging.type === 'manual') {
			dragMoved = true;
			const time = Math.max(
				0,
				Math.min(trackDuration, clientXToTime(e.clientX)),
			);
			emit({
				manualSwitchPoints: config.manualSwitchPoints.map((p) =>
					p.id === (dragging as { type: 'manual'; pointId: string }).pointId
						? { ...p, time }
						: p,
				),
			});
		} else if (dragging.type === 'seek') {
			dragMoved = true;
			const time = Math.max(0, Math.min(trackDuration, clientXToTime(e.clientX)));
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
		if (dragging?.type === 'seg-y') {
			if (!dragMoved) {
				const segId = dragging.segmentId;
				selectedSegmentId = selectedSegmentId === segId ? null : segId;
			} else {
				const { segmentId, snapSub } = dragging;
				emit({
					segments: config.segments.map((s) =>
						s.id === segmentId ? { ...s, subdivision: snapSub } : s,
					),
				});
			}
		}
		dragging = null;
		dragMoved = false;
	}

	function removeSegment(id: string) {
		const sorted = [...config.segments].sort((a, b) => a.startTime - b.startTime);
		const idx = sorted.findIndex((s) => s.id === id);
		if (idx === -1) return;

		if (sorted.length === 1) {
			selectedSegmentId = null;
			emit({ segments: [] });
			return;
		}

		const deleted = sorted[idx];
		const neighbour = idx < sorted.length - 1 ? sorted[idx + 1] : sorted[idx - 1];
		const merged: TimelineSegment = {
			...neighbour,
			startTime: Math.min(deleted.startTime, neighbour.startTime),
			endTime: Math.max(
				deleted.endTime ?? trackDuration,
				neighbour.endTime ?? trackDuration,
			),
		};

		selectedSegmentId = null;
		emit({
			segments: config.segments
				.filter((s) => s.id !== id && s.id !== neighbour.id)
				.concat([merged]),
		});
	}

	function clearAll() {
		selectedSegmentId = null;
		emit({ segments: [] });
	}

	/** Remove the boundary between two adjacent segments by merging them into one. */
	function mergeDot(leftSegId: string | null, rightSegId: string | null) {
		if (!leftSegId || !rightSegId) return;
		const left = config.segments.find((s) => s.id === leftSegId);
		const right = config.segments.find((s) => s.id === rightSegId);
		if (!left || !right) return;
		const merged: TimelineSegment = {
			...left,
			id: crypto.randomUUID(),
			startTime: left.startTime,
			endTime: right.endTime ?? trackDuration,
		};
		hoveredDot = null;
		if (selectedSegmentId === leftSegId || selectedSegmentId === rightSegId) {
			selectedSegmentId = null;
		}
		emit({
			segments: config.segments
				.filter((s) => s.id !== leftSegId && s.id !== rightSegId)
				.concat([merged]),
		});
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		const t = e.target as HTMLElement;
		if (t.closest('input, textarea, select')) return;
		if (hoveredDot) {
			e.preventDefault();
			mergeDot(hoveredDot.leftSegId, hoveredDot.rightSegId);
			return;
		}
		if (selectedSegmentId) {
			e.preventDefault();
			removeSegment(selectedSegmentId);
		}
	}

	let selectedSeg = $derived(segments.find((s) => s.id === selectedSegmentId) ?? null);
	let showHint = $derived(segments.length === 0 && manualPoints.length === 0);

	let svgCursor = $derived.by(() => {
		const d = dragging;
		if (!d) return onSeek ? 'crosshair' : 'default';
		if (d.type === 'seg-y') return 'ns-resize';
		if (d.type === 'seek') return 'col-resize';
		return 'ew-resize';
	});
</script>

<svelte:window
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onkeydown={onKeydown}
/>

<div class="tl-container">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="tl-track" bind:this={wrapperEl} style={alignStyle}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
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
			<!-- Subtle grid rows -->
			{#each SUBDIVISIONS as sub}
				{@const y = subToY(sub)}
				<line class="grid-row" x1="0%" y1={y} x2="100%" y2={y} />
			{/each}

			<!-- Tail lines for uncovered regions -->
			{#if segVis.length > 0}
				{#if segVis[0].startTime > 0.001}
					<line
						class="tail"
						x1="{toPct(0)}%"
						y1={segVis[0].y}
						x2="{segVis[0].startX}%"
						y2={segVis[0].y}
					/>
				{/if}
				{#if segVis[segVis.length - 1].endTime < trackDuration - 0.001}
					<line
						class="tail"
						x1="{segVis[segVis.length - 1].endX}%"
						y1={segVis[segVis.length - 1].y}
						x2="{toPct(trackDuration)}%"
						y2={segVis[segVis.length - 1].y}
					/>
				{/if}
			{:else}
				<line
					class="tail"
					x1="{toPct(0)}%"
					y1={subToY(config.subdivision)}
					x2="{toPct(trackDuration)}%"
					y2={subToY(config.subdivision)}
				/>
			{/if}

			<!-- Segment hit areas -->
			{#each segVis as sv}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<line
					class="seg-hit"
					x1="{sv.startX}%"
					y1={sv.y}
					x2="{sv.endX}%"
					y2={sv.y}
					onpointerdown={(e) => startSegYDrag(e, sv.id)}
				/>
			{/each}

			<!-- Vertical connectors between adjacent segments -->
			{#each connectors as c}
				<line
					class="connector"
					x1="{c.xPct}%"
					y1={c.y1}
					x2="{c.xPct}%"
					y2={c.y2}
				/>
			{/each}

			<!-- Segment visible lines + labels -->
			{#each segVis as sv}
				<line
					class="seg"
					class:sel={selectedSegmentId === sv.id}
					x1="{sv.startX}%"
					y1={sv.y}
					x2="{sv.endX}%"
					y2={sv.y}
				/>
				{#if sv.endX - sv.startX > 2}
					<text
						class="seg-lbl"
						x="{(sv.startX + sv.endX) / 2}%"
						y={sv.y - 6}
						text-anchor="middle">{subLabel(sv.sub)}</text
					>
				{/if}
			{/each}

			<!-- Fixed anchor dots at time=0 and time=trackDuration -->
			<circle class="dot-anchor" cx="{toPct(0)}%" cy={anchorStartY} r={DOT_R} />
			<circle
				class="dot-anchor"
				cx="{toPct(trackDuration)}%"
				cy={anchorEndY}
				r={DOT_R}
			/>

			<!-- Interior boundary dots (draggable) -->
			{#each segVis as sv}
				{@const leftConn = connectors.find((c) => c.rightSegId === sv.id)}
				{@const rightConn = connectors.find((c) => c.leftSegId === sv.id)}

				<!-- Start dot: only when not at the absolute track start -->
				{#if sv.startTime > 0.001}
					{@const lId = leftConn?.leftSegId ?? null}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<circle
						class="dot"
						class:dot-hovered={hoveredDot?.leftSegId === lId &&
							hoveredDot?.rightSegId === sv.id}
						cx="{sv.startX}%"
						cy={sv.y}
						r={DOT_R}
						onpointerdown={(e) => startBndDrag(e, lId, sv.id)}
						onpointerenter={() => (hoveredDot = { leftSegId: lId, rightSegId: sv.id })}
						onpointerleave={() => (hoveredDot = null)}
					><title>Drag to move · Delete to remove boundary</title></circle>
				{/if}

				<!-- End dot: only when not at the absolute track end -->
				{#if sv.endTime < trackDuration - 0.001}
					{@const rId = rightConn?.rightSegId ?? null}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<circle
						class="dot"
						class:dot-hovered={hoveredDot?.leftSegId === sv.id &&
							hoveredDot?.rightSegId === rId}
						cx="{sv.endX}%"
						cy={sv.y}
						r={DOT_R}
						onpointerdown={(e) => startBndDrag(e, sv.id, rId)}
						onpointerenter={() => (hoveredDot = { leftSegId: sv.id, rightSegId: rId })}
						onpointerleave={() => (hoveredDot = null)}
					><title>Drag to move · Delete to remove boundary</title></circle>
				{/if}
			{/each}

			<!-- Manual switch point markers -->
			{#each manualPoints as pt}
				{@const xp = toPct(pt.time)}
				<line
					class="manual-line"
					x1="{xp}%"
					y1={PAD_V - 6}
					x2="{xp}%"
					y2={SVG_H - PAD_V + 6}
				/>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<circle
					class="manual-dot"
					cx="{xp}%"
					cy={PAD_V - 3}
					r={DOT_R}
					onpointerdown={(e) => startManDrag(e, pt.id)}
					ondblclick={(e) => onManualDblClick(e, pt.id)}
				/>
			{/each}

			<!-- Empty state hint -->
			{#if showHint}
				<text class="hint" x="50%" y={SVG_H / 2 + 4} text-anchor="middle">
					Double-click to create · drag bar up/down to change subdivision · drag
					dot to move boundary
				</text>
			{/if}

			<!-- Playhead -->
			{#if trackDuration > 0}
				{@const phx = toPct(currentTime)}
				<line class="playhead-line" x1="{phx}%" y1="0" x2="{phx}%" y2={SVG_H} />
				<circle class="playhead-head" cx="{phx}%" cy="1" r="3" />
				<!-- Wider invisible grab area on the head -->
				<circle class="playhead-grab" cx="{phx}%" cy="1" r="8" />
			{/if}
		</svg>

		<!-- Scrollbar — visible only when zoomed in -->
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

	<!-- Bottom controls bar -->
	{#if selectedSeg || segments.length > 0}
		<div class="controls" style={alignStyle}>
			{#if selectedSeg}
				<span class="ctrl-label"
					>Segment — <strong>{subLabel(selectedSeg.subdivision)}</strong> beat</span
				>
				<select
					value={selectedSeg.subdivision}
					onchange={(e) =>
						emit({
							segments: config.segments.map((s) =>
								s.id === selectedSeg!.id
									? {
											...s,
											subdivision: Number(
												(e.target as HTMLSelectElement).value,
											) as BeatSubdivision,
										}
									: s,
							),
						})}
				>
					{#each SUBDIVISIONS as sub, i}
						<option value={sub}>{SUBLABELS[i]} beat</option>
					{/each}
				</select>
				<button
					class="rm-btn"
					onclick={() => removeSegment(selectedSeg!.id)}
					title="Remove segment (Delete)">Remove</button
				>
			{/if}
			{#if segments.length > 0}
				<button class="clear-btn" onclick={clearAll} title="Clear all segments"
					>Clear all</button
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
		overflow: hidden; /* clips segments/dots scrolled out of the view window */
	}

	/* Grid rows */
	.grid-row {
		stroke: #1e1e1e;
		stroke-width: 1;
	}

	/* Tail / global line */
	.tail {
		stroke: #333;
		stroke-width: 1;
		stroke-dasharray: 3 4;
	}

	/* Segment hit area */
	.seg-hit {
		stroke: transparent;
		stroke-width: 14;
		pointer-events: all;
		cursor: ns-resize;
	}

	/* Segment visible line */
	.seg {
		stroke: #5a8fc0;
		stroke-width: 2;
		stroke-linecap: round;
		pointer-events: none;
	}

	.seg.sel {
		stroke: #90c0f8;
	}

	/* Segment subdivision label */
	.seg-lbl {
		fill: #4a7faf;
		font-size: 8px;
		font-family: monospace;
		pointer-events: none;
		user-select: none;
	}

	/* Vertical step connectors */
	.connector {
		stroke: #5a8fc0;
		stroke-width: 1.5;
		pointer-events: none;
	}

	/* Fixed anchor dots (timeline start/end — not draggable) */
	.dot-anchor {
		fill: #5a8fc0;
		stroke: none;
		pointer-events: none;
	}

	/* Interior boundary dots (draggable) */
	.dot {
		fill: #111;
		stroke: #5a8fc0;
		stroke-width: 1.5;
		cursor: ew-resize;
	}

	.dot:hover,
	.dot-hovered {
		fill: #5a8fc0;
	}

	.dot-hovered {
		stroke: #ff7070;
	}

	/* Manual switch point */
	.manual-line {
		stroke: #b05050;
		stroke-width: 1;
		stroke-dasharray: 2 3;
		pointer-events: none;
	}

	.manual-dot {
		fill: #111;
		stroke: #cc6666;
		stroke-width: 1.5;
		cursor: ew-resize;
	}

	.manual-dot:hover {
		fill: #cc6666;
	}

	/* Playhead */
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

	.playhead-grab {
		fill: transparent;
		stroke: none;
		cursor: col-resize;
	}

	/* Empty-state hint */
	.hint {
		fill: #3a3a3a;
		font-size: 8.5px;
		pointer-events: none;
		user-select: none;
	}

	/* Scrollbar (shown when zoomed in) */
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
		background: #3a5a80;
		border-radius: 2px;
		cursor: grab;
	}

	.scrollbar-thumb:hover {
		background: #4a6a9a;
	}

	.scrollbar-thumb:active {
		cursor: grabbing;
		background: #5a8fc0;
	}

	/* Controls bar */
	.controls {
		display: flex;
		flex-direction: row;
		gap: 0.5rem;
		margin-top: 0.25rem;
		font-size: 0.72rem;
		align-items: center;
	}

	.ctrl-label {
		color: #888;
		white-space: nowrap;
	}

	.ctrl-label strong {
		color: #aaa;
	}

	.controls select {
		background: #1a1a1a;
		color: #c0c0c0;
		border: 1px solid #333;
		border-radius: 3px;
		padding: 0.12rem 0.3rem;
		font-size: 0.72rem;
	}

	.rm-btn {
		background: none;
		border: none;
		color: #bb5555;
		cursor: pointer;
		font-size: 0.72rem;
		padding: 0.12rem 0.3rem;
	}

	.rm-btn:hover {
		color: #dd7777;
	}

	.clear-btn {
		background: none;
		border: 1px solid #333;
		color: #666;
		cursor: pointer;
		font-size: 0.72rem;
		padding: 0.12rem 0.3rem;
		border-radius: 3px;
		margin-left: auto;
	}

	.clear-btn:hover {
		border-color: #555;
		color: #999;
	}
</style>
