<script lang="ts">
	import Checkbox from "./Checkbox.svelte";
	import {
		ArrowUpDown,
		Brush,
		ImageUp,
		Move,
		Pipette,
		ChevronDown,
		ChevronRight,
		ChevronUp,
		Copy,
		Eye,
		EyeOff,
		GripVertical,
		Lock,
		LockOpen,
		Music,
		Trash2,
		X,
	} from "lucide-svelte";
	import {
		FREQ_PRESETS,
		getDefinition,
		isParamVisible,
		type EffectInstance,
		type FreqBand,
		type VolumeLink,
	} from "../../effects";
	import type { SpectrumData } from "../../types";
	import { linkBand } from "../../editor/link-band.svelte";
	import { showSpectrum } from "../../editor/show-spectrum.svelte";
	import ColorPicker from "./ColorPicker.svelte";
	import FontSelect from "./FontSelect.svelte";
	import DualRangeSlider from "./DualRangeSlider.svelte";
	import RangeSlider from "./RangeSlider.svelte";
	import SpectrumDisplay from "./SpectrumDisplay.svelte";
	import {
		DEFAULT_AUDIO_RESPONSE,
		type AudioResponse,
	} from "../../audio/auto-range";
	import {
		MASK_LANE_CONTEXT,
		maskPaint,
		peekArea,
		type MaskPaintTarget,
		type ParamHistory,
	} from "../../effects/mask-paint.svelte";
	import {
		IMAGE_SHAPE_KEYS,
		readShape,
		SHAPE_KEYS,
		type ShapeValues,
	} from "../editor/mask-shape";
	import { getContext, onDestroy } from "svelte";
	import { isMaskEffect, maskAwaitingImage } from "../../effects/catalog/mask";
	import { maskFromImage } from "../../brush/mask-image";
	import { showToast } from "./toast.svelte";
	import { KEY_RANGE_MAX, KEY_SOFTNESS_MAX } from "../../color-key";
	import {
		parseKeys,
		serializeKeys,
		type ColorKey,
	} from "../../effects/mask-keys";

	export type { SpectrumData };

	/** Piecewise-linear mapping: 75% of slider (0 to 750) = 20 to 8000 Hz, 25%
	 * (750 to 1000) = 8000 to 20000 Hz */
	function sliderToFreq(s: number): number {
		if (s <= 750) return 20 + (s / 750) * (8000 - 20);
		return 8000 + ((s - 750) / 250) * (20000 - 8000);
	}

	function freqToSlider(hz: number): number {
		if (hz <= 8000) return ((hz - 20) / (8000 - 20)) * 750;
		return 750 + ((hz - 8000) / (20000 - 8000)) * 250;
	}

	const FREQ_PRESET_BUTTONS = [
		// Full stores no band on the link; it resolves to FREQ_PRESETS.full.
		{
			id: "full",
			label: "Full",
			title: "Full spectrum (20–16k Hz)",
			min: undefined,
			max: undefined,
		},
		{
			id: "low",
			label: "Low",
			title: "Low (20–500 Hz)",
			min: FREQ_PRESETS.low.min,
			max: FREQ_PRESETS.low.max,
		},
		{
			id: "mid",
			label: "Mid",
			title: "Mid (500–4000 Hz)",
			min: FREQ_PRESETS.mid.min,
			max: FREQ_PRESETS.mid.max,
		},
		{
			id: "high",
			label: "High",
			title: "High (4k–16k Hz)",
			min: FREQ_PRESETS.high.min,
			max: FREQ_PRESETS.high.max,
		},
	] as const satisfies {
		id: FreqBand;
		label: string;
		title: string;
		min?: number;
		max?: number;
	}[];

	interface Props {
		effect: EffectInstance;
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		/** How this chain follows the music; the spectrum read-out is drawn through
		 * it, so it shows the value the parameter actually rides. */
		response?: AudioResponse;
		onVolumeLinkChange?: (paramKey: string, link: VolumeLink | null) => void;
		onToggle: () => void;
		/** Locking keeps the effect as it is through every mosh, roll and clear. */
		onToggleLock?: () => void;
		/** Set when the chain's on/off state is not the user's to set (the slideshow's
		 * rolling modes decide it per beat). The switch still shows what is passing signal. */
		rolledNote?: string | null;
		/** Set when the whole list (order and params, not just the switches) is rebuilt by
		 * the roll, so reordering and opening params go away rather than sitting dead. */
		rolledChain?: boolean;
		onToggleExpand: () => void;
		/** Hide from the effect list (a persisted preference, not a chain edit). */
		onHide: () => void;
		onDuplicate: () => void;
		/** True when the chain holds other copies of this effect; hiding one copy
		 * would be a chain edit, so it removes instead. */
		isCopy?: boolean;
		onMove: (direction: -1 | 1, toEnd: boolean) => void;
		canMoveUp: boolean;
		canMoveDown: boolean;
		onParamChange: (
			key: string,
			value: number | string,
			history?: ParamHistory,
		) => void;
		isDragging: boolean;
		dropIndicator: "above" | "below" | null;
		onDragStart: (e: DragEvent) => void;
		onDragOver: (e: DragEvent) => void;
		onDragLeave: () => void;
		onDrop: (e: DragEvent) => void;
		onDragEnd: () => void;
		onTouchDragStart?: (e: TouchEvent) => void;
		effectIndex?: number;
	}

	let {
		effect,
		hasTrack = false,
		spectrumData = null,
		response = DEFAULT_AUDIO_RESPONSE,
		onVolumeLinkChange,
		onToggle,
		onToggleLock,
		rolledNote = null,
		rolledChain = false,
		onToggleExpand,
		onHide,
		onDuplicate,
		isCopy = false,
		onMove,
		canMoveUp,
		canMoveDown,
		onParamChange,
		isDragging = false,
		dropIndicator = null,
		onDragStart,
		onDragOver,
		onDragLeave,
		onDrop,
		onDragEnd,
		onTouchDragStart,
		effectIndex,
	}: Props = $props();

	const def = $derived(getDefinition(effect.defId));

	let canDrag = $state(false);

	const maskLane = getContext<(() => string | null) | undefined>(
		MASK_LANE_CONTEXT,
	);
	const painting = $derived(maskPaint.target?.instanceId === effect.instanceId);

	/** Hand the preview to a Mask tool, editing the params `current` and `commit`
	 * read and write. */
	function startTool(
		tool: MaskPaintTarget["tool"],
		current: () => string,
		commit: MaskPaintTarget["commit"],
		image?: MaskPaintTarget["image"],
	) {
		if (painting) {
			maskPaint.target = null;
			return;
		}
		if (!effect.enabled) onToggle();
		const shape = String(effect.values.shape);
		maskPaint.target = {
			instanceId: effect.instanceId,
			tool,
			shape,
			current,
			laneId: maskLane?.() ?? null,
			commit,
			image,
			alive: () =>
				effect.enabled &&
				effect.values.shape === shape &&
				!maskAwaitingImage(effect.values),
		};
	}

	/** The brush or the Key's picker: each edits one param. */
	function toggleTool(key: string, tool: "paint" | "keys") {
		startTool(
			tool,
			() => String(effect.values[key] ?? ""),
			(value, history) => onParamChange(key, value, history),
		);
	}

	const editableShape = $derived(
		isMaskEffect(effect) &&
			["ellipse", "rect", "gradient", "image"].includes(
				String(effect.values.shape),
			),
	);

	/** Moving and sizing on the preview: five params, written as one edit. */
	function toggleShapeEdit() {
		const image = effect.values.shape === "image";
		const keys = image ? IMAGE_SHAPE_KEYS : SHAPE_KEYS;
		startTool(
			"shape",
			() => JSON.stringify(readShape(effect.values, image)),
			(json, history) => {
				const next = JSON.parse(json) as ShapeValues;
				SHAPE_KEYS.forEach((k, i) =>
					onParamChange(keys[i], next[k], i === 0 ? history : "none"),
				);
			},
			image
				? () => ({
						url: String(effect.values.image ?? ""),
						fit: String(effect.values.fit),
					})
				: undefined,
		);
	}

	const IMAGE_EMPTY_HINT = "A black-and-white image or a cutout";
	const LOAD_MASK_HINT =
		"White areas get the effects and black areas don't. A cutout with a transparent background works too: the effects go on the part that's left.";

	/** A mask made elsewhere. A cutout starts out read by its transparency. */
	async function loadMask(key: string, input: HTMLInputElement) {
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		try {
			const { url, cutout } = await maskFromImage(file);
			if (!effect.enabled) onToggle();
			onParamChange(key, url, "new");
			onParamChange("channel", cutout ? "alpha" : "luma", "none");
			peekArea(effect.instanceId);
		} catch {
			showToast("Couldn't read that image as a mask", "error");
		}
	}

	const colorKeys = $derived(parseKeys(effect.values.keys));
	const keyIndex = $derived(
		Math.min(maskPaint.keyIndex, Math.max(0, colorKeys.length - 1)),
	);

	function setKey(key: string, i: number, patch: Partial<ColorKey>) {
		change(
			key,
			serializeKeys(
				colorKeys.map((k, j) => (j === i ? { ...k, ...patch } : k)),
			),
		);
	}

	/** Point the tint at one colour, or back at the whole Mask. */
	function focusKey(i: number | null) {
		if (i !== null) {
			maskPaint.keyFocus = { instanceId: effect.instanceId, index: i };
		} else if (maskPaint.keyFocus?.instanceId === effect.instanceId) {
			maskPaint.keyFocus = null;
		}
	}

	function removeKey(key: string, i: number) {
		focusKey(null);
		onParamChange(
			key,
			serializeKeys(colorKeys.filter((_, j) => j !== i)),
			"new",
		);
		peekArea(effect.instanceId);
		if (maskPaint.keyIndex >= i && maskPaint.keyIndex > 0) maskPaint.keyIndex--;
	}

	const isMask = $derived(isMaskEffect(effect));
	const areaShown = $derived(maskPaint.shownId === effect.instanceId);

	/** A param edit; on a Mask the area shows while it changes. */
	function change(key: string, value: number | string) {
		onParamChange(key, value);
		if (isMask) peekArea(effect.instanceId);
	}

	function toggleArea() {
		maskPaint.shownId = areaShown ? null : effect.instanceId;
		// Off has to look off at once, not wait for the pointer to leave.
		maskPaint.hoverId = null;
	}

	function toggleExpand() {
		if (effect.expanded && areaShown) maskPaint.shownId = null;
		onToggleExpand();
	}

	// A card that goes away (deleted, another clip picked) takes its painting with it.
	onDestroy(() => {
		if (painting) maskPaint.target = null;
		if (areaShown) maskPaint.shownId = null;
		if (maskPaint.hoverId === effect.instanceId) maskPaint.hoverId = null;
		focusKey(null);
	});

	function handleDragStart(e: DragEvent) {
		if (!canDrag) {
			e.preventDefault();
			return;
		}
		canDrag = false;
		onDragStart(e);
	}
