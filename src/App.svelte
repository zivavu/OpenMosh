<script lang="ts">
	import { onMount, untrack } from "svelte";
	import UploadScreen from "./lib/components/ui/UploadScreen.svelte";
	import ToastContainer from "./lib/components/ui/ToastContainer.svelte";
	import AppError from "./lib/components/ui/AppError.svelte";
	import { lazy } from "./lib/lazy";

	import { GlRenderer } from "./lib/gl/renderer";
	import { openSavedSequence } from "./lib/editor/saved-sequences";
	import { openSession, type SingleSessionState } from "./lib/editor/sessions";
	import {
		forgetLastOpened,
		readLastOpened,
		rememberLastOpened,
	} from "./lib/editor/last-opened";
	import type { SessionMode } from "./lib/editor/sequence-media-store";
	import type { SlideshowConfig } from "./lib/slideshow/types";
	import { showToast } from "./lib/components/ui/toast.svelte";
	import { gifsToVideo, gifToVideo } from "./lib/media/gif";
	import { isFeedbackOpen } from "./lib/components/ui/feedback.svelte";
	import { loadCustomFonts } from "./lib/text-overlay";

	// The editors are the bulk of the bundle and none of it is needed to paint the
	// upload screen, so they load with the route instead of with the app.
	const loadEditor = lazy(
		() => import("./lib/components/editor/Editor.svelte"),
	);
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
	/** Set when sequence mode was opened from a saved project. */
	let sequenceProjectKey: string | null = $state(null);
	let slideshowFiles: File[] = $state([]);
	let pendingAudioFile: File | null = $state(null);
	/** Editor state carried in from a reopened session, cleared on exit. */
	let restoredSingle: SingleSessionState | null = $state(null);
	let restoredSlideshowConfig: SlideshowConfig | null = $state(null);
	/** Library id of the song a reopened session was keyed to. */
	let sessionTrackId: string | null = $state(null);

	// Named for what each view is, not for the route it answers to: the two stopped
	// matching when the segment editor took the "#editor" name.
	type View = "upload" | "single" | "sequence" | "slideshow";

	/** The segment editor is "#editor" now, though internally it is still "sequence": the
	 * mode's saved timelines, media pool and sessions are keyed under that word. */
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
			// "#sequence" is the route this mode used to answer to; kept so links and
			// bookmarks from before the rename still land in it.
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

	function navigateTo(v: View, replace = false) {
		// Already there after a reload: a second entry would make Back a no-op.
		if (replace || window.location.hash === VIEW_HASH[v]) {
			history.replaceState(null, "", VIEW_HASH[v]);
		} else {
			history.pushState(null, "", VIEW_HASH[v]);
		}
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
			void w.renderer.warmShaders();
		} catch {
			// WebGL2 not available; Editor will fall back to creating its own context
		}
	}

	let warmRaf = 0;
	let warmTimer = 0;
	/** Bumped by every cancel so an in-flight `fonts.ready` can tell it's stale. */
	let warmGeneration = 0;

	function cancelWarm() {
		if (warmRaf) cancelAnimationFrame(warmRaf);
		if (warmTimer) clearTimeout(warmTimer);
		warmRaf = 0;
		warmTimer = 0;
		warmGeneration++;
	}

	/** Warm up only once the upload screen has painted its text: the context and its core
	 * programs cost a frame, and holding for the webfont keeps labels from swapping. */
	function scheduleWarm() {
		cancelWarm();
		disposeWarm();
		warmRaf = requestAnimationFrame(() => {
			warmRaf = 0;
			const generation = warmGeneration;
			const start = () => {
				if (generation !== warmGeneration) return;
				warmTimer = window.setTimeout(createWarm, 0);
			};
			document.fonts.ready.then(start, start);
		});
	}

	/** Warm the editor chunks once the upload screen goes idle, so picking a mode
	 * doesn't wait on the network. */
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
		sequenceProjectKey = null;
		pendingAudioFile = null;
		slideshowFiles = [];
		restoredSingle = null;
		restoredSlideshowConfig = null;
		sessionTrackId = null;
	}

	/** Reopen a saved single or slideshow edit: its media and the work done. False when
	 * it's gone. */
	async function openSessionByKey(
		mode: SessionMode,
		key: string,
	): Promise<boolean> {
		const opened = await openSession(key);
		if (!opened) return false;
		rememberLastOpened({ mode, key });
		// The song comes back too, so the per-song text timeline and segments the
		// editor restores have the track they're keyed to.
		pendingAudioFile = opened.trackFile;
		sessionTrackId = opened.trackId;
		if (mode === "single") {
			restoredSingle = opened.state as SingleSessionState;
			// Older single sessions stored layer media after the source; only the
			// source is wanted now.
			file = await gifToVideo(opened.files[0]);
			navigateTo("single");
			return true;
		}
		const state = opened.state as { config?: SlideshowConfig } | null;
		restoredSlideshowConfig = state?.config ?? null;
		slideshowFiles = await gifsToVideo(opened.files);
		navigateTo("slideshow");
		return true;
	}

	/** Reopen a song's saved sequence: its media becomes the pool, and the song
	 * itself is handed over as the already-known library track. False when it's gone. */
	async function openSequenceFromSong(trackId: string): Promise<boolean> {
		const opened = await openSavedSequence(trackId);
		if (!opened) return false;
		rememberLastOpened({ mode: "sequence", key: trackId });
		sequenceFiles = await gifsToVideo(opened.sources);
		pendingAudioFile = opened.trackFile;
		sequenceTrackId = opened.trackFile ? opened.trackId : null;
		sequenceProjectKey = opened.trackId;
		navigateTo("sequence");
		return true;
	}

	/** Whether the current route has its media, or would fall through to the upload screen. */
	function editorOpen(): boolean {
		if (view === "sequence") return sequenceFiles.length > 0;
		if (view === "slideshow") return slideshowFiles.length > 0;
		if (view === "single") return !!file;
		return false;
	}

	/** A reload lands on an editor's route with nothing open: bring back what was. */
	let restoring = $state(untrack(() => view) !== "upload");

	async function restoreLastOpened() {
		const last = readLastOpened();
		// Replaced, not pushed: Back onto the dead route would only bounce here again.
		if (!last || last.mode !== view) {
			restoring = false;
			navigateTo("upload", true);
			return;
		}
		restoring = true;
		const ok =
			last.mode === "sequence"
				? await openSequenceFromSong(last.key)
				: await openSessionByKey(last.mode, last.key);
		restoring = false;
		if (!ok) {
			forgetLastOpened();
			navigateTo("upload", true);
			showToast("Couldn't reopen your last project", "error");
		}
	}

	function exitToUpload() {
		navigateTo("upload");
		resetFiles();
		scheduleWarm();
	}

	onMount(() => {
		// Text layers and captions can be restored with a user font already selected,
		// so their faces have to be registered before anything draws.
		void loadCustomFonts();

		const onPopState = () => {
			view = hashToView(window.location.hash);
			if (view === "upload") {
				resetFiles();
				scheduleWarm();
			} else if (!editorOpen()) {
				void restoreLastOpened();
			}
		};
		window.addEventListener("popstate", onPopState);

		scheduleWarm();
		prefetchEditors();
		if (view !== "upload" && !editorOpen()) void restoreLastOpened();

		return () => {
			cancelWarm();
			window.removeEventListener("popstate", onPopState);
		};
	});
