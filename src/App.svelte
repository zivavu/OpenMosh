<script lang="ts">
	import { onMount } from "svelte";
	import UploadScreen from "./lib/components/ui/UploadScreen.svelte";
	import ToastContainer from "./lib/components/ui/ToastContainer.svelte";
	import { lazy } from "./lib/lazy";

	import { GlRenderer } from "./lib/gl/renderer";
	import { openSavedSequence } from "./lib/editor/saved-sequences";
	import { openSession, type SingleSessionState } from "./lib/editor/sessions";
	import type { SessionMode } from "./lib/editor/sequence-media-store";
	import type { SlideshowConfig } from "./lib/slideshow/types";
	import { showToast } from "./lib/components/ui/toast.svelte";
	import { isFeedbackOpen } from "./lib/components/ui/feedback.svelte";
	import { loadCustomFonts } from "./lib/text-overlay";

	// The editors are the bulk of the bundle and none of it is needed to paint
	// the upload screen, so they load with the route instead of with the app.
	const loadEditor = lazy(() => import("./lib/components/editor/Editor.svelte"));
	const loadSlideshowEditor = lazy(
		() => import("./lib/components/slideshow/SlideshowEditor.svelte"),
	);
	const loadFeedbackModal = lazy(
		() => import("./lib/components/ui/FeedbackModal.svelte"),
	);

	let file: File | null = $state(null);
	let sequenceFiles: File[] = $state([]);
	/** Set when sequence mode was opened from a saved song. */
	let sequenceTrackId: string | null = $state(null);
	let slideshowFiles: File[] = $state([]);
	let pendingAudioFile: File | null = $state(null);
	/** Editor state carried in from a reopened session, cleared on exit. */
	let restoredSingle: SingleSessionState | null = $state(null);
	/** Media the restored session's layers draw from, alongside its source. */
	let restoredSingleExtras: File[] = $state([]);
	let restoredSlideshowConfig: SlideshowConfig | null = $state(null);
	/** Library id of the song a reopened session was keyed to. */
	let sessionTrackId: string | null = $state(null);

	// Named for what each view *is*, not for the route it answers to — the two
	// stopped matching when the segment editor took the "#editor" name.
	type View = "upload" | "single" | "sequence" | "slideshow";

	/**
	 * The segment editor is "#editor" now: it grew from sequencing presets over
	 * one video into the mode that does nearly everything, and the single-image
	 * view it took the name from is the narrow one.
	 *
	 * Internally it is still "sequence" everywhere, and deliberately so — the
	 * mode's saved timelines, media pool and sessions are all keyed under that
	 * word, and renaming it would orphan them.
	 */
	const VIEW_HASH: Record<View, string> = {
		upload: "#",
		single: "#single",
		sequence: "#editor",
		slideshow: "#slideshow",
	};

	function hashToView(hash: string): View {
		switch (hash) {
			case "#slideshow":
				return "slideshow";
			// "#sequence" is the route this mode used to answer to; kept so links
			// and bookmarks from before the rename still land in it.
			case "#editor":
			case "#sequence":
				return "sequence";
			case "#single":
				return "single";
			default:
				return "upload";
		}
	}

	let view: View = $state(hashToView(window.location.hash));

	function navigateTo(v: View) {
		history.pushState(null, "", VIEW_HASH[v]);
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

	/** Warm the editor chunks once the upload screen goes idle, so picking a
	 * mode doesn't wait on the network. */
	function prefetchEditors() {
		const pull = () => {
			void loadEditor();
			void loadSlideshowEditor();
		};
		if ("requestIdleCallback" in window) {
			requestIdleCallback(pull, { timeout: 3000 });
		} else {
			setTimeout(pull, 2000);
		}
	}

	function resetFiles() {
		file = null;
		sequenceFiles = [];
		sequenceTrackId = null;
		pendingAudioFile = null;
		slideshowFiles = [];
		restoredSingle = null;
		restoredSingleExtras = [];
		restoredSlideshowConfig = null;
		sessionTrackId = null;
	}

	/** Reopen a saved single or slideshow edit: its media and the work done. */
	async function openSessionByKey(mode: SessionMode, key: string) {
		const opened = await openSession(key);
		if (!opened) {
			showToast("That session's media is no longer stored", 'error');
			return;
		}
		// The song comes back too, so the per-song text timeline and segments
		// the editor restores have the track they're keyed to.
		pendingAudioFile = opened.trackFile;
		sessionTrackId = opened.trackId;
		if (mode === 'single') {
			restoredSingle = opened.state as SingleSessionState;
			restoredSingleExtras = opened.files.slice(1);
			file = opened.files[0];
			navigateTo('single');
			return;
		}
		const state = opened.state as { config?: SlideshowConfig } | null;
		restoredSlideshowConfig = state?.config ?? null;
		slideshowFiles = opened.files;
		navigateTo('slideshow');
	}

	/** Reopen a song's saved sequence: its media becomes the pool, and the song
	 * itself is handed over as the already-known library track. */
	async function openSequenceFromSong(trackId: string) {
		const opened = await openSavedSequence(trackId);
		if (!opened) {
			showToast("That song's media is no longer stored", 'error');
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
		// Text layers and captions can be restored with a user font already
		// selected, so their faces have to be registered before anything draws.
		void loadCustomFonts();

		const onPopState = () => {
			view = hashToView(window.location.hash);
			if (view === "upload") {
				resetFiles();
				scheduleWarm();
			}
		};
		window.addEventListener("popstate", onPopState);

		scheduleWarm();
		prefetchEditors();

		return () => {
			cancelWarm();
			window.removeEventListener("popstate", onPopState);
		};
	});
</script>

{#if view === 'slideshow' && slideshowFiles.length > 0}
	{#await loadSlideshowEditor() then SlideshowEditor}
		<SlideshowEditor
			initialFiles={slideshowFiles}
			initialAudioFile={pendingAudioFile}
			initialTrackId={sessionTrackId}
			initialConfig={restoredSlideshowConfig}
			{warmCanvas}
			{warmRenderer}
			onExit={exitToUpload}
		/>
	{/await}
{:else if view === 'sequence' && sequenceFiles.length > 0}
	{#await loadEditor() then Editor}
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
	{/await}
{:else if view === 'single' && file}
	{#await loadEditor() then Editor}
		<Editor
			{file}
			initialAudioFile={pendingAudioFile}
			initialTrackId={sessionTrackId}
			initialSession={restoredSingle}
			extraFiles={restoredSingleExtras}
			onfile={(f: File) => (file = f)}
			{warmCanvas}
			{warmRenderer}
			onExit={exitToUpload}
		/>
	{/await}
{:else}
	<UploadScreen
		onfile={(f: File) => {
			file = f;
			navigateTo('single');
		}}
		onSequence={(files: File[]) => {
			sequenceFiles = files;
			navigateTo('sequence');
		}}
		onSequenceFromSong={(trackId: string) => void openSequenceFromSong(trackId)}
		onSessionOpen={(mode: SessionMode, key: string) =>
			void openSessionByKey(mode, key)}
		onSlideshow={(files: File[]) => {
			slideshowFiles = files;
			navigateTo('slideshow');
		}}
		onaudio={(f: File) => (pendingAudioFile = f)}
		{warmCanvas}
		{warmRenderer}
	/>
{/if}

{#if isFeedbackOpen()}
	{#await loadFeedbackModal() then FeedbackModal}
		<FeedbackModal />
	{/await}
{/if}

<ToastContainer />
