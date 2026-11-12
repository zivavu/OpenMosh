/** The rows that open under a lane, one per animated setting: what they show, and
 * how an edit made on one goes back to the clip or the lane it belongs to. */

import { keyframeAt, putKeyframe, type Keyframe } from "../keyframes";
import { getDefinition } from "../effects/hydrate";
import { setParamTrack } from "../effects/param-keys";
import { setChainGroupCurve } from "../effects/param-groups";
import type { KeyLink } from "../key-groups";
import type { EffectInstance } from "../effects/types";
import {
	PLACEMENT_KEYS,
	setLaneTrack,
	type PlacementKey,
} from "../media/lane-keys";
import type { MediaLane } from "../media/types";

export interface KeyRow {
	id: string;
	label: string;
	color: string;
	keys: Keyframe<number>[];
	/** The value's range, which the row's height spans. */
	min: number;
	max: number;
	step: number;
	/** Timeline seconds a key's `t` counts from. */
	offset: number;
	/** Where on the timeline the row's keys can sit. */
	from: number;
	to: number;
	/** The effect to open in the panel when the row's name is clicked. */
	instanceId?: string;
}

export type RowTracks = Map<string, Keyframe<number>[]>;

const PALETTE = [
	"#4fd1c5",
	"#f6ad55",
	"#b794f4",
	"#f687b3",
	"#68d391",
	"#63b3ed",
	"#fc8181",
	"#faf089",
];

export function rowColor(index: number): string {
	return PALETTE[index % PALETTE.length];
}

/** A group keeps one colour wherever it shows: its chip in the panel, its row. */
export function groupColor(group: string): string {
	let n = 0;
	for (const c of group) n = n * 26 + (c.charCodeAt(0) - 64);
	return PALETTE[(n + 2) % PALETTE.length];
}

const GROUP_ROW = "group:";

const EFFECT_ROW = "fx:";
const LANE_ROW = "lane:";

function effectRowId(instanceId: string, param: string): string {
	return `${EFFECT_ROW}${instanceId}:${param}`;
}

/** One row per keyed slider in the clip's chain, in chain order. A second copy of
 * an effect is numbered, so its rows can be told apart. */
export function chainKeyRows(
	clip: { start: number; end: number; effects: EffectInstance[] },
	firstColor = 0,
): KeyRow[] {
	const rows: KeyRow[] = [];
	const seen = new Map<string, number>();
	for (const effect of clip.effects) {
		const copy = (seen.get(effect.defId) ?? 0) + 1;
		seen.set(effect.defId, copy);
		if (!effect.keys) continue;
		const def = getDefinition(effect.defId);
		if (!def) continue;
		const name = copy > 1 ? `${def.name} ${copy}` : def.name;
		for (const param of def.params) {
			const keys = effect.keys[param.key];
			if (param.type !== "range" || !keys?.length) continue;
			rows.push({
				id: effectRowId(effect.instanceId, param.key),
				label: `${name} · ${param.label}`,
				color: rowColor(firstColor + rows.length),
				keys,
				min: param.min,
				max: param.max,
				step: param.step,
				offset: clip.start,
				from: clip.start,
				to: clip.end,
				instanceId: effect.instanceId,
			});
		}
	}
	for (const [group, members] of chainGroups(clip.effects)) {
		rows.push({
			id: `${GROUP_ROW}${group}`,
			label: `Group ${group} · ${members.length} ${members.length === 1 ? "setting" : "settings"}`,
			color: groupColor(group),
			keys: members[0].link.keys,
			min: 0,
			max: 1,
			step: 0,
			offset: clip.start,
			from: clip.start,
			to: clip.end,
			instanceId: members[0].instanceId,
		});
	}
	return rows;
}

/** The chain's groups and the sliders in each, by group name. */
function chainGroups(
	effects: EffectInstance[],
): Map<string, { instanceId: string; link: KeyLink }[]> {
	const groups = new Map<string, { instanceId: string; link: KeyLink }[]>();
	for (const e of effects)
		for (const link of Object.values(e.keyLinks ?? {})) {
			const list = groups.get(link.group) ?? [];
			list.push({ instanceId: e.instanceId, link });
			groups.set(link.group, list);
		}
	return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)));
}

const PLACEMENT_ROWS: Record<
	PlacementKey,
	{ label: string; min: number; max: number; step: number }
> = {
	x: { label: "X", min: -0.5, max: 1.5, step: 0.005 },
	y: { label: "Y", min: -0.5, max: 1.5, step: 0.005 },
	scale: { label: "Scale", min: 0.05, max: 3, step: 0.01 },
	scaleX: { label: "Scale X", min: -3, max: 3, step: 0.01 },
	scaleY: { label: "Scale Y", min: -3, max: 3, step: 0.01 },
	rotation: { label: "Rotation", min: -180, max: 180, step: 1 },
	opacity: { label: "Opacity", min: 0, max: 1, step: 0.01 },
};

