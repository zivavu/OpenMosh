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

import { Image, ListVideo, Music, Upload } from "lucide-svelte";
import type { GlRenderer } from "../../gl/renderer";
import DemoBackground from "./DemoBackground.svelte";
import GithubLink from "./GithubLink.svelte";
import { showToast } from "./toast.svelte";
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
$effect(() => {
	void listSavedSequences().then((list) => (savedSequences = list));
	void listSavedSessions("single").then((list) => (savedSingle = list));
	void listSavedSessions("slideshow").then((list) => (savedSlideshow = list));
});

// Opens on whichever mode was last launched: coming back for a second pass at
// the same kind of edit is the common case.
let selectedMode: UploadMode = $state(
	loadSettings().lastMode ?? DEFAULT_SETTINGS.lastMode,
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

/** The session list backing whichever mode is showing. Sequence keeps its own
 * list, keyed by song rather than by media. */
let savedForMode = $derived<SavedSession[]>(
	selectedMode === "single"
		? savedSingle
		: selectedMode === "slideshow"
			? savedSlideshow
			: [],
);
let savedHead = $derived(
	selectedMode === "single"
		? "OR PICK UP SOMETHING YOU WERE MOSHING"
		: "OR PICK UP A SLIDESHOW YOU WERE BUILDING",
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
			`${accepted.length} file${accepted.length === 1 ? '' : 's'} ready — add a song to start`,
			"info",
		);
		return;
	}
	launchMultiMode(accepted);
}

/** Media held back waiting on the song a multi mode requires. */
let stagedMedia = $state<File[] | null>(null);

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
			`Loaded "${file.name}" only. Switch to Sequence or Slideshow mode to use all ${all.length}`,
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

<DemoBackground {warmCanvas} {warmRenderer} />

