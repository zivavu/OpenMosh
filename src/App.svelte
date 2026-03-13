<script lang="ts">
	import { onMount } from 'svelte';
	import UploadScreen from './lib/components/ui/UploadScreen.svelte';
	import Editor from './lib/components/editor/Editor.svelte';
	import SlideshowEditor from './lib/components/slideshow/SlideshowEditor.svelte';
	import { GlRenderer } from './lib/gl/renderer';

	let file: File | null = $state(null);
	let slideshowFiles: File[] = $state([]);
	let pendingAudioFile: File | null = $state(null);

	type View = 'upload' | 'editor' | 'slideshow';

	function hashToView(hash: string): View {
		if (hash === '#slideshow') return 'slideshow';
		if (hash === '#editor') return 'editor';
		return 'upload';
	}

	let view: View = $state(hashToView(window.location.hash));

	function navigateTo(v: View) {
		const hash = v === 'upload' ? '#' : `#${v}`;
		history.pushState(null, '', hash);
		view = v;
	}

	let warmCanvas: HTMLCanvasElement | null = $state(null);
	let warmRenderer: GlRenderer | null = $state(null);

	onMount(() => {
		const onPopState = () => {
			view = hashToView(window.location.hash);
		};
		window.addEventListener('popstate', onPopState);

		const w = GlRenderer.warmup();
		warmCanvas = w.canvas;
		warmRenderer = w.renderer;

		return () => window.removeEventListener('popstate', onPopState);
	});
</script>

{#if view === 'slideshow' && slideshowFiles.length > 0}
	<SlideshowEditor
		initialFiles={slideshowFiles}
		initialAudioFile={pendingAudioFile}
		onBack={() => history.back()}
		{warmCanvas}
		{warmRenderer}
	/>
{:else if view === 'editor' && file}
	<Editor
		{file}
		initialAudioFile={pendingAudioFile}
		onBack={() => history.back()}
		onfile={(f) => (file = f)}
		{warmCanvas}
		{warmRenderer}
	/>
{:else}
	<UploadScreen
		onfile={(f) => {
			file = f;
			navigateTo('editor');
		}}
		onSlideshow={(files) => {
			slideshowFiles = files;
			navigateTo('slideshow');
		}}
		onaudio={(f) => (pendingAudioFile = f)}
	/>
{/if}
