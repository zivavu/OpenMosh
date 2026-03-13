<script lang="ts">
	import UploadScreen from './lib/components/ui/UploadScreen.svelte';
	import Editor from './lib/components/editor/Editor.svelte';
	import SlideshowEditor from './lib/components/slideshow/SlideshowEditor.svelte';

	let file: File | null = $state(null);
	let slideshowFiles: File[] = $state([]);
	let pendingAudioFile: File | null = $state(null);
</script>

{#if slideshowFiles.length > 0}
	<SlideshowEditor
		initialFiles={slideshowFiles}
		initialAudioFile={pendingAudioFile}
		onBack={() => {
			slideshowFiles = [];
			pendingAudioFile = null;
		}}
	/>
{:else if file}
	<Editor
		{file}
		initialAudioFile={pendingAudioFile}
		onBack={() => {
			file = null;
			pendingAudioFile = null;
		}}
		onfile={(f) => (file = f)}
	/>
{:else}
	<UploadScreen
		onfile={(f) => (file = f)}
		onSlideshow={(files) => {
			slideshowFiles = files;
		}}
		onaudio={(f) => (pendingAudioFile = f)}
	/>
{/if}
