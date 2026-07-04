<script lang="ts">
	import { onMount } from "svelte";
	import UploadScreen from "./lib/components/ui/UploadScreen.svelte";
	import ToastContainer from "./lib/components/ui/ToastContainer.svelte";
	import Editor from "./lib/components/editor/Editor.svelte";
	import SlideshowEditor from "./lib/components/slideshow/SlideshowEditor.svelte";

	import { GlRenderer } from "./lib/gl/renderer";

	let file: File | null = $state(null);
	let slideshowFiles: File[] = $state([]);
	let pendingAudioFile: File | null = $state(null);

	type View = "upload" | "editor" | "slideshow";

	function hashToView(hash: string): View {
		if (hash === "#slideshow") return "slideshow";
		if (hash === "#editor") return "editor";
		return "upload";
	}

	let view: View = $state(hashToView(window.location.hash));

	function navigateTo(v: View) {
		const hash = v === "upload" ? "#" : `#${v}`;
		history.pushState(null, "", hash);
		view = v;
	}

	let warmCanvas: HTMLCanvasElement | null = $state(null);
	let warmRenderer: GlRenderer | null = $state(null);

	/** Destroy the current warm renderer/canvas (if any) so contexts don't accumulate. */
	function disposeWarm() {
		try {
			warmRenderer?.destroy();
		} catch {
			// already destroyed / context already lost
		}
		if (warmCanvas?.parentNode) {
			warmCanvas.parentNode.removeChild(warmCanvas);
		}
		warmCanvas = null;
		warmRenderer = null;
	}

	function createWarm() {
		disposeWarm();
		try {
			const w = GlRenderer.warmup();
			warmCanvas = w.canvas;
			warmRenderer = w.renderer;
		} catch {
			// WebGL2 not available; Editor will fall back to creating its own context
		}
	}

	function exitToUpload() {
		navigateTo("upload");
		file = null;
		slideshowFiles = [];
		createWarm();
	}

	onMount(() => {
		const onPopState = () => {
			view = hashToView(window.location.hash);
			if (view === "upload") {
				file = null;
				slideshowFiles = [];
				createWarm();
			}
		};
		window.addEventListener("popstate", onPopState);

		createWarm();

		return () => window.removeEventListener("popstate", onPopState);
	});
</script>

{#if view === 'slideshow' && slideshowFiles.length > 0}
	<SlideshowEditor
		initialFiles={slideshowFiles}
		initialAudioFile={pendingAudioFile}
		{warmCanvas}
		{warmRenderer}
		onExit={exitToUpload}
	/>
{:else if view === 'editor' && file}
	<Editor
		{file}
		initialAudioFile={pendingAudioFile}
		onfile={(f: File) => (file = f)}
		{warmCanvas}
		{warmRenderer}
		onExit={exitToUpload}
	/>
{:else}
	<UploadScreen
		onfile={(f: File) => {
			file = f;
			navigateTo('editor');
		}}
		onSlideshow={(files: File[]) => {
			slideshowFiles = files;
			navigateTo('slideshow');
		}}
		onaudio={(f: File) => (pendingAudioFile = f)}
	/>
{/if}

<ToastContainer />
