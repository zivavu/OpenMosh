<script lang="ts">
	import { Diamond, Minus, Plus } from 'lucide-svelte';
	import { KEY_NEAR } from '../../media/source-edit';

	/** One editable track, as the dialog sees it. */
	export interface KeyTrackView {
		id: string;
		label: string;
		/** Whether the property varies over the clip at all. */
		on: boolean;
		/** Key times, in seconds into the source. */
		keys: number[];
		/** Why the track can't be switched on yet, or null when it can. */
		blocked?: string | null;
	}

	interface Props {
		tracks: KeyTrackView[];
		/** Source seconds the strip spans. */
		duration: number;
		currentTime: number;
		onSeek: (t: number) => void;
		onToggle: (id: string) => void;
		/** `at` places the key somewhere other than the playhead. */
		onAdd: (id: string, at?: number) => void;
		onRemove: (id: string) => void;
	}

	let {
		tracks,
		duration,
		currentTime,
		onSeek,
		onToggle,
		onAdd,
		onRemove,
	}: Props = $props();

	function pct(t: number): number {
		return duration > 0 ? Math.min(Math.max(t / duration, 0), 1) * 100 : 0;
	}

	function keyAtPlayhead(track: KeyTrackView): boolean {
		return track.keys.some((t) => Math.abs(t - currentTime) <= KEY_NEAR);
	}

	function onTrackClick(e: MouseEvent, track: KeyTrackView) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (rect.width <= 0) return;
		const t = ((e.clientX - rect.left) / rect.width) * duration;
		// Ctrl-click drops a key where it was clicked: the same as seeking there
		// and pressing +, which is what it does.
		if (e.ctrlKey || e.metaKey) {
			if (track.blocked && !track.on) return;
			onAdd(track.id, t);
			return;
		}
		onSeek(t);
	}
</script>

<div class="keys">
	{#each tracks as track (track.id)}
		<div class="key-row" class:off={!track.on}>
			<button
				class="key-toggle"
				class:on={track.on}
				disabled={!!track.blocked && !track.on}
				onclick={() => onToggle(track.id)}
				title={track.blocked && !track.on
					? track.blocked
					: track.on
						? `Stop animating ${track.label.toLowerCase()} — it keeps the value under the playhead`
						: `Animate ${track.label.toLowerCase()} over the clip, starting from a key here`}
			>
				<span class="key-dot"></span>
				{track.label}
			</button>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div class="key-track" onclick={(e) => onTrackClick(e, track)}>
				<div class="key-line"></div>
				{#each track.keys as t (t)}
					<!-- svelte-ignore a11y_consider_explicit_label -->
					<button
						class="key-mark"
						class:here={Math.abs(t - currentTime) <= KEY_NEAR}
						style:left="{pct(t)}%"
						onclick={(e) => {
							e.stopPropagation();
							onSeek(t);
						}}
						title="{t.toFixed(2)}s — click to jump here"
					>
						<Diamond size={8} fill="currentColor" />
					</button>
				{/each}
				<div class="key-head" style:left="{pct(currentTime)}%"></div>
			</div>

			<button
				class="key-btn"
				disabled={!track.on || keyAtPlayhead(track)}
				onclick={() => onAdd(track.id)}
				title="Hold {track.label.toLowerCase()} here — adds a key at the playhead with the value it already has"
				aria-label="Add {track.label} key"
			>
				<Plus size={10} />
			</button>
			<button
				class="key-btn"
				disabled={!keyAtPlayhead(track)}
				onclick={() => onRemove(track.id)}
				title="Remove the {track.label.toLowerCase()} key under the playhead"
				aria-label="Remove {track.label} key"
			>
				<Minus size={10} />
			</button>
		</div>
	{/each}
</div>

<style>
	.keys {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		flex-shrink: 0;
	}

	.key-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.key-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
		width: 5.4rem;
		padding: 0.15rem 0.25rem;
		border: none;
		background: none;
		color: var(--text-4);
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		text-align: left;
		cursor: pointer;
	}

	.key-toggle:hover:not(:disabled) {
		color: var(--text-2);
	}

	.key-toggle.on {
		color: var(--text-2);
	}

	.key-toggle:disabled {
		cursor: default;
		opacity: 0.5;
	}

	/* The stopwatch, in the one shape this app already uses for "armed". */
	.key-dot {
		width: 0.4rem;
		height: 0.4rem;
		border: 1px solid currentColor;
		border-radius: 50%;
	}

	.key-toggle.on .key-dot {
		background: var(--live);
		border-color: var(--live);
	}

	.key-track {
		position: relative;
		flex: 1;
		height: 1rem;
		cursor: pointer;
	}

	.key-line {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		height: 1px;
		background: var(--line);
	}

	.key-row.off .key-line {
		/* A track with nothing on it still reads as a place keys could go. */
		opacity: 0.5;
	}

	.key-mark {
		position: absolute;
		top: 50%;
		padding: 0;
		border: none;
		background: none;
		color: var(--text-3);
		transform: translate(-50%, -50%);
		line-height: 0;
		cursor: pointer;
	}

	.key-mark:hover,
	.key-mark.here {
		color: var(--live);
	}

	.key-head {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: var(--text-4);
		pointer-events: none;
	}

	.key-btn {
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
		cursor: pointer;
	}

	.key-btn:hover:not(:disabled) {
		color: var(--text);
	}

	.key-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
</style>
