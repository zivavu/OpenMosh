<script lang="ts">
	import { X } from "lucide-svelte";
	import { clampSpan, SPAN_MIN, type SourceSpan } from "../../media";

	interface Props {
		/** Seconds the strip spans — the whole file. */
		duration: number;
		currentTime: number;
		/** The stretch being played: the edit's, or the whole file. */
		span: SourceSpan;
		/** Whether the edit carries a span at all, so a reset has something to undo. */
		trimmed: boolean;
		onSeek: (t: number) => void;
		/** Snapshot for undo before a gesture; the key coalesces its ticks. */
		onBeforeEdit: (coalesceKey?: string) => void;
		/** Null puts the whole file back. */
		onChange: (span: SourceSpan | null) => void;
	}

	let {
		duration,
		currentTime,
		span,
		trimmed,
		onSeek,
		onBeforeEdit,
		onChange,
	}: Props = $props();

	let trackEl = $state<HTMLDivElement | undefined>(undefined);
	let dragging = $state<"start" | "end" | null>(null);

	function pct(t: number): number {
		return duration > 0 ? Math.min(Math.max(t / duration, 0), 1) * 100 : 0;
	}

	function timeAt(clientX: number): number {
		const rect = trackEl?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return 0;
		return Math.min(
			Math.max(((clientX - rect.left) / rect.width) * duration, 0),
			duration,
		);
	}

	/** Stores the span and hands back what was stored, clamped. */
	function setEdge(edge: "start" | "end", t: number): SourceSpan {
		const next = clampSpan(
			edge === "start"
				? { start: Math.min(t, span.end - SPAN_MIN), end: span.end }
				: { start: span.start, end: Math.max(t, span.start + SPAN_MIN) },
			duration,
		);
		onChange(next);
		return next ?? { start: 0, end: duration };
	}

	/** A handle drag: the edge follows the pointer, and the picture follows the
	 * edge, so what is being cut is on screen while it is being cut. */
	function onHandleDown(e: PointerEvent, edge: "start" | "end") {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		dragging = edge;
		onBeforeEdit(`trim-${edge}`);
		const move = (ev: PointerEvent) => {
			const next = setEdge(edge, timeAt(ev.clientX));
			onSeek(edge === "start" ? next.start : next.end);
		};
		const up = () => {
			dragging = null;
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			window.removeEventListener("pointercancel", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
		window.addEventListener("pointercancel", up);
	}

	function onTrackClick(e: MouseEvent) {
		onSeek(timeAt(e.clientX));
	}

	/** In/out at the playhead, as the [ and ] keys. */
	export function setInHere() {
		onBeforeEdit();
		setEdge("start", currentTime);
	}

	export function setOutHere() {
		onBeforeEdit();
		setEdge("end", currentTime);
	}

	function reset() {
		onBeforeEdit();
		onChange(null);
	}

	function fmt(t: number): string {
		return t.toFixed(2) + "s";
	}
</script>

<div class="trim-row" class:off={!trimmed}>
	<span
		class="trim-label"
		title="The stretch of the file every clip plays and loops over"
	>
		<span class="trim-dot"></span>
		Trim
	</span>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="trim-track" bind:this={trackEl} onclick={onTrackClick}>
		<div class="trim-cut" style:left="0" style:width="{pct(span.start)}%"></div>
		<div
			class="trim-cut"
			style:left="{pct(span.end)}%"
			style:width="{100 - pct(span.end)}%"
		></div>
		<div
			class="trim-keep"
			style:left="{pct(span.start)}%"
			style:width="{pct(span.end) - pct(span.start)}%"
		></div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="trim-handle start"
			class:dragging={dragging === "start"}
			style:left="{pct(span.start)}%"
			onpointerdown={(e) => onHandleDown(e, "start")}
			title="In point: {fmt(
				span.start,
			)}. Drag, or press [ to set it at the playhead."
		></div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="trim-handle end"
			class:dragging={dragging === "end"}
			style:left="{pct(span.end)}%"
			onpointerdown={(e) => onHandleDown(e, "end")}
			title="Out point: {fmt(
				span.end,
			)}. Drag, or press ] to set it at the playhead."
		></div>
		<div class="trim-head" style:left="{pct(currentTime)}%"></div>
	</div>

	<span class="trim-val" title="In – out (length)">
		{fmt(span.start)}–{fmt(span.end)}
		<span class="trim-len">({fmt(span.end - span.start)})</span>
	</span>

	<button
		class="trim-btn"
		onclick={setInHere}
		title="Set the in point at the playhead ([)"
		aria-label="Set in point here"
	>
		[
	</button>
	<button
		class="trim-btn"
		onclick={setOutHere}
		title="Set the out point at the playhead (])"
		aria-label="Set out point here"
	>
		]
	</button>
	<button
		class="trim-btn"
		disabled={!trimmed}
		onclick={reset}
		title="Play the whole file again"
		aria-label="Clear trim"
	>
		<X size={10} />
	</button>
</div>

<style>
	.trim-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		flex-shrink: 0;
	}

	/* Sized as a key-row's toggle, so the strip lines up with the tracks under it. */
	.trim-label {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		width: 5.4rem;
		padding: 0.15rem 0.25rem;
		color: var(--text-4);
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.trim-row:not(.off) .trim-label {
		color: var(--text-2);
	}

	.trim-dot {
		width: 0.4rem;
		height: 0.4rem;
		border: 1px solid currentColor;
		border-radius: 1px;
	}

	.trim-row:not(.off) .trim-dot {
		background: var(--live);
		border-color: var(--live);
	}

	.trim-track {
		position: relative;
		flex: 1;
		height: 1rem;
		cursor: pointer;
	}

	.trim-cut,
	.trim-keep {
		position: absolute;
		top: 30%;
		bottom: 30%;
		pointer-events: none;
	}

	.trim-cut {
		background: repeating-linear-gradient(
			-45deg,
			transparent 0 3px,
			var(--line) 3px 4px
		);
	}

	.trim-keep {
		background: color-mix(in srgb, var(--live) 18%, transparent);
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
	}

	.trim-row:not(.off) .trim-keep {
		border-color: var(--live);
	}

	.trim-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 6px;
		background: var(--text-3);
		border-radius: 1px;
		cursor: ew-resize;
		transition: background var(--t-fast);
	}

	.trim-handle.start {
		transform: translateX(-100%);
	}

	.trim-handle:hover,
	.trim-handle.dragging {
		background: var(--live);
	}

	.trim-head {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--text-4);
		pointer-events: none;
	}

	.trim-val {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
		font-size: 0.6rem;
		color: var(--text-3);
		white-space: nowrap;
	}

	.trim-len {
		color: var(--text-4);
	}

	.trim-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.1rem;
		height: 1.1rem;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		background: var(--ink);
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		cursor: pointer;
	}

	.trim-btn:hover:not(:disabled) {
		color: var(--text);
	}

	.trim-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
</style>
