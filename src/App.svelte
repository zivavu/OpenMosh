<script lang="ts">
	import LoadFailed from "./lib/components/ui/LoadFailed.svelte";
	import { onMount, untrack } from "svelte";
	import UploadScreen from "./lib/components/ui/UploadScreen.svelte";
	import ToastContainer from "./lib/components/ui/ToastContainer.svelte";
	import {
		projectKeyForSession,
		readProjectNames,
	} from "./lib/editor/project-names";
	import OpeningCard from "./lib/components/ui/OpeningCard.svelte";
	import AppError from "./lib/components/ui/AppError.svelte";
	import { lazy } from "./lib/lazy";

	import { GlRenderer } from "./lib/gl/renderer";
	import { openSavedSequence } from "./lib/editor/saved-sequences";
	import {
		findStoredCopy,
		readProjectFile,
		storeProjectFile,
		type ProjectImportProgress,
		type ProjectOpening,
	} from "./lib/project-file/import";
	import type { ProjectFileMode } from "./lib/project-file/manifest";
	import {
		newSessionKey,
		openSession,
		type SingleSessionState,
	} from "./lib/editor/sessions";
	import {
		forgetLastOpened,
		readLastOpened,
		rememberLastOpened,
	} from "./lib/editor/last-opened";
	import type { SessionMode } from "./lib/editor/sequence-media-store";
	import type { SlideshowConfig } from "./lib/slideshow/types";
	import { showToast } from "./lib/components/ui/toast.svelte";
	import { takeRestoredNotice } from "./lib/backup/restored-notice";
	import { gifsToVideo, gifToVideo } from "./lib/media/gif";
	import {
		closeFeedback,
		feedbackPrefill,
		isFeedbackOpen,
	} from "./lib/components/ui/feedback.svelte";
	import { loadCustomFonts } from "./lib/text-overlay";
	import { probeCapabilities } from "./lib/capabilities.svelte";
	import { onLoadLosses, type LoadLosses } from "./lib/effects/load-report";
	import { parseRoute, routeHash, type View } from "./lib/route";
	import { recordingRunning } from "./lib/editor/recording-state.svelte";

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
	const loadLossesDialog = lazy(
		() => import("./lib/components/ui/LoadLossesDialog.svelte"),
	);
	const loadConfirmDialog = lazy(
		() => import("./lib/components/ui/ConfirmDialog.svelte"),
	);

	/** What an old save had to leave behind; a second report joins the open one. */
	let loadLosses: LoadLosses | null = $state(null);
	// At init, not onMount: an editor can restore its chain before the shell mounts.
	onLoadLosses((next) => {
		const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])];
		loadLosses = {
			effects: merge(loadLosses?.effects ?? [], next.effects),
			settings: merge(loadLosses?.settings ?? [], next.settings),
		};
	});

	/** The dialog's code didn't download: the gist goes in a toast rather than nowhere. */
	function reportLossesPlainly() {
		const losses = loadLosses;
		loadLosses = null;
		if (!losses) return;
		const names = [...losses.effects, ...losses.settings].join(", ");
		showToast(
			`Not everything loaded. Left out or changed: ${names}`,
			"info",
			0,
		);
	}

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
	/** What the open single or slideshow edit saves under; new for every upload. */
	let sessionKey: string | null = $state(null);

	let view: View = $state(parseRoute(window.location.hash).view);
	/** What the open edit saves under, once it saves: a new edit gets linked late. */
	let openKey: string | null = null;

	function navigateTo(v: View, replace = false, key: string | null = null) {
		const hash = routeHash(v, key);
		// Already on this view (a reload, or another edit): a second entry would make
		// Back a no-op.
		if (replace || parseRoute(window.location.hash).view === v) {
			history.replaceState(null, "", hash);
		} else {
			history.pushState(null, "", hash);
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
		sessionKey = null;
		openKey = null;
	}

	/** The warmed canvas went to the editor being replaced, which destroys it on the way
	 * out; cleared in this same step, so that editor never sees it go. */
	function releaseWarm() {
		cancelWarm();
		warmCanvas = null;
		warmRenderer = null;
	}

	/** The open edit has saved under `key`: link to it, so a reload or a copied URL
	 * comes back to it. */
	function linkOpenEdit(v: View, key: string) {
		// An editor swapped out by a link flushes its save on the way out, landing late.
		const open = v === "sequence" ? sequenceProjectKey : sessionKey;
		if (view !== v || (open !== null && key !== open)) return;
		openKey = key;
		const hash = routeHash(v, key);
		if (window.location.hash !== hash) history.replaceState(null, "", hash);
	}

	/** Reopen a saved single or slideshow edit: its media and the work done. False when
	 * it's gone. */
	async function openSessionByKey(
		mode: SessionMode,
		key: string,
		/** Opened in place of the edit the editor has open. */
		replacing = false,
	): Promise<boolean> {
		return whileOpening(
			readProjectNames()[projectKeyForSession(key)] ?? "",
			async () => {
				const opened = await openSession(key);
				if (!opened) return false;
				rememberLastOpened({ mode, key });
				// Older single sessions stored layer media after the source; only the source
				// is wanted now.
				const files =
					mode === "single"
						? [await gifToVideo(opened.files[0])]
						: await gifsToVideo(opened.files);
				if (replacing) releaseWarm();
				// The song comes back too, so the per-song text timeline and segments the
				// editor restores have the track they're keyed to.
				pendingAudioFile = opened.trackFile;
				sessionTrackId = opened.trackId;
				sessionKey = key;
				openKey = key;
				if (mode === "single") {
					restoredSingle = opened.state as SingleSessionState;
					file = files[0];
				} else {
					const state = opened.state as { config?: SlideshowConfig } | null;
					restoredSlideshowConfig = state?.config ?? null;
					slideshowFiles = files;
				}
				navigateTo(mode, false, key);
				return true;
			},
		);
	}

	/** Run an open that can take a moment (stored media, GIFs turned into video) behind
	 * the opening card, which only shows if it does. Inside an open already showing
	 * the card, it just runs. */
	async function whileOpening<T>(
		name: string,
		run: () => Promise<T>,
	): Promise<T> {
		if (projectOpening) return run();
		projectOpening = { name, stage: "opening", percent: 0, quiet: true };
		try {
			return await run();
		} finally {
			projectOpening = null;
		}
	}

	function filesName(files: File[]): string {
		return files.length === 1 ? files[0].name : `${files.length} files`;
	}

	/** Reopen a song's saved sequence: its media becomes the pool, and the song
	 * itself is handed over as the already-known library track. False when it's gone. */
	async function openSequenceFromSong(
		trackId: string,
		/** Opened from inside the editor, in place of the project it has open. */
		replacing = false,
	): Promise<boolean> {
		return whileOpening(readProjectNames()[trackId] ?? "", async () => {
			const opened = await openSavedSequence(trackId);
			if (!opened) return false;
			rememberLastOpened({ mode: "sequence", key: trackId });
			const files = await gifsToVideo(opened.sources);
			if (replacing) releaseWarm();
			sequenceFiles = files;
			pendingAudioFile = opened.trackFile;
			sequenceTrackId = opened.trackFile ? opened.trackId : null;
			sequenceProjectKey = opened.trackId;
			openKey = opened.trackId;
			navigateTo("sequence", false, opened.trackId);
			return true;
		});
	}

	/** A project file on its way in; the editor's own loading takes over once it opens. */
	let projectOpening = $state<ProjectOpening | null>(null);

	type CopyChoice = "open" | "copy" | "cancel";
	/** A project file that's already stored unchanged, waiting on what to do with it. */
	let storedCopy = $state<{
		name: string;
		choose: (choice: CopyChoice) => void;
	} | null>(null);

	function askAboutStoredCopy(name: string): Promise<CopyChoice> {
		return new Promise((resolve) => {
			storedCopy = {
				name,
				choose: (choice) => {
					storedCopy = null;
					resolve(choice);
				},
			};
		});
	}

	const MODE_FILE: Record<ProjectFileMode, { kind: string; mode: string }> = {
		sequence: { kind: "an Editor project", mode: "Editor" },
		single: { kind: "a Single edit", mode: "Single" },
		slideshow: { kind: "a Slideshow", mode: "Slideshow" },
	};

	/** Import a project file as a new project or edit, then open it the normal way.
	 * Only a file of the mode the upload screen is on opens. */
	async function openProjectFromFile(file: File, mode: ProjectFileMode) {
		if (projectOpening) return;
		projectOpening = {
			name: file.name.replace(/\.openmosh(?:-single|-slideshow)?$/i, ""),
			stage: "checking",
			percent: 0,
		};
		const report = (progress: ProjectImportProgress) => {
			if (!projectOpening) return;
			projectOpening.stage = progress.stage;
			if (progress.stage === "checking") {
				projectOpening.percent = Math.floor(progress.fraction * 100);
			}
		};
		try {
			const project = await readProjectFile(file);
			const saved = MODE_FILE[project.manifest.mode];
			if (project.manifest.mode !== mode) {
				showToast(
					`That file is ${saved.kind}. Switch to ${saved.mode} to open it.`,
					"error",
					8000,
				);
				return;
			}
			const copy = await findStoredCopy(project);
			const choice = copy ? await askAboutStoredCopy(copy.name) : "copy";
			if (choice === "cancel") return;
			const { key } =
				copy && choice === "open"
					? copy
					: await storeProjectFile(project, report);
			if (projectOpening) projectOpening.stage = "opening";
			const opened =
				mode === "sequence"
					? await openSequenceFromSong(key)
					: await openSessionByKey(mode, key);
			if (!opened) showToast("Couldn't open that project", "error");
		} catch (e) {
			showToast(
				e instanceof Error ? e.message : "Couldn't open that project file",
				"error",
				8000,
			);
		} finally {
			projectOpening = null;
		}
	}

	/** A project whose pool was emptied opens with no files; a new one always has some. */
	function sequenceOpen(): boolean {
		return sequenceFiles.length > 0 || sequenceProjectKey !== null;
	}

	/** Whether the current route has its media, or would fall through to the upload screen. */
	function editorOpen(): boolean {
		if (view === "sequence") return sequenceOpen();
		if (view === "slideshow") return slideshowFiles.length > 0;
		if (view === "single") return !!file;
		return false;
	}

	/** A reload lands on an editor's route with nothing open: bring back what was. */
	let restoring = $state(untrack(() => view) !== "upload");

	/** Open the edit a link names, in place of the one open if there is one. */
	async function openLinked(v: Exclude<View, "upload">, key: string) {
		const replacing = editorOpen();
		if (!replacing) restoring = true;
		const ok =
			v === "sequence"
				? await openSequenceFromSong(key, replacing)
				: await openSessionByKey(v, key, replacing);
		restoring = false;
		if (ok) return;
		showToast("That project is no longer stored", "error");
		// Back to the edit still open, or off the dead route.
		if (replacing) {
			history.replaceState(null, "", routeHash(v, openKey));
		} else {
			navigateTo("upload", true);
		}
	}

	async function restoreLastOpened() {
		const linked = parseRoute(window.location.hash).key;
		if (linked && view !== "upload") return openLinked(view, linked);
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
		// A backup was just loaded; the reload it took came back here.
		const restored = takeRestoredNotice();
		if (restored) showToast(restored, "success", 6000);

		// Text layers and captions can be restored with a user font already selected,
		// so their faces have to be registered before anything draws.
		void loadCustomFonts();

		const onPopState = () => {
			const route = parseRoute(window.location.hash);
			const from = view;
			// Leaving would tear down the renderer the export draws with.
			if (
				recordingRunning() &&
				(route.view !== from || (route.key && route.key !== openKey))
			) {
				history.pushState(null, "", routeHash(from, openKey));
				showToast(
					"Cancel or wait for the export to finish before leaving",
					"error",
				);
				return;
			}
			view = route.view;
			if (view === "upload") {
				resetFiles();
				scheduleWarm();
				return;
			}
			// A hand-edited URL can jump straight from one editor to another.
			if (from !== "upload" && from !== view) {
				resetFiles();
				releaseWarm();
			}
			if (!editorOpen()) {
				void restoreLastOpened();
			} else if (route.key && route.key !== openKey) {
				void openLinked(view, route.key);
			}
		};
		window.addEventListener("popstate", onPopState);

		scheduleWarm();
		prefetchEditors();
		void probeCapabilities();
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
		error={err}
	/>
{/snippet}

<svelte:boundary onerror={(err) => console.error(err)}>
	{#if view === "slideshow" && slideshowFiles.length > 0}
		{#await loadSlideshowEditor() then SlideshowEditor}
			{#key sessionKey}
				<SlideshowEditor
					initialFiles={slideshowFiles}
					initialAudioFile={pendingAudioFile}
					initialTrackId={sessionTrackId}
					initialConfig={restoredSlideshowConfig}
					sessionKey={sessionKey ?? newSessionKey("slideshow")}
					{warmCanvas}
					{warmRenderer}
					onExit={exitToUpload}
					onProjectReady={(key: string) => linkOpenEdit("slideshow", key)}
				/>
			{/key}
		{:catch err}
			{@render loadFailed(err)}
		{/await}
	{:else if view === "sequence" && sequenceOpen()}
		{#await loadEditor() then Editor}
			<!-- Keyed: another project is a fresh editor, not this one's state reseeded. -->
			{#key sequenceProjectKey}
				<Editor
					mode="sequence"
					file={sequenceFiles[0] ?? null}
					extraFiles={sequenceFiles.slice(1)}
					initialAudioFile={pendingAudioFile}
					initialTrackId={sequenceTrackId}
					initialProjectKey={sequenceProjectKey}
					onfile={async (f: File) =>
						(sequenceFiles = [
							await whileOpening(f.name, () => gifToVideo(f)),
							...sequenceFiles.slice(1),
						])}
					{warmCanvas}
					{warmRenderer}
					onExit={exitToUpload}
					onProjectReady={(key: string) => linkOpenEdit("sequence", key)}
					onOpenProject={async (key: string) => {
						if (!(await openSequenceFromSong(key, true))) {
							showToast("That project is no longer stored", "error");
						}
					}}
				/>
			{/key}
		{:catch err}
			{@render loadFailed(err)}
		{/await}
	{:else if view === "single" && file}
		{#await loadEditor() then Editor}
			{#key sessionKey}
				<Editor
					{file}
					initialAudioFile={pendingAudioFile}
					initialTrackId={sessionTrackId}
					initialSession={restoredSingle}
					sessionKey={sessionKey ?? newSessionKey("single")}
					onfile={async (f: File) =>
						(file = await whileOpening(f.name, () => gifToVideo(f)))}
					{warmCanvas}
					{warmRenderer}
					onExit={exitToUpload}
					onProjectReady={(key: string) => linkOpenEdit("single", key)}
				/>
			{/key}
		{:catch err}
			{@render loadFailed(err)}
		{/await}
	{:else if restoring}
		<!-- Blank rather than the upload screen, which would flash up and go. -->
		<div class="restoring"></div>
	{:else}
		<UploadScreen
			onfile={async (f: File) => {
				if (projectOpening) return;
				forgetLastOpened();
				sessionKey = newSessionKey("single");
				file = await whileOpening(f.name, () => gifToVideo(f));
				navigateTo("single");
			}}
			onSequence={async (files: File[]) => {
				if (projectOpening) return;
				forgetLastOpened();
				sequenceFiles = await whileOpening(filesName(files), () =>
					gifsToVideo(files),
				);
				navigateTo("sequence");
			}}
			onSequenceFromSong={async (trackId: string) => {
				if (projectOpening) return;
				if (!(await openSequenceFromSong(trackId))) {
					showToast("That project is no longer stored", "error");
				}
			}}
			onProjectFile={openProjectFromFile}
			onSessionOpen={async (mode: SessionMode, key: string) => {
				if (projectOpening) return;
				if (!(await openSessionByKey(mode, key))) {
					showToast("That session's media is no longer stored", "error");
				}
			}}
			onSlideshow={async (files: File[]) => {
				if (projectOpening) return;
				forgetLastOpened();
				sessionKey = newSessionKey("slideshow");
				slideshowFiles = await whileOpening(filesName(files), () =>
					gifsToVideo(files),
				);
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
			error={err}
		/>
	{/snippet}
</svelte:boundary>

{#if isFeedbackOpen()}
	{#await loadFeedbackModal() then FeedbackModal}
		{#key feedbackPrefill()}
			<FeedbackModal prefill={feedbackPrefill()} />
		{/key}
	{:catch}
		<LoadFailed onclose={closeFeedback} />
	{/await}
{/if}

{#if loadLosses}
	{#await loadLossesDialog() then LoadLossesDialog}
		<LoadLossesDialog losses={loadLosses} onClose={() => (loadLosses = null)} />
	{:catch}
		<LoadFailed onclose={reportLossesPlainly} />
	{/await}
{/if}

{#if projectOpening && !storedCopy}
	<OpeningCard opening={projectOpening} />
{/if}

{#if storedCopy}
	{@const choose = storedCopy.choose}
	{#await loadConfirmDialog() then ConfirmDialog}
		<ConfirmDialog
			title="Already in your projects"
			message={`Your project "${storedCopy.name}" is the same as this file. Open it, or import a second copy?`}
			confirmLabel="Open it"
			altLabel="Import a copy"
			onConfirm={() => choose("open")}
			onAlt={() => choose("copy")}
			onCancel={() => choose("cancel")}
		/>
	{:catch}
		<LoadFailed onclose={() => choose("copy")} />
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