</script>

{#snippet loadFailed(err: unknown)}
	<AppError
		title="Couldn't load the editor"
		message="Part of the app failed to download. Check your connection and reload; your saved projects are safe."
		detail={err instanceof Error ? err.message : String(err)}
	/>
{/snippet}

<svelte:boundary onerror={(err) => console.error(err)}>
	{#if view === "slideshow" && slideshowFiles.length > 0}
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
		{:catch err}
			{@render loadFailed(err)}
		{/await}
	{:else if view === "sequence" && sequenceFiles.length > 0}
		{#await loadEditor() then Editor}
			<Editor
				mode="sequence"
				file={sequenceFiles[0]}
				extraFiles={sequenceFiles.slice(1)}
				initialAudioFile={pendingAudioFile}
				initialTrackId={sequenceTrackId}
				initialProjectKey={sequenceProjectKey}
				onfile={async (f: File) =>
					(sequenceFiles = [await gifToVideo(f), ...sequenceFiles.slice(1)])}
				{warmCanvas}
				{warmRenderer}
				onExit={exitToUpload}
			/>
		{:catch err}
			{@render loadFailed(err)}
		{/await}
	{:else if view === "single" && file}
		{#await loadEditor() then Editor}
			<Editor
				{file}
				initialAudioFile={pendingAudioFile}
				initialTrackId={sessionTrackId}
				initialSession={restoredSingle}
				onfile={async (f: File) => (file = await gifToVideo(f))}
				{warmCanvas}
				{warmRenderer}
				onExit={exitToUpload}
			/>
		{:catch err}
			{@render loadFailed(err)}
		{/await}
	{:else if restoring}
		<!-- Blank rather than the upload screen, which would flash up and go. -->
		<div class="restoring"></div>
	{:else}
		<UploadScreen
			onfile={async (f: File) => {
				forgetLastOpened();
				file = await gifToVideo(f);
				navigateTo("single");
			}}
			onSequence={async (files: File[]) => {
				forgetLastOpened();
				sequenceFiles = await gifsToVideo(files);
				navigateTo("sequence");
			}}
			onSequenceFromSong={async (trackId: string) => {
				if (!(await openSequenceFromSong(trackId))) {
					showToast("That song's media is no longer stored", "error");
				}
			}}
			onSessionOpen={async (mode: SessionMode, key: string) => {
				if (!(await openSessionByKey(mode, key))) {
					showToast("That session's media is no longer stored", "error");
				}
			}}
			onSlideshow={async (files: File[]) => {
				forgetLastOpened();
				slideshowFiles = await gifsToVideo(files);
				navigateTo("slideshow");
			}}
			onaudio={(f: File) => (pendingAudioFile = f)}
			{warmCanvas}
			{warmRenderer}
		/>
	{/if}

	{#snippet failed(err)}
		<AppError
			title="Something broke"
			message="The editor hit an error it couldn't recover from. Your work up to the last autosave is kept; reload to pick it back up."
			detail={err instanceof Error ? err.message : String(err)}
		/>
	{/snippet}
</svelte:boundary>

{#if isFeedbackOpen()}
	{#await loadFeedbackModal() then FeedbackModal}
		<FeedbackModal />
	{/await}
{/if}

<ToastContainer />

<style>
	.restoring {
		position: fixed;
		inset: 0;
		background: var(--ink);
	}
</style>
