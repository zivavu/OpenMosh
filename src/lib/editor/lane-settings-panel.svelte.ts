/** The mosh settings panel's target: the lane of the selected fx or layer clip, or an
 * fx lane picked by name, and the rest of the selection's lanes with it. With none it
 * edits the editor's own settings. */

import type { AudioResponse } from "../audio/auto-range";
import type { MediaClip, MediaLane, MediaTimeline } from "../media";
import type { ChainTimelineState } from "./chain-timeline-state.svelte";
import type { FxLaneState } from "./fx-lane-state.svelte";
import { findFxClip, type FxLane, type FxLaneSettings } from "./fx-lanes";

type PanelLane = FxLane | MediaLane;
export type LaneSettingKey = Exclude<keyof FxLaneSettings, "audioResponse">;

export interface LaneSettingsPanelHost {
	/** Editor mode; single mode has no lanes to aim at. */
	active(): boolean;
	fx: FxLaneState;
	media: ChainTimelineState<MediaTimeline, MediaLane, MediaClip>;
	/** The editor's own settings, copied: what a lane without its own starts from. */
	editorSettings(): FxLaneSettings;
	setEditorSetting<K extends LaneSettingKey>(
		key: K,
		value: FxLaneSettings[K],
	): void;
	setEditorResponse(key: keyof AudioResponse, value: number): void;
}

export class LaneSettingsPanel {
	readonly #host: LaneSettingsPanelHost;

	lane = $derived.by(() => this.#lane());
	/** Every lane an edit reaches: the panel's, then the rest of the selection's. */
	lanes = $derived.by(() => this.#lanes());

	constructor(host: LaneSettingsPanelHost) {
		this.#host = host;
	}

	#lane(): PanelLane | null {
		const { fx, media } = this.#host;
		if (!this.#host.active()) return null;
		const byClip = findFxClip(fx.lanes, fx.selectedClipId)?.lane;
		if (byClip) return byClip;
		return (
			fx.lanes.find((l) => l.id === fx.selectedLaneId) ?? media.selectedLane
		);
	}

	#lanes(): PanelLane[] {
		const { fx, media } = this.#host;
		const lane = this.lane;
		if (!lane) return [];
		const rest: PanelLane[] = findFxClip(fx.lanes, fx.selectedClipId)
			? fx.lanes.filter((l) =>
					l.clips.some((c) => fx.selectedClipIds.includes(c.id)),
				)
			: lane === media.selectedLane
				? media.timeline.lanes.filter((l) =>
						media.selectedLaneIds.includes(l.id),
					)
				: [];
		return [lane, ...rest.filter((l) => l.id !== lane.id)];
	}

	/** The lane's value, or the editor's for lanes without settings yet. */
	get<K extends LaneSettingKey>(key: K): FxLaneSettings[K] {
		return this.lane?.settings?.[key] ?? this.#host.editorSettings()[key];
	}

	/** Writes to the targeted lanes, else the editor's settings. */
	set<K extends LaneSettingKey>(key: K, value: FxLaneSettings[K]) {
		if (this.lanes.length === 0) {
			this.#host.setEditorSetting(key, value);
			return;
		}
		for (const lane of this.lanes) {
			lane.settings = {
				...(lane.settings ?? this.#host.editorSettings()),
				[key]: value,
			};
		}
	}

	response(key: keyof AudioResponse): number {
		return (
			this.lane?.settings?.audioResponse[key] ??
			this.#host.editorSettings().audioResponse[key]
		);
	}

	setResponse(key: keyof AudioResponse, value: number) {
		if (this.lanes.length === 0) {
			this.#host.setEditorResponse(key, value);
			return;
		}
		for (const lane of this.lanes) {
			const settings = lane.settings ?? this.#host.editorSettings();
			lane.settings = {
				...settings,
				audioResponse: { ...settings.audioResponse, [key]: value },
			};
		}
	}

	/** Hand the lanes back to the editor's settings, so the panel reads those again. */
	followEditor = () => {
		for (const lane of this.lanes) lane.settings = undefined;
	};
}