</script>

{#if def}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="effect-item"
		class:enabled={effect.enabled}
		class:expanded={effect.expanded && !rolledChain}
		class:is-dragging={isDragging}
		class:drop-above={dropIndicator === "above"}
		class:drop-below={dropIndicator === "below"}
		data-effect-index={effectIndex}
		data-effect-id={effect.instanceId}
		draggable={canDrag}
		ondragstart={handleDragStart}
		ondragover={(e) => {
			e.preventDefault();
			onDragOver(e);
		}}
		ondragleave={onDragLeave}
		ondrop={(e) => {
			e.preventDefault();
			onDrop(e);
		}}
		ondragend={() => {
			canDrag = false;
			onDragEnd();
		}}
	>
		<!-- The rail runs the height of every strip, lit where signal passes, so the
		     chain reads as one continuous path down the panel. -->
		<div class="rail" aria-hidden="true">
			<span class="rail-index readout"
				>{String((effectIndex ?? 0) + 1).padStart(2, "0")}</span
			>
		</div>
		<div class="strip">
			<div class="header" role="group">
				{#if rolledChain}
					<span class="expand-trigger static"
						><span class="name">{def.name}</span></span
					>
				{:else}
					<button class="expand-trigger" onclick={toggleExpand}>
						<span class="expand-arrow" class:expanded={effect.expanded}>
							<ChevronRight size={12} />
						</span>
						<span class="name">{def.name}</span>
					</button>
				{/if}

				<div class="controls">
					<button
						class="icon-btn"
						onclick={onDuplicate}
						title="Duplicate: adds an independent copy below"
						aria-label="Duplicate effect"
					>
						<Copy size={13} />
					</button>

					{#if isCopy}
						<button
							class="icon-btn"
							onclick={onHide}
							title="Remove this copy"
							aria-label="Remove effect copy"
						>
							<Trash2 size={14} />
						</button>
					{:else}
						<button
							class="icon-btn"
							onclick={onHide}
							title="Hide from the list. It stays hidden next session; restore it under Hidden effects."
							aria-label="Hide effect"
						>
							<EyeOff size={14} />
						</button>
					{/if}

					{#if !rolledChain}
						<div class="move-btns">
							<button
								class="move-btn"
								disabled={!canMoveUp}
								onclick={(e) => onMove(-1, e.shiftKey)}
								title="Move up (shift-click to send it to the top)"
								aria-label="Move effect up"
							>
								<ChevronUp size={13} />
							</button>
							<button
								class="move-btn"
								disabled={!canMoveDown}
								onclick={(e) => onMove(1, e.shiftKey)}
								title="Move down (shift-click to send it to the bottom)"
								aria-label="Move effect down"
							>
								<ChevronDown size={13} />
							</button>
						</div>

						<span
							class="drag-handle"
							title="Drag to reorder"
							onmousedown={() => (canDrag = true)}
							onmouseup={() => (canDrag = false)}
							ontouchstart={onTouchDragStart}
						>
							<GripVertical size={14} />
						</span>
					{/if}
					{#if onToggleLock}
						<button
							class="icon-btn lock-btn"
							class:locked={effect.locked}
							onclick={onToggleLock}
							aria-pressed={effect.locked}
							title={effect.locked
								? "Locked: moshing leaves it exactly as it is. Click to let rolls change it again."
								: "Lock: keep this effect, on or off, with its settings, through every mosh"}
							aria-label={effect.locked ? "Unlock effect" : "Lock effect"}
						>
							{#if effect.locked}
								<Lock size={13} />
							{:else}
								<LockOpen size={13} />
							{/if}
						</button>
					{/if}
					<button
						class="toggle"
						class:on={effect.enabled}
						onclick={onToggle}
						disabled={!!rolledNote}
						title={rolledNote ?? (effect.enabled ? "Disable" : "Enable")}
					>
						<span class="toggle-knob"></span>
					</button>
				</div>
			</div>

			{#if effect.expanded && !rolledChain}
				<div class="params">
					{#if def.hint}
						<p class="effect-hint">{def.hint}</p>
					{/if}
					{#if isMask && !maskAwaitingImage(effect.values)}
						<div class="paint-btns mask-tools">
							<button
								type="button"
								class="paint-btn"
								class:active={areaShown}
								aria-pressed={areaShown}
								title="Keeps the Mask's area tinted on the preview. Hover here to see it without turning it on."
								onclick={toggleArea}
								onmouseenter={() => (maskPaint.hoverId = effect.instanceId)}
								onmouseleave={() => {
									if (maskPaint.hoverId === effect.instanceId)
										maskPaint.hoverId = null;
								}}
							>
								{#if areaShown}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
								Show area
							</button>
							{#if editableShape}
								<button
									type="button"
									class="paint-btn"
									class:active={painting}
									aria-pressed={painting}
									onclick={toggleShapeEdit}
								>
									<Move size={12} />
									{painting ? "Done" : "Edit shape"}
								</button>
							{/if}
						</div>
					{/if}
					{#each def.params.filter((p) => isParamVisible(p, effect)) as param}
						<div class="param-row">
							<label class="param-label" for="{effect.instanceId}-{param.key}"
								>{param.label}</label
							>
							{#if param.type === "range"}
								<div class="param-range-wrap">
									<RangeSlider
										id="{effect.instanceId}-{param.key}"
										value={+effect.values[param.key]}
										min={param.min}
										max={param.max}
										step={param.step}
										curve={param.curve}
										disabled={!!effect.volumeLinks?.[param.key]}
										oninput={(v) => change(param.key, v)}
										ondblclick={() => change(param.key, param.defaultValue)}
									/>
									<span class="param-value"
										>{parseFloat(effect.values[param.key].toString()).toFixed(
											2,
										)}</span
									>
									{#if hasTrack && onVolumeLinkChange}
										{#if effect.volumeLinks?.[param.key]}
											{const link = $derived(effect.volumeLinks[param.key])}
											<div class="volume-link-row">
												<span class="volume-link-label">Vol →</span>
												<div class="volume-link-slider">
													<DualRangeSlider
														min={param.min}
														max={param.max}
														step={param.step}
														valueLow={link.min}
														valueHigh={link.max}
														onChangeLow={(v) =>
															onVolumeLinkChange(param.key, {
																...link,
																min: v,
															})}
														onChangeHigh={(v) =>
															onVolumeLinkChange(param.key, {
																...link,
																max: v,
															})}
														formatValue={(v) =>
															parseFloat(v.toString()).toFixed(2)}
													/>
												</div>
												<button
													type="button"
													class="volume-invert-btn"
													class:active={link.inverted}
													title={link.inverted
														? "Inverted: low volume = high effect"
														: "Normal: high volume = high effect"}
													onclick={() =>
														onVolumeLinkChange(param.key, {
															...link,
															inverted: !link.inverted,
														})}
												>
													<ArrowUpDown size={12} />
												</button>
												<button
													type="button"
													class="volume-unlink-btn"
													title="Unlink from volume"
													onclick={() => onVolumeLinkChange(param.key, null)}
												>
													<X size={12} />
												</button>
											</div>
											<div class="volume-freq-row">
												<span class="volume-link-label">Freq</span>
												<div class="freq-presets">
													{#each FREQ_PRESET_BUTTONS as preset}
														<button
															type="button"
															class="freq-preset-btn"
															class:active={link.freqMin == preset.min &&
																link.freqMax == preset.max}
															title={preset.title}
															onclick={() => {
																onVolumeLinkChange(param.key, {
																	...link,
																	freqMin: preset.min,
																	freqMax: preset.max,
																});
																// Every next link, here or in any other panel, starts on it.
																linkBand.value = preset.id;
															}}>{preset.label}</button
														>
													{/each}
												</div>
											</div>
											{#if link.freqMin != null && link.freqMax != null && spectrumData}
												<div class="spectrum-wrap">
													{#if showSpectrum.value}
														<SpectrumDisplay
															data={spectrumData.data}
															sampleRate={spectrumData.sampleRate}
															binCount={spectrumData.binCount}
															freqMin={link.freqMin ?? FREQ_PRESETS.full.min}
															freqMax={link.freqMax ?? FREQ_PRESETS.full.max}
															{response}
															width={200}
															height={48}
														/>
													{/if}
													<div class="spectrum-inputs">
														<span class="spectrum-label">Freq</span>
														<div class="spectrum-slider">
															<DualRangeSlider
																min={0}
																max={1000}
																step={1}
																valueLow={freqToSlider(link.freqMin ?? 20)}
																valueHigh={freqToSlider(link.freqMax ?? 20000)}
																onChangeLow={(v) =>
																	onVolumeLinkChange(param.key, {
																		...link,
																		freqMin: sliderToFreq(v),
																	})}
																onChangeHigh={(v) =>
																	onVolumeLinkChange(param.key, {
																		...link,
																		freqMax: sliderToFreq(v),
																	})}
																formatValue={(v) =>
																	`${Math.round(sliderToFreq(v))} Hz`}
															/>
														</div>
													</div>
												</div>
											{/if}
										{:else}
											<button
												type="button"
												class="volume-link-btn"
												title="Link to music volume (the slider follows the volume within a range)"
												onclick={() =>
													onVolumeLinkChange(param.key, {
														min: param.min,
														max: param.max,
														...(linkBand.value === "full"
															? {}
															: {
																	freqMin: FREQ_PRESETS[linkBand.value].min,
																	freqMax: FREQ_PRESETS[linkBand.value].max,
																}),
													})}
											>
												<Music size={12} />
												Link
											</button>
										{/if}
									{/if}
								</div>
							{/if}
							{#if param.type === "checkbox"}
								<Checkbox
									id="{effect.instanceId}-{param.key}"
									checked={effect.values[param.key] === 1}
									onchange={(e) =>
										change(param.key, e.currentTarget.checked ? 1 : 0)}
								/>
							{/if}
							{#if param.type === "select" && param.fontPicker}
								<FontSelect
									id="{effect.instanceId}-{param.key}"
									value={String(effect.values[param.key])}
									onChange={(family) => change(param.key, family)}
								/>
							{:else if param.type === "select"}
								<select
									id="{effect.instanceId}-{param.key}"
									value={effect.values[param.key]}
									onchange={(e) => change(param.key, e.currentTarget.value)}
								>
									{#each param.options as opt}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							{/if}
							{#if param.type === "text"}
								<input
									id="{effect.instanceId}-{param.key}"
									class="text-input"
									type="text"
									value={effect.values[param.key]}
									maxlength={param.maxLength}
									placeholder={param.placeholder ?? ""}
									oninput={(e) => change(param.key, e.currentTarget.value)}
								/>
							{/if}
							{#if param.type === "keys"}
								<div class="paint-controls">
									<div class="paint-btns key-swatches">
										{#each colorKeys as k, i (i)}
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<span
												class="key-chip"
												class:selected={i === keyIndex}
												class:off={!k.on}
												onmouseenter={() => focusKey(i)}
												onmouseleave={() => focusKey(null)}
											>
												<button
													type="button"
													class="key-swatch"
													style:background={k.color}
													title="{k.color}. Hover to see only what this color selects."
													aria-label="Color {i + 1}{k.on ? '' : ', off'}"
													onclick={() => (maskPaint.keyIndex = i)}
												></button>
												<button
													type="button"
													class="key-del"
													aria-label="Remove color {i + 1}"
													onclick={() => removeKey(param.key, i)}
												>
													<X size={9} />
												</button>
											</span>
										{/each}
										<button
											type="button"
											class="paint-btn"
											class:active={painting}
											onclick={() => toggleTool(param.key, "keys")}
										>
											<Pipette size={12} />
											{painting ? "Done" : "Pick"}
										</button>
									</div>
									{#if colorKeys[keyIndex]}
										{@const k = colorKeys[keyIndex]}
										<label
											class="paint-setting"
											title="Turn this color off without deleting it"
										>
											<span>On</span>
											<Checkbox
												checked={k.on}
												onchange={(e) =>
													setKey(param.key, keyIndex, {
														on: e.currentTarget.checked,
													})}
											/>
										</label>
										<div class="paint-setting">
											<span>Color range</span>
											<RangeSlider
												value={k.range}
												min={0}
												max={KEY_RANGE_MAX}
												step={0.005}
												oninput={(v) =>
													setKey(param.key, keyIndex, { range: v })}
											/>
										</div>
										<div class="paint-setting">
											<span>Softness</span>
											<RangeSlider
												value={k.softness}
												min={0}
												max={KEY_SOFTNESS_MAX}
												step={0.005}
												oninput={(v) =>
													setKey(param.key, keyIndex, { softness: v })}
											/>
										</div>
										<label
											class="paint-setting"
											title="Take only the matching area that runs into this color's dot, not every match in the picture"
										>
											<span>Touching only</span>
											<Checkbox
												checked={k.touching}
												onchange={(e) =>
													setKey(param.key, keyIndex, {
														touching: e.currentTarget.checked,
													})}
											/>
										</label>
									{/if}
								</div>
							{/if}
							{#if param.type === "image"}
								<div class="paint-btns image-row">
									{#if effect.values[param.key]}
										<img
											class="image-thumb"
											src={String(effect.values[param.key])}
											alt="The loaded mask"
										/>
									{/if}
									<label class="paint-btn" title={LOAD_MASK_HINT}>
										<ImageUp size={12} />
										{effect.values[param.key] ? "Replace" : "Load"}
										<input
											type="file"
											accept="image/*"
											hidden
											onchange={(e) => loadMask(param.key, e.currentTarget)}
										/>
									</label>
									{#if !effect.values[param.key]}
										<span class="image-empty">{IMAGE_EMPTY_HINT}</span>
									{/if}
									{#if effect.values[param.key]}
										<button
											type="button"
											class="icon-btn"
											title="Remove the image"
											aria-label="Remove the image"
											onclick={() => change(param.key, "")}
										>
											<Trash2 size={14} />
										</button>
									{/if}
								</div>
							{/if}
							{#if param.type === "paint"}
								<div class="paint-controls">
									<div class="paint-btns">
										<button
											type="button"
											class="paint-btn"
											class:active={painting}
											onclick={() => toggleTool(param.key, "paint")}
										>
											<Brush size={12} />
											{painting ? "Done" : "Paint"}
										</button>
										{#if effect.values[param.key]}
											<button
												type="button"
												class="icon-btn"
												title="Clear the painting"
												aria-label="Clear the painting"
												onclick={() => change(param.key, "")}
											>
												<Trash2 size={14} />
											</button>
										{/if}
									</div>
									{#if painting}
										<div class="paint-setting">
											<span>Size</span>
											<RangeSlider
												value={maskPaint.size}
												min={0.01}
												max={0.5}
												step={0.01}
												oninput={(v) => (maskPaint.size = v)}
											/>
										</div>
										<div class="paint-setting">
											<span>Softness</span>
											<RangeSlider
												value={maskPaint.softness}
												min={0}
												max={1}
												step={0.01}
												oninput={(v) => (maskPaint.softness = v)}
											/>
										</div>
										<label class="paint-setting">
											<span>Erase</span>
											<Checkbox
												checked={maskPaint.erase}
												onchange={(e) =>
													(maskPaint.erase = e.currentTarget.checked)}
											/>
										</label>
									{/if}
								</div>
							{/if}
							{#if param.type === "color"}
								<ColorPicker
									id="{effect.instanceId}-{param.key}"
									value={String(effect.values[param.key])}
									defaultValue={param.defaultValue}
									onChange={(hex) => change(param.key, hex)}
								/>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.effect-item {
		display: flex;
		align-items: stretch;
		position: relative;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
	}

	/* Signal rail: dark when the effect is bypassed, lit when it passes signal. */
	.rail {
		position: relative;
		flex-shrink: 0;
		width: 30px;
		padding-top: 0.62rem;
		text-align: center;
	}

	.rail::after {
		content: "";
		position: absolute;
		top: 0;
		bottom: -1px;
		right: 0;
		width: 2px;
		border-radius: 1px;
		background: var(--line);
		transition:
			background var(--t),
			box-shadow var(--t);
	}

	.enabled .rail::after {
		background: var(--live);
		box-shadow: 0 0 10px rgba(110, 231, 192, 0.35);
	}

	.rail-index {
		font-size: 0.58rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		color: var(--text-4);
		transition: color var(--t);
	}

	.enabled .rail-index {
		color: var(--live-dim);
	}

	.strip {
		flex: 1;
		min-width: 0;
	}

	.effect-item.enabled {
		background: rgba(110, 231, 192, 0.024);
	}

	.effect-item.is-dragging {
		opacity: 0.35;
	}

	.effect-item.drop-above::before,
	.effect-item.drop-below::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--live);
		pointer-events: none;
		z-index: 5;
	}

	.effect-item.drop-above::before {
		top: -1px;
	}

	.effect-item.drop-below::after {
		bottom: -1px;
	}

	.header {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 0.45rem 0.55rem 0.45rem 0.6rem;
		gap: 0;
		color: var(--text-2);
		font-size: 0.78rem;
		transition: background var(--t-fast);
	}

	.header:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.enabled .header {
		color: var(--text);
	}

	.expand-trigger {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		color: inherit;
		font-family: inherit;
		font-size: inherit;
		cursor: pointer;
		padding: 0;
	}

	/* No drawer to open: keep the name in the same place, minus the affordance. */
	.expand-trigger.static {
		cursor: default;
		padding-left: 1.15rem;
	}

	.expand-arrow {
		display: flex;
		color: var(--text-4);
		transition:
			transform var(--t),
			color var(--t-fast);
		flex-shrink: 0;
		width: 0.7rem;
		text-align: center;
	}

	.expand-trigger:hover .expand-arrow {
		color: var(--text-2);
	}

	.expand-arrow.expanded {
		transform: rotate(90deg);
	}

	.name {
		flex: 1;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
		letter-spacing: 0.005em;
	}

	.enabled .name {
		font-weight: 600;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
	}

	/* Stacked so the pair costs one control's width, not two */
	.move-btns {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.move-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 11px;
		background: none;
		border: none;
		color: var(--text-4);
		cursor: pointer;
		border-radius: var(--r-2);
		padding: 0;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.move-btn:hover:not(:disabled) {
		color: var(--text);
		background: rgba(255, 255, 255, 0.07);
	}

	.move-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	/* Lit knob when the effect is passing signal. */
	.toggle {
		position: relative;
		width: 28px;
		height: 15px;
		border-radius: var(--r-pill);
		background: var(--sunken);
		border: 1px solid var(--line);
		cursor: pointer;
		padding: 0;
		margin-left: 0.3rem;
		transition:
			background var(--t),
			border-color var(--t);
	}

	/* Reporting, not controlling: dimmed so it doesn't invite a click, but not so
	   far that the live state stops reading. */
	.toggle:disabled {
		cursor: default;
		opacity: 0.55;
	}

	.toggle.on {
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.1);
	}

	.toggle-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--text-4);
		transition:
			transform var(--t),
			background var(--t),
			box-shadow var(--t);
	}

	.toggle.on .toggle-knob {
		transform: translateX(13px);
		background: var(--live);
		box-shadow: 0 0 6px rgba(110, 231, 192, 0.7);
	}

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		background: none;
		border: none;
		color: var(--text-4);
		cursor: pointer;
		border-radius: var(--r-2);
		padding: 0;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.icon-btn:hover {
		color: var(--text-2);
		background: rgba(255, 255, 255, 0.06);
	}

	.drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 22px;
		color: var(--text-4);
		cursor: grab;
		touch-action: none;
		user-select: none;
	}

	.drag-handle:hover {
		color: var(--text-2);
	}

	/* At rest a strip is its number, its name and its switch. The rest of the tools
	   keep their space but only show for the strip under the pointer, the one with
	   focus, or an open one, so the chain reads as a list rather than a control
	   panel. Touch has no hover, so there they are always on. */
	.icon-btn,
	.move-btns,
	.drag-handle {
		opacity: 0;
		transition: opacity var(--t-fast);
	}

	.effect-item:hover .icon-btn,
	.effect-item:hover .move-btns,
	.effect-item:hover .drag-handle,
	.effect-item:focus-within .icon-btn,
	.effect-item:focus-within .move-btns,
	.effect-item:focus-within .drag-handle,
	.effect-item.expanded .icon-btn,
	.effect-item.expanded .move-btns,
	.effect-item.expanded .drag-handle {
		opacity: 1;
	}

	/* A lock stays in sight: it changes what the next mosh does. */
	.effect-item .lock-btn.locked {
		opacity: 1;
		color: var(--mosh);
	}

	@media (pointer: coarse) {
		.icon-btn,
		.move-btns,
		.drag-handle {
			opacity: 1;
		}
	}

	.params {
		padding: 0.3rem 0.7rem 0.6rem 1.15rem;
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.param-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.35rem 0;
	}

	.param-row + .param-row {
		border-top: 1px solid rgba(255, 255, 255, 0.035);
		margin-top: 0.15rem;
		padding-top: 0.5rem;
	}

	.param-label {
		font-size: 0.7rem;
		font-weight: 400;
		letter-spacing: 0.01em;
		color: var(--text-3);
		min-width: 74px;
		flex-shrink: 0;
		padding-top: 0.1rem;
	}

	.param-value {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--text-2);
		min-width: 36px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.param-range-wrap {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.effect-hint {
		margin: 0 0 0.3rem;
		font-size: 0.66rem;
		line-height: 1.45;
		color: var(--text-3);
	}

	.image-row {
		flex: 1;
		min-width: 0;
		flex-wrap: wrap;
	}

	.image-empty {
		font-size: 0.64rem;
		line-height: 1.35;
		color: var(--text-3);
	}

	/* The mask on a checkerboard, so a cutout's see-through parts read as such. */
	.image-thumb {
		width: 32px;
		height: 22px;
		object-fit: contain;
		border: 1px solid var(--line);
		border-radius: 3px;
		background: repeating-conic-gradient(#3a3a3a 0 25%, #222 0 50%) 0 0 / 8px
			8px;
	}

	.mask-tools {
		margin-bottom: 0.3rem;
	}

	.paint-controls {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		flex: 1;
		min-width: 0;
	}

	.paint-btns {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.paint-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		white-space: nowrap;
		padding: 0.2rem 0.6rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-2);
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
	}

	.paint-btn:hover,
	.paint-btn.active {
		color: var(--live);
		border-color: var(--live-dim);
	}

	.key-swatches {
		flex-wrap: wrap;
		align-items: center;
	}

	.key-chip {
		position: relative;
		display: inline-flex;
	}

	.key-swatch {
		width: 20px;
		height: 20px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 4px;
		cursor: pointer;
	}

	/* A colour that's off: faded and struck through. */
	.key-chip.off .key-swatch {
		opacity: 0.35;
		background-image: linear-gradient(
			to top right,
			transparent calc(50% - 1px),
			var(--text-2) 50%,
			transparent calc(50% + 1px)
		) !important;
	}

	.key-chip.selected .key-swatch {
		border-color: var(--live);
		box-shadow: 0 0 0 1px var(--live);
	}

	.key-del {
		position: absolute;
		top: -5px;
		right: -5px;
		display: none;
		align-items: center;
		justify-content: center;
		width: 13px;
		height: 13px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: var(--ink);
		color: var(--text-2);
		cursor: pointer;
	}

	.key-chip:hover .key-del,
	.key-del:focus-visible {
		display: inline-flex;
	}

	.paint-setting {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.66rem;
		color: var(--text-3);
	}

	.paint-setting > span {
		min-width: 52px;
	}

	.paint-setting > :global(:not(span)) {
		flex: 1;
	}

	label.paint-setting > :global(:not(span)) {
		flex: none;
	}

	.volume-link-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.4rem;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-3);
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
		flex-shrink: 0;
	}

	.volume-link-btn:hover {
		color: var(--live);
		border-color: var(--live-dim);
	}

	.volume-link-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		margin-top: 0.25rem;
		padding-left: 0;
	}

	.volume-link-label {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--live-dim);
		flex-shrink: 0;
	}

	.volume-link-slider {
		flex: 1;
		min-width: 0;
	}

	.volume-invert-btn,
	.volume-unlink-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		background: none;
		border: 1px solid var(--line);
		border-radius: 50%;
		color: var(--text-3);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}

	.volume-invert-btn:hover,
	.volume-unlink-btn:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}

	.volume-invert-btn.active {
		color: var(--live);
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.12);
	}

	.volume-freq-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		margin-top: 0.2rem;
		flex-wrap: wrap;
	}

	.freq-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
	}

	.freq-preset-btn {
		padding: 0.1rem 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}

	.freq-preset-btn:hover {
		color: var(--text-2);
		border-color: var(--line-strong);
	}

	.freq-preset-btn.active {
		color: var(--live);
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.12);
	}

	.spectrum-wrap {
		width: 100%;
		margin-top: 0.35rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.spectrum-wrap :global(.spectrum-canvas) {
		width: 100%;
		max-width: 200px;
		height: 48px;
	}

	.spectrum-inputs {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.spectrum-label {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--live-dim);
		flex-shrink: 0;
	}

	.spectrum-slider {
		flex: 1;
		min-width: 0;
	}

	.param-row :global(.font-select) {
		flex: 1;
		min-width: 0;
	}

	select {
		flex: 1;
		background: var(--sunken);
		color: var(--text-2);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		padding: 0.25rem 0.45rem;
		font-family: var(--font-mono);
		font-size: 0.66rem;
		cursor: pointer;
		outline: none;
	}

	select:focus {
		border-color: var(--line-strong);
	}

	.text-input {
		flex: 1;
		min-width: 0;
		background: var(--sunken);
		color: var(--text);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		padding: 0.25rem 0.45rem;
		font-family: inherit;
		font-size: 0.72rem;
		outline: none;
	}

	.text-input:focus {
		border-color: var(--line-strong);
	}
</style>
