<script lang="ts">
	import ContextMenu from "../ui/ContextMenu.svelte";
	import { ChevronsUpDown } from "lucide-svelte";
	import KeyGlyph from "./KeyGlyph.svelte";
	import {
		EASE_HEADING,
		EASE_OPTIONS,
		easeLabel,
		repeatsFor,
	} from "../../timeline/key-eases";
	import DragReadout from "./DragReadout.svelte";
	import {
		gridKeyTarget,
		keyGrid,
		snapToKeyGrid,
	} from "../../timeline/key-grid.svelte";
	import { nextGridLine, onGrid } from "../../key-grid";
	import KeyEditPopover from "./KeyEditPopover.svelte";
	import { tallKeyRows } from "../../timeline/key-row-size.svelte";
	import { onDestroy, untrack } from "svelte";
	import { formatTimeMs } from "../../audio/audio-utils";
	import { copyKeys, rowKeysAt } from "../../timeline/key-clipboard";
	import { CLICK_PX, FinePointer, isFine, PLAIN } from "../../fine-drag";
	import {
		keyframeAt,
		NUDGE_SEC,
		putKeyframe,
		removeKeysAtTimes,
		repeatKeysEvery,
		sampleNumbers,
		setEaseAtTimes,
		simplifyKeys,
	} from "../../keyframes";
	import {
		dragKeys,
		pickRange,
		rowValue,
		sameKey,
		setRowKey,
		type KeyRef,
		type KeyRow,
		type RowTracks,
	} from "../../timeline/key-rows";
	import {
		CHAIN_OWNER,
		dropBoxed,
		holdBoxed,
		keyBox,
		keyFocus,
	} from "../../timeline/key-focus.svelte";

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
		/** The paused playhead, where the panel's sliders key these rows; null while
		 * playing or when the panel isn't on them. */
		editAt?: number | null;
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
		editAt = null,
	}: Props = $props();

	/** Room above and below the line, so a key at either end stays grabbable. */
	const PAD = 5;
	const SNAP_PX = 6;

	let picked = $state<KeyRef[]>([]);
	let anchor: KeyRef | null = null;
	let menu = $state<{ x: number; y: number; row: string } | null>(null);
	let dragSerial = 0;
	let readout = $state<{ x: number; y: number; text: string } | null>(null);
	/** A key being typed into, by its row and time. */
	let typing = $state<{ x: number; y: number; ref: KeyRef } | null>(null);

	function valueText(row: KeyRow, v: number): string {
		return v.toFixed(row.step >= 1 ? 0 : 2);
	}

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

	// A shift-drag box over this lane selects the keys inside it, for the next Delete.
	const boxId = Symbol("key-rows");
	let boxSerial = 0;
	$effect(() => {
		const box = keyBox.current;
		if (!box || box.laneId !== laneId || box.serial === boxSerial) return;
		boxSerial = box.serial;
		untrack(() => {
			picked = rows.flatMap((row) =>
				row.keys
					.filter((k) => {
						const at = row.offset + k.t;
						return at >= box.from - 1e-3 && at <= box.to + 1e-3;
					})
					.map((k) => ({ row: row.id, t: k.t })),
			);
			anchor = picked[0] ?? null;
			if (picked.length > 0)
				holdBoxed(
					boxId,
					() => deleteSelected(),
					() => rowKeysAt(rows, selected),
				);
		});
	});
	onDestroy(() => dropBoxed(boxId));

	const isPicked = (ref: KeyRef) => selected.some((p) => sameKey(p, ref));

	function norm(row: KeyRow, v: number): number {
		return row.max > row.min ? (v - row.min) / (row.max - row.min) : 0;
	}

	/** Where a slider edit keys this row, in its own seconds, when the beat grid
	 * moves it off the playhead. */
	function rowTarget(row: KeyRow): number | null {
		const at = gridKeyTarget(editAt, row.from, row.to);
		return at === null ? null : at - row.offset;
	}

	function keyTop(row: KeyRow, v: number): string {
		return `calc(${PAD}px + (100% - ${PAD * 2}px) * ${1 - norm(row, v)})`;
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
		if (e.shiftKey) {
			select(ref, e);
			return;
		}
		// Ctrl: a click adds or drops the key, a drag moves slowly.
		const ctrlPress = isFine(e);
		if (!ctrlPress && !isPicked(ref)) select(ref, e);
		const track = target.parentElement!.getBoundingClientRect();
		const secPerPx = track.width > 0 ? (viewEnd - viewStart) / track.width : 0;
		const span = Math.max(1, track.height - PAD * 2);
		const start = rows.map((r) => ({
			...r,
			keys: r.keys.map((k) => ({ ...k })),
		}));
		let from: KeyRef[] = [];
		const pointer = new FinePointer(e);
		const coalesceKey = `key-rows:${++dragSerial}`;
		let moved = false;
		target.setPointerCapture(e.pointerId);

		const move = (ev: PointerEvent) => {
			pointer.move(ev);
			if (!moved) {
				if (
					Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < CLICK_PX
				)
					return;
				moved = true;
				if (!isPicked(ref)) select(ref, PLAIN);
				from = [...selected];
			}
			let dx = pointer.x - e.clientX;
			let dy = pointer.y - e.clientY;
			// Shift holds the drag to whichever way it went further.
			if (ev.shiftKey) {
				if (Math.abs(dx) > Math.abs(dy)) dy = 0;
				else dx = 0;
			}
			let dt = dx * secPerPx;
			const grid = keyGrid();
			if (grid && !ev.altKey)
				dt = onGrid(row.offset + t + dt, grid) - row.offset - t;
			else if (bpm > 0 && !ev.altKey && dx !== 0) {
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
			const held = keyframeAt(
				result.tracks.get(row.id),
				Math.max(0, t + result.dt),
			);
			readout = held && {
				x: ev.clientX,
				y: ev.clientY,
				text: `${valueText(row, held.v)} · ${formatTimeMs(row.offset + held.t)}`,
			};
		};
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			target.removeEventListener("pointercancel", up);
			readout = null;
			if (moved) return;
			if (ctrlPress) {
				select(ref, e);
				return;
			}
			picked = [ref];
			anchor = ref;
			onSeek(row.offset + t);
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
		target.addEventListener("pointercancel", up);
	}

	function openTyping(e: MouseEvent, ref: KeyRef) {
		picked = [ref];
		anchor = ref;
		typing = { x: e.clientX, y: e.clientY, ref };
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
		const clicked =
			viewStart +
			((e.clientX - rect.left) / rect.width) * (viewEnd - viewStart);
		if (clicked < row.from || clicked > row.to) return;
		const at = snapToKeyGrid(clicked, row.from, row.to);
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
		const these = isPicked(ref) ? selected : [ref];
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === "c") {
			e.preventDefault();
			e.stopPropagation();
			copyKeys(rowKeysAt(rows, these));
		} else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !mod) {
			e.preventDefault();
			e.stopPropagation();
			const direction = e.key === "ArrowLeft" ? -1 : 1;
			const grid = keyGrid();
			const at = row.offset + t;
			const step =
				e.shiftKey && bpm > 0
					? (direction * 60) / bpm
					: grid
						? nextGridLine(at, grid, direction) - at
						: direction * NUDGE_SEC;
			const result = dragKeys(rows, these, step, 0);
			if (result.dt === 0) return;
			onTracks(result.tracks, `key-rows-nudge:${++dragSerial}`);
			picked = result.picked;
		} else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !mod) {
			e.preventDefault();
			e.stopPropagation();
			nudgeValues(these, e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
		} else if (e.key === "Delete" || e.key === "Backspace") {
			e.preventDefault();
			e.stopPropagation();
			deleteSelected(isPicked(ref) ? selected : [ref]);
		} else if (e.key === "Escape" && selected.length > 0) {
			e.preventDefault();
			e.stopPropagation();
			picked = [];
		}
	}

	/** A picked key's place on the timeline. */
	function keyAt(ref: KeyRef): number {
		return (rows.find((r) => r.id === ref.row)?.offset ?? 0) + ref.t;
	}

	/** The picked keys laid down again every `period` seconds, to the end of their
	 * clip, or of the view for a layer's rows. */
	function repeatSelected(period: number) {
		const tracks: RowTracks = new Map();
		for (const row of rows) {
			const times = selected.filter((p) => p.row === row.id).map((p) => p.t);
			if (times.length === 0) continue;
			const end = (Number.isFinite(row.to) ? row.to : viewEnd) - row.offset;
			tracks.set(row.id, repeatKeysEvery(row.keys, times, period, end));
		}
		if (tracks.size > 0) onTracks(tracks);
	}

	/** The keys a step of their slider up or down; ten with `big`. */
	function nudgeValues(these: KeyRef[], direction: -1 | 1, big: boolean) {
		const tracks: RowTracks = new Map();
		for (const row of rows) {
			const times = these.filter((p) => p.row === row.id).map((p) => p.t);
			if (times.length === 0) continue;
			const step = row.step > 0 ? row.step : (row.max - row.min) / 100;
			const by = direction * step * (big ? 10 : 1);
			tracks.set(
				row.id,
				row.keys.map((k) =>
					times.some((x) => Math.abs(x - k.t) <= 1e-3)
						? { ...k, v: rowValue(row, k.v + by) }
						: k,
				),
			);
		}
		if (tracks.size > 0) onTracks(tracks, `key-rows-nudge:${++dragSerial}`);
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
</script>

{#each rows as row (row.id)}
	{@const tall = tallKeyRows.has(row.id)}
	{@const target = rowTarget(row)}
	{@const targetAt = target === null ? null : row.offset + target}
	{@const onTarget = target !== null && !!keyframeAt(row.keys, target)}
	<div
		class="tl-row key-row"
		class:tall
		style="order: {order}; --row-color: {row.color}"
	>
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
			<button
				type="button"
				class="row-size"
				class:on={tall}
				aria-pressed={tall}
				title={tall
					? "Make the row short again"
					: "Make the row taller, for finer values"}
				aria-label={tall ? `Shorten ${row.label}` : `Make ${row.label} taller`}
				onclick={() =>
					tall ? tallKeyRows.delete(row.id) : tallKeyRows.add(row.id)}
			>
				<ChevronsUpDown size={11} />
			</button>
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
			{#if target !== null && targetAt !== null && targetAt >= viewStart && targetAt <= viewEnd && !onTarget}
				{@const v = sampleNumbers(row.keys, target) ?? row.min}
				<span
					class="row-key ghost"
					style="left: {toPct(targetAt)}%; top: {keyTop(row, v)}"
					aria-hidden="true"
				>
					<KeyGlyph ease={undefined} />
				</span>
			{/if}
			{#each row.keys as k, i (i)}
				{@const at = row.offset + k.t}
				{#if at >= viewStart && at <= viewEnd}
					<button
						type="button"
						class="row-key"
						class:picked={isPicked({ row: row.id, t: k.t })}
						class:target={onTarget && keyframeAt([k], target!) !== null}
						style="left: {toPct(at)}%; top: {keyTop(row, k.v)}"
						title="{row.label}: {valueText(row, k.v)} at {formatTimeMs(
							at,
						)}{k.ease ? `. To the next key: ${easeLabel(k.ease)}` : ''}"
						aria-label="{row.label} key at {formatTimeMs(at)}"
						aria-pressed={isPicked({ row: row.id, t: k.t })}
						onpointerdown={(e) => onKeyDown(e, row, k.t)}
						oncontextmenu={(e) => openMenu(e, row, k.t)}
						onkeydown={(e) => onKeyKeydown(e, row, k.t)}
						ondblclick={(e) => {
							e.stopPropagation();
							openTyping(e, { row: row.id, t: k.t });
						}}
					>
						<KeyGlyph ease={k.ease} />
					</button>
				{/if}
			{/each}
		</div>
	</div>
{/each}

{#if readout}
	<DragReadout {...readout} />
{/if}

{#if typing}
	{@const ref = typing.ref}
	{@const row = rows.find((r) => r.id === ref.row)}
	{@const key = row && keyframeAt(row.keys, ref.t)}
	{#if row && key}
		<KeyEditPopover
			x={typing.x}
			y={typing.y}
			label={row.label}
			time={row.offset + key.t}
			value={key.v}
			onCommit={(time, value) => {
				const keys = setRowKey(row, key.t, time, value);
				if (keys === row.keys) return;
				onTracks(new Map([[row.id, keys]]));
				const moved = Math.max(
					0,
					Math.min(Math.max(time, row.from), row.to) - row.offset,
				);
				picked = [{ row: row.id, t: moved }];
				anchor = picked[0];
			}}
			onClose={() => (typing = null)}
		/>
	{/if}
{/if}

{#if menu}
	<!-- Fixed, so the lane's own overflow can't clip it. -->
	<ContextMenu x={menu.x} y={menu.y} onClose={() => (menu = null)}>
		<span class="menu-label">{EASE_HEADING}</span>
		{#each EASE_OPTIONS as option (option.label)}
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
		{#if selected.length === 1}
			<button
				type="button"
				role="menuitem"
				onclick={() => {
					const at = menu!;
					menu = null;
					typing = { x: at.x, y: at.y, ref: selected[0] };
				}}>Type its time and value…</button
			>
		{/if}
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
		{@const span =
			selected.length > 0
				? Math.max(...selected.map((p) => keyAt(p))) -
					Math.min(...selected.map((p) => keyAt(p)))
				: 0}
		{#each selected.length > 0 && bpm > 0 ? repeatsFor(span, 60 / bpm) : [] as option (option.beats)}
			<button
				type="button"
				role="menuitem"
				onclick={() => pick(() => repeatSelected(option.beats * (60 / bpm)))}
				>{option.label}</button
			>
		{/each}
	</ContextMenu>
{/if}

<style>
	.key-row {
		height: 30px;
	}

	.key-row.tall {
		height: 120px;
	}

	.row-size {
		display: inline-flex;
		flex-shrink: 0;
		margin-left: auto;
		padding: 0.1rem;
		color: var(--text-3);
		background: none;
		border: none;
		border-radius: var(--r-1);
		cursor: pointer;
		opacity: 0;
	}

	.key-gutter:hover .row-size,
	.row-size:focus-visible,
	.row-size.on {
		opacity: 1;
	}

	.row-size:hover,
	.row-size.on {
		color: var(--text);
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

	.row-key.picked {
		color: var(--text);
	}

	.row-key.picked :global(svg) {
		filter: drop-shadow(0 0 2px var(--row-color));
	}

	.row-key.target {
		outline: 1px dashed var(--text);
		outline-offset: -1px;
		border-radius: 50%;
	}

	.row-key.ghost {
		pointer-events: none;
		z-index: 1;
	}

	.row-key.ghost :global(svg) {
		fill: none;
		stroke: var(--row-color);
		stroke-width: 1.5;
		stroke-dasharray: 2 1.5;
		filter: none;
	}
</style>
