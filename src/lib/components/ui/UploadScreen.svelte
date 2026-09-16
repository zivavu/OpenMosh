<script lang="ts">
	interface Props {
		onfile: (file: File) => void;
		onSequence: (files: File[]) => void;
		/** Reopen a song's saved sequence — no media picking needed. */
		onSequenceFromSong: (trackId: string) => void;
		/** Reopen a saved single or slideshow session by its key. */
		onSessionOpen: (mode: SessionMode, key: string) => void;
		onSlideshow: (files: File[]) => void;
		onaudio?: (file: File) => void;
		/** Pre-warmed context, borrowed for the demo until the editor claims it. */
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: GlRenderer | null;
	}

	import {
		HardDrive,
		Image,
		ListVideo,
		Music,
		Sparkles,
		Upload,
		X,
	} from "lucide-svelte";
	import type { GlRenderer } from "../../gl/renderer";
	import { lazy } from "../../lazy";
	import DemoBackground from "./DemoBackground.svelte";
	import GithubLink from "./GithubLink.svelte";
	import YoutubeLink from "./YoutubeLink.svelte";
	import FeedbackButton from "./FeedbackButton.svelte";
	import { showToast } from "./toast.svelte";
	import { isModalKeyboardOpen } from "../../modal-keyboard";
	import { isInteractiveTarget } from "../../editor/shortcut-target";
	import {
		listSavedSequences,
		readCachedSavedSequences,
		type SavedSequence,
	} from "../../editor/saved-sequences";
	import {
		listSavedSessions,
		readCachedSessions,
		type SavedSession,
	} from "../../editor/sessions";
	import type { SessionMode } from "../../editor/sequence-media-store";
	import {
		DEFAULT_SETTINGS,
		demoBackgroundEnabled,
		loadSettings,
		updateSettings,
		type UploadMode,
	} from "../../editor/settings";

	let {
		onfile,
		onSequence,
		onSequenceFromSong,
		onSessionOpen,
		onSlideshow,
		onaudio,
		warmCanvas = null,
		warmRenderer = null,
	}: Props = $props();

	// Work already done, offered as a way back in that skips picking media. All
	// three lists are painted from their cache so the section is there on the first
	// frame, then reconciled against IndexedDB.
	let savedSequences = $state<SavedSequence[]>(readCachedSavedSequences());
	let savedSingle = $state<SavedSession[]>(readCachedSessions("single"));
	let savedSlideshow = $state<SavedSession[]>(readCachedSessions("slideshow"));
	function refreshSaved() {
		void listSavedSequences().then((list) => (savedSequences = list));
		void listSavedSessions("single").then((list) => (savedSingle = list));
		void listSavedSessions("slideshow").then((list) => (savedSlideshow = list));
	}
	$effect(refreshSaved);

	// Everything stored, with a way to delete it — the one place that shows
	// what the browser is holding on to for this site.
	const loadStorageModal = lazy(() => import("./StorageModal.svelte"));
	let storageOpen = $state(false);

	// Owned here rather than inside the demo, so STOP quiets the wordmark's tear
	// along with the background it belongs to.
	let demoPlaying = $state(demoBackgroundEnabled());

	// Editor and Slideshow are timeline work — lanes, clips, keyboard shortcuts
	// and a screen wide enough to scrub — so on a touch device only Single is
	// offered. Same check the editors themselves use for their own mobile layout.
	const isMobile = window.matchMedia("(pointer: coarse)").matches;

	// Opens on whichever mode was last launched: coming back for a second pass at
	// the same kind of edit is the common case. Mobile always opens on Single
	// without writing that back, so a desktop's remembered mode survives a
	// phone visit.
	let selectedMode: UploadMode = $state(
		isMobile
			? "single"
			: (loadSettings().lastMode ?? DEFAULT_SETTINGS.lastMode),
	);

	function setMode(mode: UploadMode) {
		selectedMode = mode;
		updateSettings({ lastMode: mode });
		// Staged media belongs to the mode it was dropped on: single takes one file
		// and needs no song, so holding a set across the switch would misrepresent
		// what's about to happen.
		stagedMedia = null;
	}
	/** Modes that take a whole set of media rather than one file. */
	let isMultiMode = $derived(selectedMode !== "single");

	const MODES = [
		{ value: "single", label: "Single" },
		{ value: "sequence", label: "Editor" },
		{ value: "slideshow", label: "Slideshow" },
	] as const;

	// 1, 2, 3 pick a mode, the way they pick a group in the shortcuts sheet.
	function onModeKey(e: KeyboardEvent) {
		if (isMobile || generateOpen || storageOpen || isModalKeyboardOpen())
			return;
		if (e.ctrlKey || e.metaKey || e.altKey || isInteractiveTarget(e.target))
			return;
		const n = Number(e.key);
		if (n >= 1 && n <= MODES.length) setMode(MODES[n - 1].value);
	}

	/** The session list backing whichever mode is showing. Sequence keeps its own
	 * list, keyed by song rather than by media. */
	let savedForMode = $derived<SavedSession[]>(
		selectedMode === "single"
			? savedSingle
			: selectedMode === "slideshow"
				? savedSlideshow
				: [],
	);
	let dragging = $state(false);
	let fileInput: HTMLInputElement;

	const AUDIO_TYPES = [
		"audio/mpeg",
		"audio/wav",
		"audio/ogg",
		"audio/flac",
		"audio/mp4",
		"audio/aac",
	];
	let pendingAudio = $state<File | null>(null);
	let audioDragging = $state(false);
	let audioInput = $state<HTMLInputElement>(undefined!);

	const ACCEPTED_TYPES = [
		"image/png",
		"image/jpeg",
		"image/jpg",
		"image/webp",
		"image/gif",
		"image/heic",
		"image/heif",
		"video/mp4",
		"video/webm",
		"video/quicktime",
	];
	const ACCEPTED_EXTENSIONS = [
		".png",
		".jpg",
		".jpeg",
		".webp",
		".gif",
		".heic",
		".heif",
		".mp4",
		".webm",
		".mov",
	];
	function getExtension(name: string) {
		return name.slice(name.lastIndexOf(".")).toLowerCase();
	}

	function isAcceptedFile(file: File) {
		if (file.type) return ACCEPTED_TYPES.includes(file.type);
		return ACCEPTED_EXTENSIONS.includes(getExtension(file.name));
	}

	function isAudioFile(file: File) {
		return AUDIO_TYPES.includes(file.type) || file.type.startsWith("audio/");
	}

	const SUPPORTED_LABEL = "PNG, JPG, WEBP, GIF, HEIC, MP4, WEBM, MOV";

	function rejectFile(file: File) {
		showToast(
			`Can't open "${file.name}". Supported formats: ${SUPPORTED_LABEL}`,
			"error",
			6000,
		);
	}

	function handleFile(file: File) {
		if (!isAcceptedFile(file)) {
			rejectFile(file);
			return;
		}
		onfile(file);
	}

	function handleMultiFiles(files: FileList | File[]) {
		const all = Array.from(files);
		const accepted = all.filter((f) => isAcceptedFile(f));
		if (accepted.length === 0) {
			if (all.length === 1) rejectFile(all[0]);
			else
				showToast(
					`None of those ${all.length} files are supported. Try ${SUPPORTED_LABEL}`,
					"error",
					6000,
				);
			return;
		}
		const skipped = all.length - accepted.length;
		if (skipped > 0) {
			showToast(
				`Skipped ${skipped} unsupported file${skipped === 1 ? "" : "s"}`,
				"info",
			);
		}
		// Both multi modes cut media to a track — there is nothing to time against
		// without one. Rather than reject the drop and make the user find the files
		// again, hold them until a song arrives and start the moment it does.
		if (!pendingAudio) {
			stagedMedia = accepted;
			showToast(
				`${accepted.length} file${accepted.length === 1 ? "" : "s"} ready — add a song to start`,
				"info",
			);
			return;
		}
		launchMultiMode(accepted);
	}

	/** Media held back waiting on the song a multi mode requires. */
	let stagedMedia = $state<File[] | null>(null);

	// Procedural images instead of an upload: they come back as ordinary
	// files, so they take the same road in as a drop would.
	const loadGeneratePanel = lazy(
		() => import("../generators/GeneratePanel.svelte"),
	);
	let generateOpen = $state(false);

	function useGenerated(files: File[]) {
		generateOpen = false;
		if (isMultiMode) handleMultiFiles(files);
		else handleFile(files[0]);
	}

	function launchMultiMode(files: File[]) {
		stagedMedia = null;
		if (selectedMode === "sequence") onSequence(files);
		else onSlideshow(files);
	}

	/** Single mode takes one file — say so rather than silently dropping the rest. */
	function handleSingleFile(files: FileList | File[]) {
		const all = Array.from(files);
		const file = all[0];
		if (!file) return;
		if (all.length > 1 && isAcceptedFile(file)) {
			showToast(
				isMobile
					? `Loaded "${file.name}" only. Editor and Slideshow, which take a set, need a desktop browser`
					: `Loaded "${file.name}" only. Switch to Sequence or Slideshow mode to use all ${all.length}`,
				"info",
				6000,
			);
		}
		handleFile(file);
	}

	function onDrop(e: DragEvent) {
		dragging = false;
		const files = e.dataTransfer?.files;
		if (!files || files.length === 0) return;

		// A track dropped on the media zone is far likelier to be a track than a
		// mistake worth a toast about, so route by what landed rather than reject.
		const all = Array.from(files);
		const audio = all.filter(isAudioFile);
		const media = all.filter((f) => !isAudioFile(f));
		if (audio.length > 0) handleAudioFile(audio[0]);
		if (media.length === 0) return;

		if (isMultiMode) {
			handleMultiFiles(media);
		} else {
			handleSingleFile(media);
		}
	}

	function onDragOver(_e: DragEvent) {
		dragging = true;
	}

	function onDragLeave(e: DragEvent) {
		if (
			e.currentTarget instanceof HTMLElement &&
			!e.currentTarget.contains(e.relatedTarget as Node)
		) {
			dragging = false;
		}
	}

	function onInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;

		if (isMultiMode) {
			handleMultiFiles(input.files);
		} else {
			handleSingleFile(input.files);
		}
		input.value = "";
	}

	function openFilePicker() {
		fileInput.click();
	}

	function getAcceptTypes() {
		return [...ACCEPTED_TYPES, ...ACCEPTED_EXTENSIONS].join(",");
	}
	function getIsMultiple() {
		return isMultiMode;
	}

	function handleAudioFile(file: File) {
		if (!isAudioFile(file)) {
			showToast(`"${file.name}" isn't an audio file`, "error");
			return;
		}
		pendingAudio = file;
		onaudio?.(file);
		// The song was the only thing missing — go, rather than making the user
		// re-drop media they already picked.
		if (stagedMedia && isMultiMode) launchMultiMode(stagedMedia);
	}

	function openAudioPicker() {
		audioInput.click();
	}

	function onAudioInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) handleAudioFile(file);
		input.value = "";
	}

	function onAudioDrop(e: DragEvent) {
		audioDragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) handleAudioFile(file);
	}
