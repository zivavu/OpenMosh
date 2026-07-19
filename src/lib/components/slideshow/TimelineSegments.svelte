<script lang="ts">
	import { generateId } from '../../effects';
	import { SegmentBoundaryController } from '../../editor/segment-boundary-controller.svelte';
	import type {
		BeatSubdivision,
		SlideshowConfig,
		TimelineSegment,
	} from '../../slideshow/types';

	const MIN_SEGMENT_DURATION = 0.125;

	// Ordered top→bottom: fast (1/32) to slow (4) — lower = higher beat value
	const SUBDIVISIONS: BeatSubdivision[] = [
		0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 0,
	];
	const SUBLABELS = ['¹⁄₃₂', '¹⁄₁₆', '⅛', '¼', '½', '1', '2', '4', '■'];

	const SVG_H = 100;
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
		alignToEl?: HTMLElement;
		selectedSegmentId?: string | null;
		currentTime?: number;
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
	let isMobile = $state(false);
	let wrapperEl: HTMLDivElement | undefined = $state();
	let svgEl: SVGSVGElement | undefined = $state();
	let scrollbarEl: HTMLDivElement | undefined = $state();

	// ── View window (zoom / pan) ─────────────────────────────────────────────────
	let viewStart = $state(0);
	let viewEnd = $state(0); // initialised by effect below
	let viewDuration = $derived(Math.max(0.001, viewEnd - viewStart));
	let isZoomed = $derived(
		trackDuration > 0 && (viewStart > 0.001 || viewEnd < trackDuration - 0.001),
	);

	// Initialise / clamp viewEnd when trackDuration changes (e.g. audio loaded)
	$effect(() => {
		const td = trackDuration;
		if (td > 0 && (viewEnd <= 0 || viewEnd > td)) viewEnd = td;
	});

	// ── Mobile detection ─────────────────────────────────────────────────────────
	$effect(() => {
		const update = () => {
			isMobile = window.innerWidth <= 800;
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(document.body);
		return () => ro.disconnect();
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
				type: 'boundary-group';
				anchorTime: number;
				boundaries: Array<{
					time: number;
					leftSegId: string | null;
					rightSegId: string | null;
				}>;
				nonSelectedBoundaries: number[];
		  }
		| {
				type: 'seg-y';
				segmentId: string;
				snapSub: BeatSubdivision;
				startClientY: number;
		  }
		| {
				type: 'scroll-pan';
				startClientX: number;
				startViewStart: number;
				scrollWidth: number;
		  }
		| { type: 'seek' }
		| {
				type: 'rect-select';
				startTime: number;
				startSvgY: number;
				currentTime: number;
				currentSvgY: number;
		  }
		| null;

	let dragging: DragState = $state(null);
	let dragMoved = $state(false);

	// ── Selection / clipboard / undo-redo (boundary dots) ────────────────────
	const boundaries = new SegmentBoundaryController<TimelineSegment, BeatSubdivision>({
		getSegments: () => config.segments,
		getTrackDuration: () => trackDuration,
		onChange: (segments) => onConfigChange({ ...config, segments }),
		splitSegment: (seg, at) => {
			const end = seg.endTime ?? trackDuration;
			return [
				{ id: generateId(), startTime: seg.startTime, endTime: at, subdivision: seg.subdivision },
				{ id: generateId(), startTime: at, endTime: end, subdivision: seg.subdivision },
			];
		},
		captureMeta: (rightSeg) => rightSeg?.subdivision ?? config.subdivision,
		applyMeta: (seg, subdivision) => ({ ...seg, subdivision }),
	});
	// Tracks which interior boundary dot the pointer is currently over
	let hoveredDot: {
		leftSegId: string | null;
		rightSegId: string | null;
	} | null = $state(null);

	// ── Helpers ──────────────────────────────────────────────────────────────────
	/** Emit without recording history — use during active drags. */
	function emitLive(patch: { segments: TimelineSegment[] }) {
		boundaries.live(patch.segments);
	}

	/** Emit and push current segments to undo history. */
	function emit(patch: { segments: TimelineSegment[] }) {
		boundaries.commit(patch.segments);
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

	// Attach wheel handler with { passive: false } so we can call preventDefault
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

	// ── Touch handler (non-passive, handles dots + double-tap + seg/seek drags) ──
	const DOT_HIT_PX = 28; // pixel radius for dot hit detection on touch
	let lastTapTime = 0;
	let lastTapPos = { x: 0, y: 0 };
	const DOUBLE_TAP_MS = 350;
	const DOUBLE_TAP_PX = 30;

	$effect(() => {
		const el = svgEl;
		if (!el) return;
		const svgElNonNull: SVGSVGElement = el;

		function handler(e: TouchEvent) {
			e.preventDefault();
			const touch = e.touches[0];
			if (!touch) return;
			const cx = touch.clientX;
			const cy = touch.clientY;
			const rect = svgElNonNull.getBoundingClientRect();

			// Convert client coords to SVG-space pixels for distance checks
			const svgX = cx - rect.left;
			const svgY_px = cy - rect.top;
			const svgH = rect.height;
			// Segments use SVG viewBox coords (0..SVG_H). Convert:
			void svgY_px;
			void svgH;

			// Check dot hits first (boundary dots)
			for (const sv of segVis) {
				// Convert sv.startX/endX (%) to pixel x
				const startPx = (sv.startX / 100) * rect.width;
				const endPx = (sv.endX / 100) * rect.width;
				const dotY_px = (sv.y / SVG_H) * rect.height;

				if (sv.startTime > 0.001) {
					const dx = svgX - startPx;
					const dy = svgY_px - dotY_px;
					if (Math.sqrt(dx * dx + dy * dy) < DOT_HIT_PX) {
						const lConn = connectors.find((c) => c.rightSegId === sv.id);
						const lId = lConn?.leftSegId ?? null;
						startBndDrag({ clientX: cx, clientY: cy, stopPropagation: () => {}, pointerId: -1 } as unknown as PointerEvent, lId, sv.id);
						return;
					}
				}
				if (sv.endTime < trackDuration - 0.001) {
					const dx = svgX - endPx;
					const dy = svgY_px - dotY_px;
					if (Math.sqrt(dx * dx + dy * dy) < DOT_HIT_PX) {
						const rConn = connectors.find((c) => c.leftSegId === sv.id);
						const rId = rConn?.rightSegId ?? null;
						startBndDrag({ clientX: cx, clientY: cy, stopPropagation: () => {}, pointerId: -1 } as unknown as PointerEvent, sv.id, rId);
						return;
					}
				}
			}

			// Double-tap detection → create segment
			const now = performance.now();
			const distFromLast = Math.sqrt((cx - lastTapPos.x) ** 2 + (cy - lastTapPos.y) ** 2);
			if (now - lastTapTime < DOUBLE_TAP_MS && distFromLast < DOUBLE_TAP_PX) {
				lastTapTime = 0;
				onDblClick({ clientX: cx, clientY: cy } as MouseEvent);
				return;
			}
			lastTapTime = now;
			lastTapPos = { x: cx, y: cy };

			// Check seg-y drag (hit a segment line)
			for (const sv of segVis) {
				const startPx = (sv.startX / 100) * rect.width;
				const endPx = (sv.endX / 100) * rect.width;
				const dotY_px = (sv.y / SVG_H) * rect.height;
				if (svgX >= startPx && svgX <= endPx && Math.abs(svgY_px - dotY_px) < 14) {
					startSegYDrag({ clientX: cx, clientY: cy, stopPropagation: () => {}, pointerId: -1, ctrlKey: false, metaKey: false } as unknown as PointerEvent, sv.id);
					return;
				}
			}

			// Default: seek
			if (onSeek && trackDuration > 0) {
				startSeekDrag({ clientX: cx, clientY: cy, button: 0, stopPropagation: () => {}, pointerId: -1, ctrlKey: false, metaKey: false, shiftKey: false } as unknown as PointerEvent);
			}
		}

		el.addEventListener('touchstart', handler, { passive: false });
		return () => el.removeEventListener('touchstart', handler);
	});

	// ── Derived visuals ──────────────────────────────────────────────────────────
	interface SegVis {
		id: string;
		startX: number; // view-relative %
		endX: number; // view-relative %
		y: number; // svg-px
		sub: BeatSubdivision;
		startTime: number; // absolute track time
		endTime: number; // absolute track time
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
		segVis.length > 0
			? segVis[segVis.length - 1].y
			: subToY(config.subdivision),
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
						id: generateId(),
						startTime: 0,
						endTime: trackDuration,
						subdivision: yToSub(svgY),
					},
				],
			});
			return;
		}

		const sorted = [...config.segments].sort(
			(a, b) => a.startTime - b.startTime,
		);
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
						id: generateId(),
						startTime: hit.startTime,
						endTime: time,
						subdivision: hit.subdivision,
					},
					{
						id: generateId(),
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

		// Determine the boundary time from segment data
		let boundaryTime: number | null = null;
		if (leftSegId) {
			const lseg = config.segments.find((s) => s.id === leftSegId);
			if (lseg) boundaryTime = lseg.endTime ?? trackDuration;
		} else if (rightSegId) {
			const rseg = config.segments.find((s) => s.id === rightSegId);
			if (rseg) boundaryTime = rseg.startTime;
		}

		// If this dot is in a multi-selection, start a group drag
		if (
			boundaryTime !== null &&
			boundaries.selectedBoundaryTimes.length > 1 &&
			boundaries.selectedBoundaryTimes.some((t) => Math.abs(t - boundaryTime!) < 0.001)
		) {
			const sortedSegs = [...config.segments].sort(
				(a, b) => a.startTime - b.startTime,
			);
			const groupBoundaries: Array<{
				time: number;
				leftSegId: string | null;
				rightSegId: string | null;
			}> = [];
			for (const t of boundaries.selectedBoundaryTimes) {
				const left = sortedSegs.find(
					(s) =>
						Math.abs((s.endTime ?? trackDuration) - t) < 0.001 &&
						(s.endTime ?? trackDuration) < trackDuration - 0.001,
				);
				const right = sortedSegs.find(
					(s) => Math.abs(s.startTime - t) < 0.001 && s.startTime > 0.001,
				);
				groupBoundaries.push({
					time: t,
					leftSegId: left?.id ?? null,
					rightSegId: right?.id ?? null,
				});
			}

			// Collect all boundary times that are NOT selected (these stay fixed)
			const allBoundarySet = new Set<number>([0, trackDuration]);
			for (const s of config.segments) {
				if (s.startTime > 0.001) allBoundarySet.add(s.startTime);
				const end = s.endTime ?? trackDuration;
				if (end < trackDuration - 0.001) allBoundarySet.add(end);
			}
			const nonSelectedBoundaries = [...allBoundarySet]
				.filter(
					(b) => !boundaries.selectedBoundaryTimes.some((t) => Math.abs(t - b) < 0.001),
				)
				.sort((a, b) => a - b);

			dragging = {
				type: 'boundary-group',
				anchorTime: clientXToTime(e.clientX),
				boundaries: groupBoundaries,
				nonSelectedBoundaries,
			};
			dragMoved = false;
			try { (e.currentTarget as SVGElement).setPointerCapture(e.pointerId); } catch {}
			return;
		}

		dragging = { type: 'boundary', leftSegId, rightSegId };
		dragMoved = false;
		try { (e.currentTarget as SVGElement).setPointerCapture(e.pointerId); } catch {}
	}

	function startSegYDrag(e: PointerEvent, segId: string) {
		e.stopPropagation();
		if (e.ctrlKey || e.metaKey) {
			const time = clientXToTime(e.clientX);
			const seg = config.segments.find((s) => s.id === segId);
			if (!seg) return;
			const end = seg.endTime ?? trackDuration;
			if (time <= seg.startTime + 0.01 || time >= end - 0.01) return;
			emit({
				segments: config.segments
					.filter((s) => s.id !== segId)
					.concat([
						{
							id: generateId(),
							startTime: seg.startTime,
							endTime: time,
							subdivision: seg.subdivision,
						},
						{
							id: generateId(),
							startTime: time,
							endTime: end,
							subdivision: seg.subdivision,
						},
					]),
			});
			return;
		}
		const seg = config.segments.find((s) => s.id === segId);
		if (!seg) return;
		dragging = {
			type: 'seg-y',
			segmentId: segId,
			snapSub: seg.subdivision,
			startClientY: e.clientY,
		};
		dragMoved = false;
		try { (e.currentTarget as SVGElement).setPointerCapture(e.pointerId); } catch {}
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
		try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
	}

	function startSeekDrag(e: PointerEvent) {
		if (e.button !== 0) return;
		// If in paste mode, split segments at clipboard offsets from the clicked time
		if (boundaries.pasteMode && boundaries.clipboard.length > 0) {
			e.stopPropagation();
			boundaries.pasteAt(clientXToTime(e.clientX));
			return;
		}
		// Ctrl+click → split segment at cursor
		if (e.ctrlKey || e.metaKey) {
			e.stopPropagation();
			const time = clientXToTime(e.clientX);
			const svgY = clientYToSvgY(e.clientY);
			if (config.segments.length === 0) {
				emit({
					segments: [
						{
							id: generateId(),
							startTime: 0,
							endTime: trackDuration,
							subdivision: yToSub(svgY),
						},
					],
				});
				return;
			}
			const sorted = [...config.segments].sort(
				(a, b) => a.startTime - b.startTime,
			);
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
							id: generateId(),
							startTime: hit.startTime,
							endTime: time,
							subdivision: hit.subdivision,
						},
						{
							id: generateId(),
							startTime: time,
							endTime: end,
							subdivision: hit.subdivision,
						},
					]),
			});
			return;
		}
		// Shift+drag → rectangle selection
		if (e.shiftKey) {
			startRectSelect(e);
			return;
		}
		// Default: seek
		if (!onSeek) return;
		boundaries.clearSelection();
		const time = Math.max(0, Math.min(trackDuration, clientXToTime(e.clientX)));
		onSeek(time);
		dragging = { type: 'seek' };
		dragMoved = false;
		try { (e.currentTarget as SVGElement).setPointerCapture(e.pointerId); } catch {}
	}

	function startRectSelect(e: PointerEvent) {
		e.stopPropagation();
		const time = clientXToTime(e.clientX);
		const svgY = clientYToSvgY(e.clientY);
		dragging = {
			type: 'rect-select',
			startTime: time,
			startSvgY: svgY,
			currentTime: time,
			currentSvgY: svgY,
		};
		dragMoved = false;
		try { (e.currentTarget as SVGElement).setPointerCapture(e.pointerId); } catch {}
	}

	function onPointerMove(e: PointerEvent) {
		if (boundaries.pasteMode) {
			boundaries.pasteCursorTime = clientXToTime(e.clientX);
		}
		if (!dragging) return;

		if (dragging.type === 'boundary') {
			if (!dragMoved) {
				boundaries.snapshotForDrag();
			}
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
				emitLive({
					segments: config.segments.map((s) =>
						updates[s.id] ? { ...s, ...updates[s.id] } : s,
					),
				});
			}
		} else if (dragging.type === 'boundary-group') {
			if (!dragMoved) {
				boundaries.snapshotForDrag();
			}
			dragMoved = true;
			const rawDelta = clientXToTime(e.clientX) - dragging.anchorTime;

			// Clamp delta so no selected boundary crosses a non-selected neighbor
			let minDelta = -Infinity;
			let maxDelta = Infinity;
			for (const b of dragging.boundaries) {
				const nsb = dragging.nonSelectedBoundaries;
				// Nearest fixed boundary to the left
				for (let i = nsb.length - 1; i >= 0; i--) {
					if (nsb[i] < b.time - 0.001) {
						minDelta = Math.max(
							minDelta,
							nsb[i] + MIN_SEGMENT_DURATION - b.time,
						);
						break;
					}
				}
				// Nearest fixed boundary to the right
				for (let i = 0; i < nsb.length; i++) {
					if (nsb[i] > b.time + 0.001) {
						maxDelta = Math.min(
							maxDelta,
							nsb[i] - MIN_SEGMENT_DURATION - b.time,
						);
						break;
					}
				}
			}
			const delta = Math.max(
				isFinite(minDelta) ? minDelta : rawDelta,
				Math.min(isFinite(maxDelta) ? maxDelta : rawDelta, rawDelta),
			);

			// Apply delta to all selected boundaries via segment IDs
			const updates: Record<string, Partial<TimelineSegment>> = {};
			for (const b of dragging.boundaries) {
				const newT = b.time + delta;
				if (b.leftSegId)
					updates[b.leftSegId] = { ...updates[b.leftSegId], endTime: newT };
				if (b.rightSegId)
					updates[b.rightSegId] = { ...updates[b.rightSegId], startTime: newT };
			}

			emitLive({
				segments: config.segments.map((s) =>
					updates[s.id] ? { ...s, ...updates[s.id] } : s,
				),
			});
		} else if (dragging.type === 'seg-y') {
			if (Math.abs(e.clientY - dragging.startClientY) > DRAG_THRESHOLD_PX) {
				dragMoved = true;
				const snap = yToSub(clientYToSvgY(e.clientY));
				if (snap !== dragging.snapSub) {
					dragging = { ...dragging, snapSub: snap };
				}
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
		} else if (dragging.type === 'rect-select') {
			dragMoved = true;
			dragging = {
				...dragging,
				currentTime: clientXToTime(e.clientX),
				currentSvgY: clientYToSvgY(e.clientY),
			};
		}
	}

	function onPointerUp() {
		if (dragging?.type === 'rect-select') {
			if (dragMoved) {
				const minTime = Math.min(dragging.startTime, dragging.currentTime);
				const maxTime = Math.max(dragging.startTime, dragging.currentTime);
				boundaries.setSelectionFromRange(minTime, maxTime);
			} else {
				boundaries.clearSelection();
			}
		}
		if (dragging?.type === 'boundary-group' && dragMoved) {
			// Update selection to reflect the new boundary positions
			const newTimes: number[] = [];
			for (const b of dragging.boundaries) {
				const refSeg = b.leftSegId
					? config.segments.find((s) => s.id === b.leftSegId)
					: config.segments.find((s) => s.id === b.rightSegId);
				if (refSeg) {
					newTimes.push(
						b.leftSegId ? (refSeg.endTime ?? trackDuration) : refSeg.startTime,
					);
				}
			}
			boundaries.selectedBoundaryTimes = newTimes;
		}
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
		const sorted = [...config.segments].sort(
			(a, b) => a.startTime - b.startTime,
		);
		const idx = sorted.findIndex((s) => s.id === id);
		if (idx === -1) return;

		if (sorted.length === 1) {
			selectedSegmentId = null;
			emit({ segments: [] });
			return;
		}

		const deleted = sorted[idx];
		const neighbour =
			idx < sorted.length - 1 ? sorted[idx + 1] : sorted[idx - 1];
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

	function mergeDot(leftSegId: string | null, rightSegId: string | null) {
		if (!leftSegId || !rightSegId) return;
		const left = config.segments.find((s) => s.id === leftSegId);
		const right = config.segments.find((s) => s.id === rightSegId);
		if (!left || !right) return;
		const merged: TimelineSegment = {
			...left,
			id: generateId(),
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
		const t = e.target as HTMLElement;
		if (t.closest('input, textarea, select')) return;

		// Undo / redo / copy / paste-mode-enter / escape
		if (boundaries.onKeydown(e)) return;

		// Delete / Backspace — existing local priority: hovered dot, then
		// selected boundaries, then the selected whole segment.
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		if (hoveredDot) {
			e.preventDefault();
			mergeDot(hoveredDot.leftSegId, hoveredDot.rightSegId);
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

	// Boundary times currently inside the in-progress rect-select drag (for live highlighting)
	let rectHoverTimes = $derived.by((): number[] => {
		if (dragging?.type !== 'rect-select' || !dragMoved) return [];
		const minTime = Math.min(dragging.startTime, dragging.currentTime);
		const maxTime = Math.max(dragging.startTime, dragging.currentTime);
		const times = new Set<number>();
		for (const s of segments) {
			if (
				s.startTime > 0.001 &&
				s.startTime >= minTime &&
				s.startTime <= maxTime
			)
				times.add(s.startTime);
			const end = s.endTime ?? trackDuration;
			if (end < trackDuration - 0.001 && end >= minTime && end <= maxTime)
				times.add(end);
		}
		return [...times];
	});

	let svgCursor = $derived.by(() => {
		if (boundaries.pasteMode) return 'copy';
		const d = dragging;
		if (!d) return onSeek ? 'crosshair' : 'default';
		if (d.type === 'seg-y') return 'ns-resize';
		if (d.type === 'seek') return 'col-resize';
		if (d.type === 'rect-select') return 'crosshair';
		return 'ew-resize';
	});
</script>

<svelte:window
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onkeydown={onKeydown}
	ontouchmove={(e) => {
		if (!dragging) return;
		const t = e.touches[0];
		if (t)
			onPointerMove({
				clientX: t.clientX,
				clientY: t.clientY,
				pointerId: -1,
			} as PointerEvent);
	}}
	ontouchend={(_e) => {
		if (!dragging) return;
		onPointerUp();
	}}
/>

<div class="tl-container">
	<div
		class="tl-track"
		bind:this={wrapperEl}
		style={isMobile ? '' : alignStyle}
	>
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
				{#if sv.endX - sv.startX > 4}
					{@const midX = (sv.startX + sv.endX) / 2}
					<line
						class="seg-mid"
						x1="{midX}%"
						y1={sv.y - 4}
						x2="{midX}%"
						y2={sv.y + 4}
						pointer-events="none"
					/>
					{@const lblX = Math.max(sv.startX + 2, Math.min(sv.endX - 2, midX))}
					<text
						class="seg-lbl"
						x="{lblX}%"
						y={sv.y + 16}
						font-size="14"
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
						class="dot-hit"
						cx="{sv.startX}%"
						cy={sv.y}
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
						cy={sv.y}
						r={DOT_R}
						onpointerenter={() =>
							(hoveredDot = { leftSegId: lId, rightSegId: sv.id })}
						onpointerleave={() => (hoveredDot = null)}
						onpointerdown={(e) => startBndDrag(e, lId, sv.id)}
						><title>Drag to move · Delete to remove boundary</title></circle
					>
				{/if}

				<!-- End dot: only when not at the absolute track end -->
				{#if sv.endTime < trackDuration - 0.001}
					{@const rId = rightConn?.rightSegId ?? null}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<circle
						class="dot-hit"
						cx="{sv.endX}%"
						cy={sv.y}
						r={14}
						onpointerdown={(e) => startBndDrag(e, sv.id, rId)}
					/>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<circle
						class="dot"
						class:dot-hovered={hoveredDot?.leftSegId === sv.id &&
							hoveredDot?.rightSegId === rId}
						class:dot-selected={boundaries.selectedBoundaryTimes.some(
							(t) => Math.abs(t - sv.endTime) < 0.001,
						) || rectHoverTimes.some((t) => Math.abs(t - sv.endTime) < 0.001)}
						cx="{sv.endX}%"
						cy={sv.y}
						r={DOT_R}
						onpointerenter={() =>
							(hoveredDot = { leftSegId: sv.id, rightSegId: rId })}
						onpointerleave={() => (hoveredDot = null)}
						onpointerdown={(e) => startBndDrag(e, sv.id, rId)}
						><title>Drag to move · Delete to remove boundary</title></circle
					>
				{/if}
			{/each}

			<!-- Empty state hint -->
			{#if showHint}
				<text class="hint" x="50%" y={SVG_H / 2 + 4} text-anchor="middle">
					Double-click to create · drag bar up/down to change beat · drag dot to
					move boundary
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
			<!-- Rectangle selection overlay -->
			{#if dragging?.type === 'rect-select' && dragMoved}
				{@const minX = Math.min(
					toPct(dragging.startTime),
					toPct(dragging.currentTime),
				)}
				{@const maxX = Math.max(
					toPct(dragging.startTime),
					toPct(dragging.currentTime),
				)}
				{@const minY = Math.min(dragging.startSvgY, dragging.currentSvgY)}
				{@const maxY = Math.max(dragging.startSvgY, dragging.currentSvgY)}
				<rect
					class="select-rect"
					x="{minX}%"
					y={minY}
					width="{maxX - minX}%"
					height={Math.max(1, maxY - minY)}
					pointer-events="none"
				/>
			{/if}

			<!-- Ghost paste preview (boundary splits) -->
			{#if boundaries.pasteMode && boundaries.clipboard.length > 0}
				{#each boundaries.clipboard as { offset }}
					{@const ghostTime = boundaries.pasteCursorTime + offset}
					{@const gx = toPct(ghostTime)}
					<line
						class="ghost-split-line"
						x1="{gx}%"
						y1="0"
						x2="{gx}%"
						y2={SVG_H}
					/>
				{/each}
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
		stroke-width: 14;
		pointer-events: all;
		cursor: ns-resize;
	}

	.seg {
		stroke: #5a8fc0;
		stroke-width: 2;
		stroke-linecap: round;
		pointer-events: none;
	}

	.seg.sel {
		stroke: #90c0f8;
	}

	.seg-mid {
		stroke: #3a6a9a;
		stroke-width: 1;
		opacity: 0.5;
	}

	.seg-lbl {
		fill: #4a7faf;
		font-size: 14px;
		font-family: monospace;
		pointer-events: none;
		user-select: none;
	}

	.connector {
		stroke: #5a8fc0;
		stroke-width: 1.5;
		pointer-events: none;
	}

	.dot-anchor {
		fill: #5a8fc0;
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
		stroke: #5a8fc0;
		stroke-width: 1.5;
		cursor: ew-resize;
	}

	.dot:hover,
	.dot-hovered,
	.dot-selected {
		fill: #5a8fc0;
	}

	.dot-selected {
		stroke: #90d0ff;
		stroke-width: 2;
	}

	.dot-hovered {
		stroke: #ff7070;
	}

	.select-rect {
		fill: rgba(90, 143, 192, 0.08);
		stroke: rgba(90, 143, 192, 0.5);
		stroke-width: 1;
		stroke-dasharray: 3 3;
	}

	.ghost-split-line {
		stroke: rgba(90, 143, 192, 0.4);
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

	.playhead-grab {
		fill: transparent;
		stroke: none;
		cursor: col-resize;
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
