<script lang="ts">
	import ContextMenu from "../ui/ContextMenu.svelte";
	import { Diamond } from "lucide-svelte";
	import { untrack } from "svelte";
	import { formatTimeMs } from "../../audio/audio-utils";
	import {
		putKeyframe,
		removeKeysAtTimes,
		sampleNumbers,
		setEaseAtTimes,
		simplifyKeys,
		type KeyEase,
	} from "../../keyframes";
	import {
		dragKeys,
		pickRange,
		rowValue,
		sameKey,
		type KeyRef,
		type KeyRow,
		type RowTracks,
	} from "../../timeline/key-rows";
	import { CHAIN_OWNER, keyFocus } from "../../timeline/key-focus.svelte";

	/** The rows under a lane, one per animated setting: its value drawn as a line
	 * and its keys on it. Keys are picked like clips and drag both ways: sideways
	 * in time, up and down in value. */
	interface Props {
		rows: KeyRow[];
		/** The lane's place in the stack, which the rows share to stay under it. */
		order: number;
		toPct: (time: number) => number;
		viewStart: number;
		viewEnd: number;
		bpm?: number;
		beatOffset?: number;
		onSeek: (time: number) => void;
		/** `coalesceKey` keeps one drag one undo step. */
		onTracks: (tracks: RowTracks, coalesceKey?: string) => void;
		onOpenRow?: (row: KeyRow) => void;
		/** The media lane whose placement rows these are, if any. */
		laneId?: string;
	}

	let {
		rows,
		order,
		toPct,
		viewStart,
		viewEnd,
		bpm = 0,
		beatOffset = 0,
		onSeek,
		onTracks,
		onOpenRow,
		laneId,
	}: Props = $props();

	/** Room above and below the line, so a key at either end stays grabbable. */
	const PAD = 5;
	const CLICK_PX = 3;
	const SNAP_PX = 6;

	let picked = $state<KeyRef[]>([]);
	let anchor: KeyRef | null = null;
	let menu = $state<{ x: number; y: number; row: string } | null>(null);
	let dragSerial = 0;

	/** The picked keys still there: an undo or an edit elsewhere can take some away. */
	let selected = $derived(
		picked.filter((p) =>
			rows.some(
				(r) =>
					r.id === p.row &&
					r.keys.some((k) => sameKey(p, { row: r.id, t: k.t })),
			),
		),
	);

	// A step with the panel's arrows selects the key it lands on.
	let focusSerial = untrack(() => keyFocus.current?.serial ?? 0);
	$effect(() => {
		const focus = keyFocus.current;
		if (!focus || focus.serial === focusSerial) return;
		focusSerial = focus.serial;
		untrack(() => {
			const row = rows.find((r) => r.id === focus.row);
			const owner = row?.instanceId ? CHAIN_OWNER : laneId;
			if (!row || owner !== focus.owner) return;
			const ref = { row: row.id, t: focus.t };
			if (!row.keys.some((k) => sameKey(ref, { row: row.id, t: k.t }))) return;
			picked = [ref];
			anchor = ref;
		});
	});

	const isPicked = (ref: KeyRef) => selected.some((p) => sameKey(p, ref));

	function norm(row: KeyRow, v: number): number {
		return row.max > row.min ? (v - row.min) / (row.max - row.min) : 0;
	}

	/** The line through a row's keys, across what of its span is on screen. */
	function curve(row: KeyRow): string {
		const a = Math.max(row.from, viewStart);
		const b = Math.min(row.to, viewEnd);
		if (!(b > a)) return "";
		const n = 160;
		const pts: string[] = [];
		for (let i = 0; i <= n; i++) {
			const at = a + ((b - a) * i) / n;
			const v = sampleNumbers(row.keys, at - row.offset);
			if (v === null) continue;
			pts.push(
				`${(toPct(at) * 10).toFixed(2)},${((1 - norm(row, v)) * 100).toFixed(2)}`,
			);
		}
		return pts.join(" ");
	}

	function select(
		ref: KeyRef,
		e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
	) {
		if (e.ctrlKey || e.metaKey) {
			picked = isPicked(ref)
				? selected.filter((p) => !sameKey(p, ref))
				: [...selected, ref];
			anchor = ref;
			return;
		}
		if (e.shiftKey && anchor) {
			picked = pickRange(rows, anchor, ref);
			return;
		}
		picked = [ref];
		anchor = ref;
	}

	function onKeyDown(e: PointerEvent, row: KeyRow, t: number) {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		const target = e.currentTarget as HTMLElement;
		// Held off by preventDefault; Delete needs it to land here.
		target.focus({ preventScroll: true });
		const ref = { row: row.id, t };
		if (e.shiftKey || e.ctrlKey || e.metaKey) {
			select(ref, e);
			return;
		}
		if (!isPicked(ref)) select(ref, e);
		const track = target.parentElement!.getBoundingClientRect();
		const secPerPx = track.width > 0 ? (viewEnd - viewStart) / track.width : 0;
		const span = Math.max(1, track.height - PAD * 2);
		const start = rows.map((r) => ({
			...r,
			keys: r.keys.map((k) => ({ ...k })),
		}));
		const from = [...selected];
		const x0 = e.clientX;
		const y0 = e.clientY;
		const coalesceKey = `key-rows:${++dragSerial}`;
		let moved = false;
		target.setPointerCapture(e.pointerId);

		const move = (ev: PointerEvent) => {
			let dx = ev.clientX - x0;
			let dy = ev.clientY - y0;
			if (!moved && Math.hypot(dx, dy) < CLICK_PX) return;
			moved = true;
			// Shift holds the drag to whichever way it went further.
			if (ev.shiftKey) {
				if (Math.abs(dx) > Math.abs(dy)) dy = 0;
				else dx = 0;
			}
			let dt = dx * secPerPx;
			if (bpm > 0 && !ev.altKey && dx !== 0) {
				const beatSec = 60 / bpm;
				const at = row.offset + t + dt;
				const beat =
					Math.round((at - beatOffset) / beatSec) * beatSec + beatOffset;
				if (Math.abs(beat - at) <= SNAP_PX * secPerPx)
					dt = beat - row.offset - t;
			}
			const result = dragKeys(start, from, dt, -dy / span);
			onTracks(result.tracks, coalesceKey);
			picked = result.picked;
		};
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			target.removeEventListener("pointercancel", up);
			if (moved) return;
			picked = [ref];
			anchor = ref;
			onSeek(row.offset + t);
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
		target.addEventListener("pointercancel", up);
	}

	/** A click on the row's open space moves the playhead there. */
	function onTrackDown(e: PointerEvent) {
		if (e.button !== 0) return;
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (rect.width <= 0) return;
		picked = [];
		onSeek(
			viewStart +
				((e.clientX - rect.left) / rect.width) * (viewEnd - viewStart),
		);
	}

	/** A double-click adds a key where it lands, at the value its height gives. */
	function onTrackDblClick(e: MouseEvent, row: KeyRow) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (rect.width <= 0) return;
		const at =
			viewStart +
			((e.clientX - rect.left) / rect.width) * (viewEnd - viewStart);
		if (at < row.from || at > row.to) return;
		const n =
			1 - (e.clientY - rect.top - PAD) / Math.max(1, rect.height - PAD * 2);
		const v = rowValue(row, row.min + n * (row.max - row.min));
		const t = at - row.offset;
		onTracks(new Map([[row.id, putKeyframe(row.keys, t, v)]]));
		picked = [{ row: row.id, t }];
		anchor = picked[0];
	}

	/** The selection's keys, row by row, rewritten by `edit`. */
	function editSelected(
		edit: (keys: KeyRow["keys"], times: number[]) => KeyRow["keys"],
		refs: KeyRef[] = selected,
	) {
		const tracks: RowTracks = new Map();
		for (const row of rows) {
			const times = refs.filter((p) => p.row === row.id).map((p) => p.t);
			if (times.length > 0) tracks.set(row.id, edit(row.keys, times));
		}
		if (tracks.size > 0) onTracks(tracks);
	}

	function deleteSelected(refs: KeyRef[] = selected) {
		editSelected((keys, times) => removeKeysAtTimes(keys, times), refs);
		picked = [];
	}

	function onKeyKeydown(e: KeyboardEvent, row: KeyRow, t: number) {
		const ref = { row: row.id, t };
		if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			e.stopPropagation();
			deleteSelected(isPicked(ref) ? selected : [ref]);
		} else if (e.key === "Escape" && selected.length > 0) {
			e.preventDefault();
			e.stopPropagation();
			picked = [];
		}
	}

	function openMenu(e: MouseEvent, row: KeyRow, t: number) {
		e.preventDefault();
		e.stopPropagation();
		const ref = { row: row.id, t };
		if (!isPicked(ref)) {
			picked = [ref];
			anchor = ref;
		}
		menu = { x: e.clientX, y: e.clientY, row: row.id };
	}

	function pick(action: () => void) {
		action();
		menu = null;
	}

	let sharedEase = $derived.by(() => {
		const eases = selected.map(
			(p) =>
				rows
					.find((r) => r.id === p.row)
					?.keys.find((k) => Math.abs(k.t - p.t) <= 1e-3)?.ease,
		);
		return eases.every((x) => x === eases[0]) ? eases[0] : "mixed";
	});

	/** The rows the selection touches, or the one the menu opened on. */
	function menuRows(): KeyRow[] {
		const ids = new Set(selected.map((p) => p.row));
		if (menu) ids.add(menu.row);
		return rows.filter((r) => ids.has(r.id));
	}

	const EASES: { ease: KeyEase | undefined; label: string }[] = [
		{ ease: undefined, label: "Linear" },
		{ ease: "smooth", label: "Smooth" },
		{ ease: "hold", label: "Hold until the next key" },
	];