</script>

<svelte:window onkeydown={onModeKey} />

<DemoBackground {warmCanvas} {warmRenderer} bind:playing={demoPlaying} />

<div class="upload-screen">
	<div class="hero">
		<!-- The ghosts are the two split channels. Real spans rather than
		     ::before/::after content, so screen readers announce the wordmark
		     once instead of three times. -->
		<h1 class="title" class:still={!demoPlaying}>
			OpenMosh
			<span class="ghost ghost-live" aria-hidden="true">OpenMosh</span>
			<span class="ghost ghost-rec" aria-hidden="true">OpenMosh</span>
			<span class="ghost ghost-slice" aria-hidden="true">OpenMosh</span>
		</h1>
		<p class="subtitle">Open-source image & video glitching in the browser.</p>
	</div>

	{#if !isMobile}
		<div class="mode-toggle" role="tablist">
			{#each MODES as m, i (m.value)}
				<button
					class="mode-btn"
					class:active={selectedMode === m.value}
					role="tab"
					aria-selected={selectedMode === m.value}
					onclick={() => setMode(m.value)}
				>
					<span class="mode-n">{i + 1}</span>
					{m.label}
				</button>
			{/each}
		</div>
	{/if}

	<!-- One panel: media on top, the song strip along its foot. The strip
	     stops its own drag events so a track dropped on it isn't also read
	     by the panel. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="panel"
		class:dragging
		ondrop={(e) => {
			e.preventDefault();
			onDrop(e);
		}}
		ondragover={(e) => {
			e.preventDefault();
			onDragOver(e);
		}}
		ondragleave={onDragLeave}
	>
		<div class="panel-main">
			<p class="panel-hint">
				{#if isMobile}
					One image or video. The Editor and Slideshow modes are built for a
					desktop browser, so they're not offered here.
				{:else if selectedMode === "slideshow"}
					A pile of media and a track. It finds the BPM and cuts on the beat.
				{:else if selectedMode === "sequence"}
					Your song on a timeline. Cut it into segments, then stack effect lanes
					and media layers over them.
				{:else}
					One image or video. Mosh it, then lock whatever survived and roll
					again.
				{/if}
			</p>

			<div class="load-row">
				<label class="load-btn">
					<input
						bind:this={fileInput}
						type="file"
						accept={getAcceptTypes()}
						multiple={getIsMultiple()}
						onchange={onInputChange}
						style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"
					/>
					<Upload size={16} />
					{isMultiMode ? "Load files" : "Load a file"}
				</label>
				<button
					class="load-btn generate-btn"
					onclick={() => (generateOpen = true)}
					onkeydown={(e) => e.stopPropagation()}
				>
					<Sparkles size={16} />
					Generate
				</button>
			</div>

			<p class="drop-hint" class:staged={stagedMedia}>
				{#if stagedMedia}
					{stagedMedia.length} file{stagedMedia.length === 1 ? "" : "s"} ready. Add
					a song to start.
				{:else if isMultiMode}
					or drop images and videos anywhere on this panel
				{:else}
					or drop an image or video anywhere on this panel
				{/if}
			</p>
		</div>

		{#if pendingAudio}
			<div class="song-strip song-strip--set">
				<Music size={14} />
				<span class="song-name">{pendingAudio.name}</span>
				<button
					class="song-clear"
					onclick={() => {
						pendingAudio = null;
					}}
					aria-label="Remove audio"
				>
					<X size={12} />
				</button>
			</div>
		{:else}
			<button
				class="song-strip"
				class:song-dragging={audioDragging}
				onclick={openAudioPicker}
				ondrop={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onAudioDrop(e);
				}}
				ondragover={(e) => {
					e.preventDefault();
					e.stopPropagation();
					audioDragging = true;
				}}
				ondragleave={(e) => {
					e.stopPropagation();
					if (
						e.currentTarget instanceof HTMLElement &&
						!e.currentTarget.contains(e.relatedTarget as Node)
					) {
						audioDragging = false;
					}
				}}
			>
				<Music size={14} />
				<span>Add a song</span>
				<span class="song-tag" class:required={isMultiMode}>
					{isMultiMode ? "required" : "optional"}
				</span>
			</button>
		{/if}
	</div>

	<input
		bind:this={audioInput}
		type="file"
		accept={AUDIO_TYPES.join(",")}
		onchange={onAudioInputChange}
		hidden
	/>

	{#if generateOpen}
		{#await loadGeneratePanel() then GeneratePanel}
			<GeneratePanel
				single={!isMultiMode}
				onUse={useGenerated}
				onClose={() => (generateOpen = false)}
			/>
		{/await}
	{/if}

	<!-- One row at a fixed height for every mode, empty or not: a block that
	     collapsed when a mode had nothing saved is what made switching jump.
	     The chips scroll sideways rather than wrapping. -->
	<div class="recent">
		{#if selectedMode === "sequence" && savedSequences.length > 0}
			<span class="recent-label rack-label">Recent</span>
			<div class="recent-list">
				{#each savedSequences as seq (seq.trackId)}
					<button
						class="saved-item"
						title={`Reopen "${seq.trackName}" with its ${seq.sourceCount} source${seq.sourceCount === 1 ? "" : "s"}`}
						onclick={() => {
							// Reopening a song is entering the editor too. The stored value
							// stays "sequence": it is what every saved key is written under.
							updateSettings({ lastMode: "sequence" });
							onSequenceFromSong(seq.trackId);
						}}
					>
						<ListVideo size={13} />
						<span class="saved-name">{seq.trackName}</span>
						<span class="saved-count">{seq.sourceCount}</span>
					</button>
				{/each}
			</div>
		{:else if selectedMode !== "sequence" && savedForMode.length > 0}
			<span class="recent-label rack-label">Recent</span>
			<div class="recent-list">
				{#each savedForMode as session (session.key)}
					<button
						class="saved-item"
						title={`Reopen "${session.label}" with the work already done on it`}
						onclick={() => {
							updateSettings({ lastMode: selectedMode });
							onSessionOpen(session.mode, session.key);
						}}
					>
						{#if session.mode === "single"}
							<Image size={13} />
						{:else}
							<ListVideo size={13} />
						{/if}
						<span class="saved-name">{session.label}</span>
						{#if session.mode === "slideshow"}
							<span class="saved-count">{session.sourceCount}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="github-corner">
		<button
			class="storage-btn"
			onclick={() => (storageOpen = true)}
			title="Manage stored projects and media"
			aria-label="Manage storage"
		>
			<HardDrive size={14} />
		</button>
		<GithubLink />
		<YoutubeLink />
		<FeedbackButton />
	</div>

	{#if storageOpen}
		{#await loadStorageModal() then StorageModal}
			<StorageModal
				onClose={() => (storageOpen = false)}
				onChanged={refreshSaved}
			/>
		{/await}
	{/if}
</div>

<style>
	/* Everything here sits over a live mosh, so panels carry their own frosted
	   backing and text runs a step brighter than it would on flat black —
	   motion behind copy eats apparent contrast. */
	.upload-screen {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 1.75rem;
		padding: 2rem;
	}

	.github-corner {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	/* Same shape as the links beside it. */
	.storage-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 50%;
		background: rgba(18, 18, 18, 0.85);
		border: 1.5px solid var(--line-strong);
		color: var(--text-3);
		flex-shrink: 0;
		box-sizing: border-box;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.storage-btn:hover {
		border-color: var(--text-3);
		color: var(--text);
	}

	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.title {
		position: relative;
		font-size: clamp(2.5rem, 6vw, 4.5rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #fff;
		line-height: 1;
		text-shadow: 0 2px 24px rgba(0, 0, 0, 0.85);
		cursor: default;
	}

	/* Offset copies of the wordmark in the app's own two accents, screened over
	   the white so only the fringes show. They sit still most of the cycle and
	   tear for about half a second, since a permanent jitter stops reading as a
	   glitch and starts reading as a broken page. */
	.ghost {
		position: absolute;
		inset: 0;
		text-shadow: none;
		mix-blend-mode: screen;
		pointer-events: none;
		user-select: none;
	}

	/* Each layer runs on its own period, and the periods share no small common
	   multiple, so the bursts drift in and out of phase and the tear never
	   repeats the same shape twice within a sitting. The negative delays start
	   every cycle already near a burst, so the wordmark tears within a moment
	   of the page appearing rather than sitting still and looking like flat
	   text. */
	.ghost-live {
		color: var(--live);
		transform: translate(-3px, 0);
		animation: tear-live 3.7s steps(1, end) -3.5s infinite;
	}

	.ghost-rec {
		color: var(--rec);
		transform: translate(3px, 0);
		animation: tear-rec 2.3s steps(1, end) -2.1s infinite;
	}

	/* A white shard on a third period. Hidden between bursts — its own clip-path
	   is what makes it appear — so between tears there is nothing extra stacked
	   over the wordmark. */
	.ghost-slice {
		color: #fff;
		clip-path: inset(0 0 100% 0);
		animation: slice 2.9s steps(1, end) -2.7s infinite;
	}

	/* Stepped, not eased: a datamosh cuts between states, it doesn't tween.
	   Each held step is about 50ms, slow enough to actually read as a torn
	   frame instead of blurring into a shimmer. Two bursts per cycle — one
	   glancing, one full — so a layer isn't dead for its whole period. */
	@keyframes tear-live {
		0%,
		37% {
			transform: translate(-3px, 0);
			clip-path: none;
		}
		38.5% {
			transform: translate(-9px, 2px);
			clip-path: inset(44% 0 30% 0);
		}
		40% {
			transform: translate(6px, -2px);
			clip-path: inset(14% 0 66% 0);
		}
		41.5%,
		84% {
			transform: translate(-3px, 0);
			clip-path: none;
		}
		86% {
			transform: translate(-22px, -5px);
			clip-path: inset(10% 0 62% 0);
		}
		88% {
			transform: translate(14px, 3px);
			clip-path: inset(56% 0 18% 0);
		}
		90% {
			transform: translate(-16px, 5px);
			clip-path: inset(32% 0 40% 0);
		}
		92% {
			transform: translate(9px, -3px);
			clip-path: inset(70% 0 6% 0);
		}
		94% {
			transform: translate(-12px, 2px);
			clip-path: inset(2% 0 76% 0);
		}
		96%,
		100% {
			transform: translate(-3px, 0);
			clip-path: none;
		}
	}

	@keyframes tear-rec {
		0%,
		22% {
			transform: translate(3px, 0);
			clip-path: none;
		}
		23.5% {
			transform: translate(10px, -2px);
			clip-path: inset(60% 0 18% 0);
		}
		25% {
			transform: translate(-7px, 2px);
			clip-path: inset(24% 0 52% 0);
		}
		26.5%,
		84% {
			transform: translate(3px, 0);
			clip-path: none;
		}
		86% {
			transform: translate(18px, 4px);
			clip-path: inset(48% 0 26% 0);
		}
		88% {
			transform: translate(-15px, -3px);
			clip-path: inset(6% 0 68% 0);
		}
		90% {
			transform: translate(19px, -5px);
			clip-path: inset(26% 0 44% 0);
		}
		92% {
			transform: translate(-11px, 3px);
			clip-path: inset(64% 0 12% 0);
		}
		94% {
			transform: translate(13px, -2px);
			clip-path: inset(36% 0 34% 0);
		}
		96%,
		100% {
			transform: translate(3px, 0);
			clip-path: none;
		}
	}

	/* Bands of the wordmark yanked sideways and dropped back. Kept thin: a wide
	   band just reads as the whole title sliding. */
	@keyframes slice {
		0%,
		29% {
			transform: none;
			clip-path: inset(0 0 100% 0);
		}
		30.5% {
			transform: translate(-26px, 0);
			clip-path: inset(38% 0 50% 0);
		}
		32% {
			transform: translate(20px, 0);
			clip-path: inset(66% 0 22% 0);
		}
		33.5%,
		70% {
			transform: none;
			clip-path: inset(0 0 100% 0);
		}
		71.5% {
			transform: translate(30px, 0);
			clip-path: inset(16% 0 72% 0);
		}
		73% {
			transform: translate(-18px, 0);
			clip-path: inset(52% 0 36% 0);
		}
		74.5% {
			transform: translate(24px, 0);
			clip-path: inset(78% 0 10% 0);
		}
		76%,
		100% {
			transform: none;
			clip-path: inset(0 0 100% 0);
		}
	}

	/* The white wordmark shears on its own beat too, on a fourth period so the
	   body of the title and its colour fringes rarely break together. Without
	   this only the fringes move and the tear reads as a halo rather than a
	   broken frame. */
	.title {
		animation: shear 4.1s steps(1, end) -3.9s infinite;
	}

	@keyframes shear {
		0%,
		46% {
			transform: none;
		}
		47.5% {
			transform: translate(2px, 0) skewX(-2deg);
		}
		49%,
		84% {
			transform: none;
		}
		86% {
			transform: translate(5px, 0) skewX(-4deg);
		}
		88% {
			transform: translate(-6px, -1px) skewX(5deg);
		}
		90% {
			transform: translate(4px, 1px) skewX(-3deg);
		}
		92% {
			transform: translate(-2px, 0) skewX(1deg);
		}
		94%,
		100% {
			transform: none;
		}
	}

	/* Hovering pulls every layer onto the same short period, so the drifting
	   tear snaps into one hard repeating break under the pointer — the title
	   answers the pointer the way the effect rack does. */
	.title:hover,
	.title:hover .ghost {
		animation-duration: 0.8s;
	}

	/* STOP blacks out the demo, so the wordmark settles with it and keeps only
	   the static split. Deliberately not tied to prefers-reduced-motion: people
	   set that flag for their OS, not to opt out of a page's centrepiece, and
	   the button is the opt-out this screen offers. */
	.title.still,
	.title.still .ghost,
	.title.still:hover,
	.title.still:hover .ghost {
		animation: none;
		transform: none;
	}

	.title.still .ghost-live {
		transform: translate(-3px, 0);
	}

	.title.still .ghost-rec {
		transform: translate(3px, 0);
	}

	.subtitle {
		font-size: 0.95rem;
		color: var(--text-2);
		text-shadow: 0 1px 12px rgba(0, 0, 0, 0.9);
	}

	/* ── Entry ────────────────────────────────────────────────────────────── */
	/* Each block rises in after the one above it, on the app's curve. */
	.hero,
	.mode-toggle,
	.panel,
	.recent {
		animation: rise 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both;
		animation-delay: calc(var(--i, 0) * 70ms);
	}

	.mode-toggle {
		--i: 1;
	}
	.panel {
		--i: 2;
	}
	.recent {
		--i: 3;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
	}

	/* ── Mode ─────────────────────────────────────────────────────────────── */
	.mode-toggle {
		display: flex;
		flex-shrink: 0;
		padding: 3px;
		gap: 2px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
	}

	.mode-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 1.1rem 0.4rem 0.9rem;
		border: none;
		border-radius: var(--r-pill);
		background: transparent;
		color: var(--text-3);
		font-family: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			color var(--t),
			background-color var(--t);
	}

	.mode-btn:hover {
		color: var(--text-2);
	}

	.mode-btn.active {
		color: var(--text);
		background: rgba(255, 255, 255, 0.09);
	}

	.mode-btn:active {
		transform: scale(0.98);
	}

	/* The number is the key that picks it; it goes live with the mode. */
	.mode-n {
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--text-4);
		transition: color var(--t);
	}

	.mode-btn.active .mode-n {
		color: var(--live);
	}

	/* ── Panel ────────────────────────────────────────────────────────────── */
	/* A solid plate with an inner highlight along its top edge; the dashed
	   line is the drag state, not the resting frame. */
	.panel {
		width: 100%;
		max-width: 520px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			0 24px 60px rgba(0, 0, 0, 0.45);
		overflow: hidden;
		transition:
			border-color var(--t),
			box-shadow var(--t);
	}

	.panel.dragging {
		border-color: var(--live);
		border-style: dashed;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.06),
			0 0 0 4px color-mix(in srgb, var(--live) 18%, transparent),
			0 24px 60px rgba(0, 0, 0, 0.45);
	}

	.panel-main {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.1rem;
		padding: 1.75rem 2rem;
	}

	/* What this mode does, as the panel's first line. */
	.panel-hint {
		max-width: 40ch;
		margin: 0 0 0.35rem;
		font-size: 0.82rem;
		line-height: 1.5;
		color: var(--text-2);
		text-align: center;
		text-wrap: balance;
	}

	.load-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.6rem;
	}

	.load-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.65rem 1.5rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: rgba(255, 255, 255, 0.04);
		color: var(--text);
		font-family: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition:
			border-color var(--t),
			background-color var(--t),
			transform var(--t-fast);
	}

	.load-btn:hover {
		border-color: var(--text-3);
		background-color: rgba(255, 255, 255, 0.1);
	}

	.load-btn:active {
		transform: scale(0.98);
	}

	.generate-btn {
		border-color: var(--mosh-dim);
		background: color-mix(in srgb, var(--mosh) 6%, transparent);
		color: var(--mosh);
	}

	.generate-btn:hover {
		border-color: var(--mosh);
		background-color: color-mix(in srgb, var(--mosh) 14%, transparent);
	}

	.drop-hint {
		margin: 0;
		font-size: 0.78rem;
		color: var(--text-3);
		text-align: center;
		transition: color var(--t);
	}

	.panel.dragging .drop-hint {
		color: var(--live);
	}

	/* Media is picked and waiting on the song: a live state, in the mosh
	   colour the launch belongs to. */
	.drop-hint.staged {
		color: var(--mosh);
	}

	/* ── Song strip ───────────────────────────────────────────────────────── */
	.song-strip {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		width: 100%;
		padding: 0.7rem 1.25rem;
		border: none;
		border-top: 1px solid var(--line);
		background: rgba(0, 0, 0, 0.25);
		color: var(--text-3);
		font-family: inherit;
		font-size: 0.78rem;
		text-align: left;
		cursor: pointer;
		transition:
			color var(--t),
			background-color var(--t);
	}

	.song-strip:not(.song-strip--set):hover,
	.song-strip:not(.song-strip--set):focus-visible,
	.song-dragging {
		color: var(--text);
		background: rgba(255, 255, 255, 0.05);
	}

	.song-dragging {
		color: var(--live);
	}

	.song-strip--set {
		color: var(--text-2);
		cursor: default;
	}

	.song-tag {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-4);
	}

	/* The one thing standing between staged media and the editor. */
	.song-tag.required {
		color: var(--mosh);
	}

	.song-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.song-clear {
		display: flex;
		padding: 3px;
		border: none;
		border-radius: var(--r-1);
		background: none;
		color: var(--text-3);
		cursor: pointer;
		transition: color var(--t-fast);
	}

	.song-clear:hover {
		color: var(--text);
	}

	/* ── Recent ───────────────────────────────────────────────────────────── */
	.recent {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		max-width: 520px;
		height: 2.1rem;
	}

	.recent-label {
		flex-shrink: 0;
		color: var(--text-3);
		text-shadow: 0 1px 10px rgba(0, 0, 0, 0.9);
	}

	/* One row, scrolled sideways; the ends fade so the cut is soft. */
	.recent-list {
		display: flex;
		gap: 0.4rem;
		min-width: 0;
		padding: 2px;
		overflow-x: auto;
		scrollbar-width: none;
		mask-image: linear-gradient(
			to right,
			transparent,
			#000 12px,
			#000 calc(100% - 24px),
			transparent
		);
	}

	.recent-list::-webkit-scrollbar {
		display: none;
	}

	.saved-item {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
		padding: 0.35rem 0.75rem;
		border: 1px solid var(--mosh-dim);
		border-radius: var(--r-pill);
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		color: var(--mosh);
		font-family: inherit;
		font-size: 0.74rem;
		cursor: pointer;
		transition:
			border-color var(--t),
			background-color var(--t),
			transform var(--t-fast);
	}

	.saved-item:hover {
		border-color: var(--mosh);
		background: color-mix(in srgb, var(--mosh) 10%, var(--glass));
	}

	.saved-item:active {
		transform: scale(0.98);
	}

	.saved-name {
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.saved-count {
		padding: 0 0.35rem;
		border-radius: var(--r-pill);
		background: color-mix(in srgb, var(--mosh) 18%, transparent);
		color: var(--mosh);
		font-family: var(--font-mono);
		font-size: 0.62rem;
	}

	@media (max-width: 800px) {
		.upload-screen {
			padding: 1rem;
		}

		.hero {
			gap: 0.4rem;
		}

		.panel-main {
			padding: 1.5rem 1.25rem 1.25rem;
		}

		.mode-btn {
			padding: 0.4rem 0.8rem;
		}

		.drop-hint {
			display: none;
		}
	}
</style>
