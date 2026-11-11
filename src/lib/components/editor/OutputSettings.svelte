<script lang="ts">
	import type { ProjectSongChoice } from "../../editor/settings";
	import { layerHighlight } from "../../editor/layer-highlight.svelte";
	import type { SourceFit } from "../../gl/renderer";
	import Checkbox from "../ui/Checkbox.svelte";
	import ResizeSettings from "../ui/ResizeSettings.svelte";
	import SettingRow from "./SettingRow.svelte";

	interface Props {
		/** Editor mode: layer and project settings show too. */
		editor: boolean;
		showFps: boolean;
		projectSong: ProjectSongChoice;
		sourceFit: SourceFit;
		resizeWidth: number;
		resizeHeight: number;
		naturalWidth?: number;
		naturalHeight?: number;
	}

	let {
		editor,
		showFps = $bindable(),
		projectSong = $bindable(),
		sourceFit = $bindable(),
		resizeWidth = $bindable(),
		resizeHeight = $bindable(),
		naturalWidth,
		naturalHeight,
	}: Props = $props();
</script>

<div class="divider"></div>
<SettingRow label="Show FPS" for="show-fps">
	<Checkbox id="show-fps" bind:checked={showFps} />
</SettingRow>
{#if editor}
	<SettingRow
		label="Highlight selected layer"
		for="layer-highlight"
		title="Outline the shape of a layer on the preview when you select it, until the next mosh"
	>
		<Checkbox id="layer-highlight" bind:checked={layerHighlight.value} />
	</SettingRow>
	<SettingRow
		label="Project songs"
		for="project-song"
		title="What to do with a project's song when you add it with Add a project"
	>
		<select id="project-song" bind:value={projectSong}>
			<option value="ask">Ask each time</option>
			<option value="add">Always add</option>
			<option value="skip">Leave out</option>
		</select>
	</SettingRow>
{/if}
<SettingRow
	label="Fit sources"
	for="source-fit"
	title="How to fit sources that don't match the output aspect"
>
	<select id="source-fit" bind:value={sourceFit}>
		<option value="contain">Contain</option>
		<option value="cover">Cover</option>
		<option value="stretch">Stretch</option>
	</select>
</SettingRow>
<div class="divider"></div>
<ResizeSettings
	bind:width={resizeWidth}
	bind:height={resizeHeight}
	{naturalWidth}
	{naturalHeight}
/>

<style>
	.divider {
		height: 1px;
		background: var(--line);
		margin: 0.15rem 0;
	}
</style>