</script>

{#each rows as row (row.id)}
	<div class="tl-row key-row" style="order: {order}; --row-color: {row.color}">
		<div class="tl-gutter key-gutter">
			<span class="swatch"></span>
			<button
				type="button"
				class="row-name"
				title={onOpenRow
					? `${row.label}. Click to open it in the panel.`
					: row.label}
				onclick={() => onOpenRow?.(row)}>{row.label}</button
			>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="tl-lane lane-track key-track"
			onpointerdown={onTrackDown}
			ondblclick={(e) => onTrackDblClick(e, row)}
		>
			{#if Number.isFinite(row.to)}
				{@const left = toPct(row.from)}
				<span class="span" style="left: {left}%; width: {toPct(row.to) - left}%"
				></span>
			{/if}
			<svg class="curve" viewBox="0 0 1000 100" preserveAspectRatio="none">
				<polyline points={curve(row)} />
			</svg>
			{#each row.keys as k, i (i)}
				{@const at = row.offset + k.t}
				{#if at >= viewStart && at <= viewEnd}
					<button
						type="button"
						class="row-key"
						class:picked={isPicked({ row: row.id, t: k.t })}
						class:hold={k.ease === "hold"}
						style="left: {toPct(at)}%; top: calc({PAD}px + (100% - {PAD *
							2}px) * {1 - norm(row, k.v)})"
						title="{row.label}: {k.v.toFixed(2)} at {formatTimeMs(at)}"
						aria-label="{row.label} key at {formatTimeMs(at)}"
						aria-pressed={isPicked({ row: row.id, t: k.t })}
						onpointerdown={(e) => onKeyDown(e, row, k.t)}
						oncontextmenu={(e) => openMenu(e, row, k.t)}
						onkeydown={(e) => onKeyKeydown(e, row, k.t)}
						ondblclick={(e) => e.stopPropagation()}
					>
						<Diamond size={9} />
					</button>
				{/if}
			{/each}
		</div>
	</div>
{/each}

{#if menu}
	<!-- Fixed, so the lane's own overflow can't clip it. -->
	<ContextMenu x={menu.x} y={menu.y} onClose={() => (menu = null)}>
		{#each EASES as option (option.label)}
			<button
				type="button"
				role="menuitemradio"
				aria-checked={sharedEase === option.ease}
				class:active={sharedEase === option.ease}
				onclick={() =>
					pick(() =>
						editSelected((keys, times) =>
							setEaseAtTimes(keys, times, option.ease),
						),
					)}>{option.label}</button
			>
		{/each}
		<hr />
		<button
			type="button"
			role="menuitem"
			class="danger"
			onclick={() => pick(() => deleteSelected())}
			>{selected.length > 1
				? "Delete the selected keys"
				: "Delete this key"}</button
		>
		<button
			type="button"
			role="menuitem"
			class="danger"
			onclick={() =>
				pick(() => {
					onTracks(new Map(menuRows().map((r) => [r.id, []])));
					picked = [];
				})}
			>Delete every key in {menuRows().length > 1
				? "these rows"
				: "this row"}</button
		>
		<hr />
		<button
			type="button"
			role="menuitem"
			title="Drops keys that sit close to the line between their neighbours. The motion looks the same."
			onclick={() =>
				pick(() =>
					onTracks(
						new Map(
							menuRows().map((r) => [
								r.id,
								simplifyKeys(r.keys, (r.max - r.min) * 0.01),
							]),
						),
					),
				)}>Simplify keys</button
		>
	</ContextMenu>
{/if}

<style>
	.key-row {
		height: 30px;
	}

	.key-gutter {
		padding: 0 0.25rem 0 0.9rem;
		gap: 0.35rem;
	}

	.swatch {
		width: 6px;
		height: 6px;
		flex-shrink: 0;
		background: var(--row-color);
		transform: rotate(45deg);
	}

	.row-name {
		min-width: 0;
		padding: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.68rem;
		color: var(--text-3);
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.row-name:hover {
		color: var(--text);
	}

	.key-track {
		background: color-mix(in srgb, var(--ink) 85%, var(--row-color) 4%);
	}

	.span {
		position: absolute;
		top: 0;
		bottom: 0;
		background: color-mix(in srgb, var(--row-color) 6%, transparent);
		pointer-events: none;
	}

	.curve {
		position: absolute;
		left: 0;
		width: 100%;
		top: 5px;
		height: calc(100% - 10px);
		overflow: visible;
		pointer-events: none;
	}

	.curve polyline {
		fill: none;
		stroke: var(--row-color);
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
		opacity: 0.8;
	}

	.row-key {
		position: absolute;
		width: 12px;
		height: 12px;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		transform: translate(-50%, -50%);
		background: none;
		border: none;
		color: var(--row-color);
		cursor: move;
		z-index: 2;
	}

	.row-key :global(svg) {
		fill: currentColor;
		filter: drop-shadow(0 0 1px var(--ink));
	}

	.row-key.hold :global(svg) {
		fill: var(--ink);
	}

	.row-key.picked {
		color: var(--text);
	}

	.row-key.picked :global(svg) {
		filter: drop-shadow(0 0 2px var(--row-color));
	}
</style>
