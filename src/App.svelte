<script lang="ts">
	import { onMount } from "svelte";
	import UploadScreen from "./lib/components/ui/UploadScreen.svelte";
	import ToastContainer from "./lib/components/ui/ToastContainer.svelte";
	import Editor from "./lib/components/editor/Editor.svelte";
	import SlideshowEditor from "./lib/components/slideshow/SlideshowEditor.svelte";

	import { GlRenderer } from "./lib/gl/renderer";
	import { openSavedSequence } from "./lib/editor/saved-sequences";
	import { showToast } from "./lib/components/ui/toast.svelte";

	let file: File | null = $state(null);
	let sequenceFiles: File[] = $state([]);
	/** Set when sequence mode was opened from a saved song. */
	let sequenceTrackId: string | null = $state(null);
	let slideshowFiles: File[] = $state([]);
	let pendingAudioFile: File | null = $state(null);

	type View = "upload" | "editor" | "sequence" | "slideshow";

	function hashToView(hash: string): View {
		if (hash === "#slideshow") return "slideshow";
		if (hash === "#sequence") return "sequence";
		if (hash === "#editor") return "editor";
		return "upload";
	}

	let view: View = $state(hashToView(window.location.hash));

	function navigateTo(v: View) {
		const hash = v === "upload" ? "#" : `#${v}`;
		history.pushState(null, "", hash);
		// A warmup still queued would land after the editor already built its own
		// context, leaving a stray hidden one behind.
		if (v !== "upload") cancelWarm();
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

	let warmRaf = 0;
	let warmTimer = 0;

	function cancelWarm() {
		if (warmRaf) cancelAnimationFrame(warmRaf);
		if (warmTimer) clearTimeout(warmTimer);
		warmRaf = 0;
		warmTimer = 0;
	}

	/** Linking every shader stalls the main thread, so warm up only after the
	 * upload screen has had a frame to paint. Its demo starts on nulls anyway. */
	function scheduleWarm() {
		cancelWarm();
		disposeWarm();
		warmRaf = requestAnimationFrame(() => {
			warmRaf = 0;
			warmTimer = window.setTimeout(createWarm, 0);
		});
	}

	function resetFiles() {
		file = null;
		sequenceFiles = [];
		sequenceTrackId = null;
		pendingAudioFile = null;
		slideshowFiles = [];
	}

	/** Reopen a song's saved sequence: its media becomes the pool, and the song
	 * itself is handed over as the already-known library track. */
	async function openSequenceFromSong(trackId: string) {
		const opened = await openSavedSequence(trackId);
		if (!opened) {
			showToast("That sequence's media is no longer stored", 'error');
			return;
		}
		sequenceFiles = opened.sources;
		pendingAudioFile = opened.trackFile;
		sequenceTrackId = opened.trackId;
		navigateTo('sequence');
	}

	function exitToUpload() {
		navigateTo("upload");
		resetFiles();
		scheduleWarm();
	}

	onMount(() => {
		const onPopState = () => {
			view = hashToView(window.location.hash);
			if (view === "upload") {
				resetFiles();
				scheduleWarm();
			}
		};
		window.addEventListener("popstate", onPopState);

		scheduleWarm();

		return () => {
			cancelWarm();
			window.removeEventListener("popstate", onPopState);
		};
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
{:else if view === 'sequence' && sequenceFiles.length > 0}
	<Editor
		mode="sequence"
		file={sequenceFiles[0]}
		extraFiles={sequenceFiles.slice(1)}
		initialAudioFile={pendingAudioFile}
		initialTrackId={sequenceTrackId}
		onfile={(f: File) => (sequenceFiles = [f, ...sequenceFiles.slice(1)])}
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
		onSequence={(files: File[]) => {
			sequenceFiles = files;
			navigateTo('sequence');
		}}
		onSequenceFromSong={(trackId: string) => void openSequenceFromSong(trackId)}
		onSlideshow={(files: File[]) => {
			slideshowFiles = files;
			navigateTo('slideshow');
		}}
		onaudio={(f: File) => (pendingAudioFile = f)}
		{warmCanvas}
		{warmRenderer}
	/>
{/if}

<ToastContainer />