/** One row per keyed placement value, on the whole timeline. */
export function laneKeyRows(lane: MediaLane, firstColor = 0): KeyRow[] {
	const rows: KeyRow[] = [];
	for (const key of PLACEMENT_KEYS) {
		const keys = lane.keys?.[key];
		if (!keys?.length) continue;
		const { label, min, max, step } = PLACEMENT_ROWS[key];
		rows.push({
			id: `${LANE_ROW}${key}`,
			label: `Layer · ${label}`,
			color: rowColor(firstColor + rows.length),
			keys,
			min,
			max,
			step,
			offset: 0,
			from: 0,
			to: Infinity,
		});
	}
	return rows;
}

/** The chain with edited rows written back; a row emptied stops its slider animating. */
export function withChainTracks(
	effects: EffectInstance[],
	tracks: RowTracks,
): EffectInstance[] {
	let grouped = effects;
	for (const [id, keys] of tracks)
		if (id.startsWith(GROUP_ROW))
			grouped = setChainGroupCurve(grouped, id.slice(GROUP_ROW.length), keys);
	return grouped.map((e) => {
		let next = e;
		for (const [id, keys] of tracks) {
			if (!id.startsWith(`${EFFECT_ROW}${e.instanceId}:`)) continue;
			const param = id.slice(EFFECT_ROW.length + e.instanceId.length + 1);
			const before = next.keys?.[param];
			next = setParamTrack(next, param, keys);
			if (keys.length === 0 && before?.length)
				next = { ...next, values: { ...next.values, [param]: before[0].v } };
		}
		return next;
	});
}

export function withLaneTracks(lane: MediaLane, tracks: RowTracks): MediaLane {
	let next = lane;
	for (const [id, keys] of tracks) {
		if (!id.startsWith(LANE_ROW)) continue;
		next = setLaneTrack(next, id.slice(LANE_ROW.length) as PlacementKey, keys);
	}
	return next;
}

/** Whether any of the edits belong to a lane's own rows rather than a clip's. */
export function touchesLane(tracks: RowTracks): boolean {
	return [...tracks.keys()].some((id) => id.startsWith(LANE_ROW));
}

/** A key on a row, by its row and its time. */
export interface KeyRef {
	row: string;
	t: number;
}

const SAME = 1e-3;

export function sameKey(a: KeyRef, b: KeyRef): boolean {
	return a.row === b.row && Math.abs(a.t - b.t) <= SAME;
}

/** A value held to the row's range and on its step. */
export function rowValue(row: KeyRow, v: number): number {
	const snapped =
		row.step > 0
			? Math.round((v - row.min) / row.step) * row.step + row.min
			: v;
	return Math.min(row.max, Math.max(row.min, snapped));
}

/** The picked keys moved `dt` seconds and `dn` of each row's height, from the rows
 * as they were when the drag began. The whole selection stops at the first span
 * edge any of it meets, so keys keep their spacing. */
export function dragKeys(
	rows: KeyRow[],
	picked: KeyRef[],
	dt: number,
	dn: number,
): { tracks: RowTracks; picked: KeyRef[] } {
	let lo = -Infinity;
	let hi = Infinity;
	for (const p of picked) {
		const row = rows.find((r) => r.id === p.row);
		if (!row) continue;
		const at = row.offset + p.t;
		lo = Math.max(lo, row.from - at);
		hi = Math.min(hi, row.to - at);
	}
	const step = Math.min(Math.max(dt, lo), hi);
	const tracks: RowTracks = new Map();
	const moved: KeyRef[] = [];
	for (const row of rows) {
		const mine = picked.filter((p) => p.row === row.id);
		if (mine.length === 0) continue;
		const isPicked = (k: Keyframe<number>) =>
			mine.some((p) => Math.abs(p.t - k.t) <= SAME);
		let out = row.keys.filter((k) => !isPicked(k));
		for (const k of row.keys.filter(isPicked)) {
			const t = k.t + step;
			const v = rowValue(row, k.v + dn * (row.max - row.min));
			out = putKeyframe(out, t, v);
			if (k.ease) keyframeAt(out, Math.max(0, t))!.ease = k.ease;
			moved.push({ row: row.id, t: Math.max(0, t) });
		}
		tracks.set(row.id, out);
	}
	return { tracks, picked: moved };
}

/** Every key between two picks: the rows from one to the other, the times between. */
export function pickRange(rows: KeyRow[], a: KeyRef, b: KeyRef): KeyRef[] {
	const ia = rows.findIndex((r) => r.id === a.row);
	const ib = rows.findIndex((r) => r.id === b.row);
	if (ia < 0 || ib < 0) return [b];
	const ra = rows[ia];
	const rb = rows[ib];
	const from = Math.min(ra.offset + a.t, rb.offset + b.t) - SAME;
	const to = Math.max(ra.offset + a.t, rb.offset + b.t) + SAME;
	const out: KeyRef[] = [];
	for (const row of rows.slice(Math.min(ia, ib), Math.max(ia, ib) + 1))
		for (const k of row.keys) {
			const at = row.offset + k.t;
			if (at >= from && at <= to) out.push({ row: row.id, t: k.t });
		}
	return out;
}