<div class="upload-screen">
	<div class="hero">
		<h1 class="title">OpenMosh</h1>
		<p class="subtitle">Open-source image & video glitching in the browser.</p>
	</div>

	<div class="mode-toggle">
		{#each [{ value: 'single', label: 'Single' }, { value: 'sequence', label: 'Sequence' }, { value: 'slideshow', label: 'Slideshow' }] as const as m}
			<button
				class="mode-btn"
				class:active={selectedMode === m.value}
				onclick={() => setMode(m.value)}
			>
				{m.label}
			</button>
		{/each}
	</div>
	<p class="mode-hint">
		{#if selectedMode === 'slideshow'}
			Upload several images or videos and cut between them on the beat
		{:else if selectedMode === 'sequence'}
			Upload media, lay it out on a timeline, give each segment its own look
		{:else}
			Upload an image or video to apply glitch effects
		{/if}
	</p>

	<div
		class="drop-zone"
		class:dragging
		role="button"
		tabindex="0"
		aria-label="Drop zone for image or video files"
		ondrop={(e) => {
			e.preventDefault();
			onDrop(e);
		}}
		ondragover={(e) => {
			e.preventDefault();
			onDragOver(e);
		}}
		ondragleave={onDragLeave}
		onkeydown={(e) => {
			if (e.key === 'Enter' || e.key === ' ') openFilePicker();
		}}
	>
		<label class="load-btn">
			<input
				bind:this={fileInput}
				type="file"
				accept={getAcceptTypes()}
				multiple={getIsMultiple()}
				onchange={onInputChange}
				style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"
			/>
			<Upload size={18} />
			{isMultiMode ? 'LOAD MEDIA' : 'LOAD FILE'}
		</label>

		<div class="separator">
			<span class="line"></span>
			<span class="or">OR</span>
			<span class="line"></span>
		</div>

		<div class="drop-hint" class:staged={stagedMedia}>
			<Image size={16} />
			{#if stagedMedia}
				{stagedMedia.length} FILE{stagedMedia.length === 1 ? '' : 'S'} READY · ADD A SONG TO START
			{:else if isMultiMode}
				DRAG AND DROP IMAGES OR VIDEOS HERE
			{:else}
				DRAG AND DROP FILE HERE
			{/if}
		</div>
	</div>

	<input
		bind:this={audioInput}
		type="file"
		accept={AUDIO_TYPES.join(',')}
		onchange={onAudioInputChange}
		hidden
	/>

	{#if pendingAudio}
		<div class="music-zone music-zone--selected">
			<Music size={14} />
			<span class="music-filename">{pendingAudio.name}</span>
			<button
				class="music-clear"
				onclick={() => {
					pendingAudio = null;
				}}
				aria-label="Remove audio">✕</button
			>
		</div>
	{:else}
		<div
			class="music-zone"
			class:music-dragging={audioDragging}
			role="button"
			tabindex="0"
			onclick={openAudioPicker}
			ondrop={(e) => {
				e.preventDefault();
				onAudioDrop(e);
			}}
			ondragover={(e) => {
				e.preventDefault();
				audioDragging = true;
			}}
			ondragleave={(e) => {
				if (
					e.currentTarget instanceof HTMLElement &&
					!e.currentTarget.contains(e.relatedTarget as Node)
				) {
					audioDragging = false;
				}
			}}
			onkeydown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') openAudioPicker();
			}}
		>
			<Music size={14} />
			{#if isMultiMode}
				<span>ADD MUSIC <span class="required">(REQUIRED)</span></span>
			{:else}
				<span>ADD MUSIC <span class="optional">(OPTIONAL)</span></span>
			{/if}
		</div>
	{/if}

	<!-- Always rendered at a fixed height, for every mode: this block collapsing
	     when a mode has nothing saved is what made switching modes jump. -->
	<div class="saved-zone">
		{#if selectedMode === 'sequence' && savedSequences.length > 0}
			<div class="saved-head">OR PICK UP A SONG YOU'VE SEQUENCED</div>
			<div class="saved-list">
				{#each savedSequences as seq (seq.trackId)}
					<button
						class="saved-item"
						title={`Reopen "${seq.trackName}" with its ${seq.sourceCount} source${seq.sourceCount === 1 ? '' : 's'}`}
						onclick={() => {
							// Reopening a song is entering sequence mode too.
							updateSettings({ lastMode: 'sequence' });
							onSequenceFromSong(seq.trackId);
						}}
					>
						<ListVideo size={13} />
						<span class="saved-name">{seq.trackName}</span>
						<span class="saved-count">{seq.sourceCount}</span>
					</button>
				{/each}
			</div>
		{:else if selectedMode !== 'sequence' && savedForMode.length > 0}
			<div class="saved-head">{savedHead}</div>
			<div class="saved-list">
				{#each savedForMode as session (session.key)}
					<button
						class="saved-item"
						title={`Reopen "${session.label}" with the work already done on it`}
						onclick={() => {
							updateSettings({ lastMode: selectedMode });
							onSessionOpen(session.mode, session.key);
						}}
					>
						{#if session.mode === 'single'}
							<Image size={13} />
						{:else}
							<ListVideo size={13} />
						{/if}
						<span class="saved-name">{session.label}</span>
						{#if session.mode === 'slideshow'}
							<span class="saved-count">{session.sourceCount}</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="github-corner">
		<GithubLink />
	</div>
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
		gap: 2.5rem;
		padding: 2rem;
	}

	.github-corner {
		position: fixed;
		bottom: 1rem;
		right: 1rem;
		z-index: 1;
	}

	.hero {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}

	.title {
		font-size: clamp(2.5rem, 6vw, 4.5rem);
		font-weight: 800;
		letter-spacing: -0.02em;
		color: #fff;
		line-height: 1;
		text-shadow: 0 2px 24px rgba(0, 0, 0, 0.85);
	}

	.subtitle {
		font-size: 0.95rem;
		color: #9a9a9a;
		font-weight: 400;
		text-shadow: 0 1px 12px rgba(0, 0, 0, 0.9);
	}

	.mode-toggle {
		display: flex;
		flex-shrink: 0;
		gap: 0;
		border: 1.5px solid rgba(255, 255, 255, 0.16);
		border-radius: 999px;
		overflow: hidden;
		background: rgba(10, 10, 12, 0.55);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
	}

	.mode-btn {
		padding: 0.45rem 1.5rem;
		border: none;
		background: transparent;
		color: #8a8a8a;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition:
			color 0.2s,
			background-color 0.2s;
		font-family: inherit;
	}

	.mode-btn:hover {
		color: #ccc;
	}

	.mode-btn.active {
		background: rgba(255, 255, 255, 0.14);
		color: #fff;
	}

	.mode-hint {
		font-size: 0.8rem;
		color: #8a8a8a;
		margin-top: -1.5rem;
		text-align: center;
		text-shadow: 0 1px 10px rgba(0, 0, 0, 0.9);
	}

	.drop-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		padding: 2.5rem 3rem;
		border: 1.5px dashed rgba(255, 255, 255, 0.18);
		border-radius: 12px;
		width: 100%;
		max-width: 520px;
		background: rgba(10, 10, 12, 0.5);
		backdrop-filter: blur(20px) saturate(0.7);
		-webkit-backdrop-filter: blur(20px) saturate(0.7);
		transition:
			border-color 0.2s,
			background-color 0.2s;
		cursor: pointer;
		outline: none;
	}

	.drop-zone:hover,
	.drop-zone:focus-visible {
		border-color: rgba(255, 255, 255, 0.35);
	}

	.drop-zone.dragging {
		border-color: rgba(255, 255, 255, 0.6);
		background-color: rgba(20, 20, 24, 0.68);
	}

	.load-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 2rem;
		border: 1.5px solid rgba(255, 255, 255, 0.28);
		border-radius: 999px;
		background: transparent;
		color: #e4e4e4;
		font-size: 0.8rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s,
			background-color 0.2s;
		font-family: inherit;
	}

	.load-btn:hover {
		border-color: rgba(255, 255, 255, 0.6);
		color: #fff;
		background-color: rgba(255, 255, 255, 0.1);
	}

	.separator {
		display: flex;
		align-items: center;
		gap: 1rem;
		width: 100%;
	}

	.line {
		flex: 1;
		height: 1px;
		background: rgba(255, 255, 255, 0.14);
	}

	.or {
		font-size: 0.7rem;
		color: #777;
		letter-spacing: 0.05em;
		font-weight: 500;
	}

	.drop-hint {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #7d7d7d;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.08em;
	}

	/* Media is picked and waiting on the song, so this is a live state rather
	   than the idle instruction it replaces. */
	.drop-hint.staged {
		color: #b193cc;
	}

	/* Fixed, not min-height: a mode with one saved row and a mode with three
	   would otherwise still shift past each other. The list scrolls inside. */
	.saved-zone {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		width: 100%;
		max-width: 520px;
		height: 132px;
		margin-top: -1.5rem;
	}

	.saved-head {
		font-size: 0.66rem;
		color: #7d7d7d;
		letter-spacing: 0.08em;
		font-weight: 600;
		text-shadow: 0 1px 10px rgba(0, 0, 0, 0.9);
	}

	.saved-list {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		gap: 0.4rem;
		/* Three rows or so, then scroll — a long history shouldn't push the
		   music zone off the screen, and a short one shouldn't pull it up. */
		height: 108px;
		overflow-y: auto;
		scrollbar-width: thin;
	}

	.saved-item {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.7rem;
		border: 1.5px solid #3d3049;
		border-radius: 999px;
		background: rgba(10, 10, 12, 0.5);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		color: #b193cc;
		font-size: 0.72rem;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.saved-item:hover {
		border-color: #6a5080;
		color: #d8b8f8;
	}

	.saved-name {
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.saved-count {
		padding: 0 0.35rem;
		border-radius: 999px;
		background: #221a2c;
		color: #b08ad0;
		font-size: 0.62rem;
		font-family: monospace;
	}

	.music-zone {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		/* Pulled up against the drop box — the screen's 2.5rem rhythm reads as
		   too loose between a zone and the one it belongs to. */
		margin-top: -1rem;
		padding: 0.75rem 1.5rem;
		border: 1.5px dashed rgba(255, 255, 255, 0.12);
		border-radius: 10px;
		width: 100%;
		max-width: 520px;
		background: rgba(10, 10, 12, 0.42);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		color: #6e6e6e;
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.07em;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s;
		outline: none;
	}

	.music-zone:not(.music-zone--selected):hover,
	.music-zone:not(.music-zone--selected):focus-visible,
	.music-dragging {
		border-color: rgba(255, 255, 255, 0.3);
		color: #a0a0a0;
	}

	.music-zone--selected {
		border-color: rgba(255, 255, 255, 0.16);
		color: #909090;
		cursor: default;
	}

	.optional {
		color: #565656;
	}

	/* Reads as a live requirement rather than a footnote — it's the one thing
	   standing between staged media and the editor. */
	.required {
		color: #b193cc;
	}

	.music-filename {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.music-clear {
		background: none;
		border: none;
		color: #555;
		cursor: pointer;
		font-size: 0.75rem;
		padding: 0 0.2rem;
		line-height: 1;
	}

	.music-clear:hover {
		color: #999;
	}

	@media (max-width: 800px) {
		.upload-screen {
			padding: 1rem;
		}

		.hero {
			gap: 0.4rem;
		}

		.drop-zone {
			padding: 1.5rem 1.25rem;
		}

		.mode-btn {
			padding: 0.45rem 1rem;
		}

		.separator {
			display: none;
		}

		.drop-hint {
			display: none;
		}
	}
</style>
