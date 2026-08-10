<script lang="ts">
	import {
		ChevronLeft,
		ChevronRight,
		Pause,
		Play,
		RotateCcw,
		X,
	} from "lucide-svelte";
	import { untrack } from "svelte";
	import { isTextEntryTarget } from "../../editor/shortcut-target";
	import { createLyricsClips, type TextClip } from "../../text";

	/** The lyrics lane's current contents, as the modal reads them. */
	export interface LyricsDraft {
		lines: string[];
		timings: number[];
		clips: TextClip[];
	}

	/** Transport + apply hooks the host editor provides for the sync session. */
	export interface LyricsSyncProps {
		isPlaying: boolean;
		/** Master-time span the sync runs over (the track or video span). */
		spanStart: number;
		spanEnd: number;
		/** Live clock read for stamping — fresher than the rendered prop. */
		getCurrentTime?: () => number;
		onPlay: () => void;
		onPause: () => void;
		onSeek: (t: number) => void;
		onApply: (clips: TextClip[]) => void;
	}

	interface Props extends LyricsSyncProps {
		/** Kept mounted while closed so a half-done sync isn't lost. */
		open: boolean;
		currentTime: number;
		/** What the lyrics lane holds right now. Opening seeds from this, so the
		 * modal shows the same lines the timeline does. Null before any sync. */
		existing?: LyricsDraft | null;
		onClose: () => void;
	}

	let {
		open,
		currentTime,
		spanStart,
		spanEnd,
		isPlaying,
		getCurrentTime,
		existing = null,
		onPlay,
		onPause,
		onSeek,
		onApply,
		onClose,
	}: Props = $props();

	/** Seconds rewound when re-timing a line, so the lead-in gets heard. */
	const LEAD_IN = 1.5;
	/** Step the fine-tune buttons move every timing by. */
	const SHIFT_STEP = 0.05;

	let phase = $state<"edit" | "sync">("edit");
	let lyricsText = $state("");
	let timings = $state<(number | null)[]>([]);
	/** Cleared by any edit, so the confirmation only ever describes the lane as
	 * it stands. */
	let applied = $state(false);

	let panelEl = $state<HTMLElement | undefined>(undefined);

	let lines = $derived(
		lyricsText
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean),
	);
	/** First line without a time yet; past the end once every line is timed. */
	let activeIndex = $derived.by(() => {
		const i = timings.findIndex((t) => t == null);
		return i === -1 ? timings.length : i;
	});
	let allTimed = $derived(lines.length > 0 && activeIndex >= lines.length);

	let wasOpen = false;
	$effect(() => {
		if (!open) {
			wasOpen = false;
			return;
		}
		if (!wasOpen) {
			wasOpen = true;
			untrack(seedFromTimeline);
		}
		if (phase === "sync") panelEl?.focus();
	});

	/**
	 * Open onto whatever the lyrics lane already holds, so the modal and the
	 * timeline show the same lines — including timings nudged by dragging clips.
	 * A sync left half-done survives instead: closing mid-pass to look at
	 * something shouldn't throw the pass away.
	 */
	function seedFromTimeline() {
		if (phase === "sync" && !allTimed) return;
		if (!existing || existing.lines.length === 0) return;
		lyricsText = existing.lines.join("\n");
		timings = [...existing.timings];
		phase = "sync";
		applied = false;
	}

	function fmt(t: number): string {
		const s = Math.max(0, t);
		const m = Math.floor(s / 60);
		return `${m}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
	}

	function startSync() {
		const n = lines.length;
		if (n === 0) return;
		timings = new Array(n).fill(null);
		phase = "sync";
		applied = false;
		onSeek(spanStart);
		onPlay();
	}

	function stamp() {
		if (activeIndex >= lines.length) return;
		const t = getCurrentTime ? getCurrentTime() : currentTime;
		timings[activeIndex] = Math.min(spanEnd, Math.max(spanStart, t));
		applied = false;
		if (activeIndex + 1 >= lines.length) onPause();
	}

	function back() {
		if (activeIndex === 0) return;
		const i = activeIndex - 1;
		timings[i] = null;
		applied = false;
		const prev = i > 0 ? (timings[i - 1] ?? spanStart) : spanStart;
		onSeek(Math.max(spanStart, prev));
	}

	/** Re-time from line `i`: everything from there on is cleared and the
	 * playhead jumps back ahead of that line's spot. */
	function retimeFrom(i: number) {
		if (i < 0 || i >= lines.length) return;
		const anchor = timings[i] ?? timings[i - 1] ?? spanStart;
		for (let k = i; k < timings.length; k++) timings[k] = null;
		applied = false;
		onSeek(Math.max(spanStart, anchor - LEAD_IN));
	}

	function shiftAll(delta: number) {
		for (let i = 0; i < timings.length; i++) {
			const t = timings[i];
			if (t != null)
				timings[i] = Math.min(spanEnd, Math.max(spanStart, t + delta));
		}
		applied = false;
	}

	function togglePlay() {
		if (isPlaying) onPause();
		else onPlay();
	}

	/** Write the lines into the lane and stay put, so the result is visible and
	 * still nudgeable. The lane's own clips go in as `previous`, which is what
	 * keeps per-line effect chains alive across a re-apply. */
	function apply() {
		if (!allTimed) return;
		onApply(
			createLyricsClips(
				lines,
				timings as number[],
				spanEnd,
				existing?.clips ?? [],
			),
		);
		applied = true;
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (isTextEntryTarget(e.target)) return;
		if (phase === "edit") {
			// Keep the app's global shortcuts from firing under the modal; the
			// lyrics textarea already owns every key while it is focused.
			if (e.key === "Escape") {
				e.stopPropagation();
				onClose();
			} else if (
				e.key === " " ||
				e.key === "ArrowLeft" ||
				e.key === "ArrowRight" ||
				e.key === "Backspace" ||
				e.key === "Delete"
			) {
				e.stopPropagation();
			}
			return;
		}
		const key = e.key.toLowerCase();
		if (e.key === " ") {
			e.preventDefault();
			e.stopPropagation();
			stamp();
		} else if (e.key === "Backspace") {
			e.preventDefault();
			e.stopPropagation();
			back();
		} else if (e.key === "Escape") {
			e.stopPropagation();
			onClose();
		} else if (key === "p") {
			e.preventDefault();
			e.stopPropagation();
			togglePlay();
		} else if (e.ctrlKey || e.metaKey) {
			// Undo/redo/save belong to the app; mid-sync they'd rewrite the
			// timeline under the modal.
			if (key === "z" || key === "y" || key === "s") {
				e.preventDefault();
				e.stopPropagation();
			}
		} else if (
			key === "v" ||
			key === "f" ||
			e.key === "ArrowLeft" ||
			e.key === "ArrowRight" ||
			e.key === "Delete"
		) {
			e.preventDefault();
			e.stopPropagation();
		}
	}
</script>

<div
	class="lyrics-overlay"
	class:hidden={!open}
	role="dialog"
	aria-label="Sync lyrics"
	tabindex="-1"
	bind:this={panelEl}
	onkeydowncapture={onKeydown}
>
	<div class="lyrics-panel">
		<div class="header">
			<span class="title">Sync lyrics</span>
			<button class="close-btn" title="Close" onclick={onClose}>
				<X size={14} />
			</button>
		</div>

		{#if phase === "edit"}
			<textarea
				class="lyrics-input"
				placeholder={"Paste the whole lyrics, one line per line of text.\n\nFirst light in the morning\nShadows on the wall\nEvery verse, every chorus\nEvery word you want on screen"}
				value={lyricsText}
				oninput={(e) => {
					lyricsText = (e.currentTarget as HTMLTextAreaElement).value;
					timings = [];
					applied = false;
				}}
			></textarea>
			<p class="hint">
				{lines.length > 0
					? `${lines.length} line${lines.length === 1 ? "" : "s"} to time.`
					: "Paste the lyrics above, then sync them to the music."}
			</p>
			<div class="actions">
				<button class="ghost" onclick={onClose}>Close</button>
				<button
					class="primary"
					disabled={lines.length === 0}
					onclick={startSync}
				>
					Sync with playback
				</button>
			</div>
		{:else}
			<div class="transport">
				<button
					class="play-btn"
					title="Play / pause (P)"
					onclick={togglePlay}
				>
					{#if isPlaying}<Pause size={14} />{:else}<Play size={14} />{/if}
				</button>
				<button
					class="mark-btn"
					title={allTimed
						? "Every line is timed — click one below to re-time it"
						: "Mark this line (Space)"}
					disabled={allTimed}
					onclick={stamp}
				>
					Mark line
				</button>
				<span class="clock">{fmt(currentTime)}</span>
				<span class="count">{activeIndex} / {lines.length}</span>
				<span class="spacer"></span>
				<button
					class="shift-btn"
					title="Move every line 0.05s earlier"
					onclick={() => shiftAll(-SHIFT_STEP)}
				>
					<ChevronLeft size={12} />0.05
				</button>
				<button
					class="shift-btn"
					title="Move every line 0.05s later"
					onclick={() => shiftAll(SHIFT_STEP)}
				>
					0.05<ChevronRight size={12} />
				</button>
			</div>
			<ol class="lines">
				{#each lines as line, i (i)}
					<li>
						<button
							class="line"
							class:active={i === activeIndex}
							class:timed={timings[i] != null}
							title={timings[i] != null
								? "Click to re-time this line"
								: "Next line to time"}
							onclick={() => retimeFrom(i)}
						>
							<span class="line-no">{i + 1}</span>
							<span class="line-text">{line}</span>
							<span class="line-time"
								>{timings[i] != null ? fmt(timings[i]!) : "–"}</span
							>
						</button>
					</li>
				{/each}
			</ol>
			<p class="hint" class:ok={applied}>
				{#if applied}
					On the timeline as the Lyrics lane — keep nudging and apply again,
					or close.
				{:else}
					Space marks this line · Backspace steps back · P plays or pauses ·
					click a line to re-time it
				{/if}
			</p>
			<div class="actions">
				<button
					class="ghost"
					title="Clear every timing and sync again from the top"
					onclick={startSync}
				>
					<RotateCcw size={12} />Restart
				</button>
				<button class="ghost" onclick={() => (phase = "edit")}
					>Edit lyrics</button
				>
				<button class="ghost" onclick={onClose}>Close</button>
				<button class="primary" disabled={!allTimed} onclick={apply}>
					{applied ? "Re-apply" : "Apply to timeline"}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.lyrics-overlay {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
		outline: none;
	}

	.lyrics-overlay.hidden {
		display: none;
	}

	.lyrics-panel {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 560px;
		max-width: calc(100vw - 2rem);
		max-height: min(80vh, 640px);
		overflow-y: auto;
		padding: 1.1rem 1.25rem;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.title {
		font-size: 0.85rem;
		font-weight: 600;
		color: #ddd;
		letter-spacing: 0.04em;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		border: none;
		background: none;
		color: #777;
		cursor: pointer;
		border-radius: 4px;
	}

	.close-btn:hover {
		color: #eee;
	}

	.lyrics-input {
		min-height: 180px;
		padding: 0.5rem;
		border: 1px solid #333;
		border-radius: 6px;
		background: #121212;
		color: #e0e0e0;
		font-size: 0.85rem;
		font-family: inherit;
		line-height: 1.5;
		resize: vertical;
	}

	.lyrics-input:focus {
		border-color: #4a6a8a;
		outline: none;
	}

	.transport {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.play-btn,
	.shift-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		padding: 0.3rem 0.5rem;
		border: 1px solid #333;
		border-radius: 6px;
		background: #1a1a1a;
		color: #bbb;
		font-size: 0.7rem;
		cursor: pointer;
	}

	.play-btn {
		padding: 0.35rem 0.55rem;
	}

	.play-btn:hover,
	.shift-btn:hover {
		border-color: #555;
		color: #fff;
	}

	.clock {
		color: #ddd;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}

	.count {
		color: #888;
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}

	.spacer {
		flex: 1;
	}

	.lines {
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		max-height: 320px;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		background: #121212;
	}

	.line {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.4rem 0.6rem;
		border: none;
		border-bottom: 1px solid #1f1f1f;
		background: none;
		color: #bbb;
		font-size: 0.78rem;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
	}

	.line:last-child {
		border-bottom: none;
	}

	.line.active {
		background: #2f527a;
		color: #fff;
	}

	.line.timed:not(.active) {
		color: #6a6a6a;
	}

	.line:hover {
		background: #1e2a38;
	}

	.line.active:hover {
		background: #2f527a;
	}

	.line-no {
		flex-shrink: 0;
		width: 20px;
		color: #666;
		font-size: 0.68rem;
		text-align: right;
	}

	.line-text {
		flex: 1;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.line-time {
		flex-shrink: 0;
		min-width: 44px;
		color: #888;
		font-size: 0.7rem;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.hint {
		margin: 0;
		color: #666;
		font-size: 0.72rem;
		line-height: 1.35;
	}

	.hint.ok {
		color: #6f9f6f;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.mark-btn {
		padding: 0.3rem 0.7rem;
		border: 1px solid #4a6a8a;
		border-radius: 6px;
		background: #2f527a;
		color: #fff;
		font-size: 0.72rem;
		cursor: pointer;
	}

	.mark-btn:hover:not(:disabled) {
		background: #3a6391;
	}

	.mark-btn:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.primary {
		padding: 0.35rem 0.8rem;
		border: 1px solid #4a6a8a;
		border-radius: 6px;
		background: #2f527a;
		color: #fff;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.primary:hover:not(:disabled) {
		background: #3a6391;
	}

	.primary:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.ghost {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.3rem 0.6rem;
		border: 1px solid #333;
		border-radius: 6px;
		background: #1a1a1a;
		color: #bbb;
		font-size: 0.72rem;
		font-family: inherit;
		cursor: pointer;
	}

	.ghost:hover {
		border-color: #555;
		color: #fff;
	}
</style>
