<script lang="ts">
	interface Props {
		onfile: (file: File) => void;
		onSlideshow: (files: File[]) => void;
		onaudio?: (file: File) => void;
	}

	import { Image, Music, Upload } from 'lucide-svelte';

	let { onfile, onSlideshow, onaudio }: Props = $props();

	let selectedMode: 'single' | 'slideshow' = $state('single');
	let dragging = $state(false);
	let fileInput: HTMLInputElement;

	const AUDIO_TYPES = [
		'audio/mpeg',
		'audio/wav',
		'audio/ogg',
		'audio/flac',
		'audio/mp4',
		'audio/aac',
	];
	let pendingAudio = $state<File | null>(null);
	let audioDragging = $state(false);
	let audioInput = $state<HTMLInputElement>(undefined!);

	const ACCEPTED_TYPES = [
		'image/png',
		'image/jpeg',
		'image/webp',
		'image/gif',
		'video/mp4',
		'video/webm',
		'video/quicktime',
	];
	const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

	function handleFile(file: File) {
		if (ACCEPTED_TYPES.includes(file.type)) {
			onfile(file);
		}
	}

	function handleSlideshowFiles(files: FileList | File[]) {
		const images = Array.from(files).filter((f) =>
			IMAGE_TYPES.includes(f.type),
		);
		if (images.length > 0) {
			onSlideshow(images);
		}
	}

	function onDrop(e: DragEvent) {
		dragging = false;
		const files = e.dataTransfer?.files;
		if (!files || files.length === 0) return;

		if (selectedMode === 'slideshow') {
			handleSlideshowFiles(files);
		} else {
			const file = files[0];
			if (file) handleFile(file);
		}
	}

	function onDragOver(e: DragEvent) {
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

		if (selectedMode === 'slideshow') {
			handleSlideshowFiles(input.files);
		} else {
			const file = input.files[0];
			if (file) handleFile(file);
		}
		input.value = '';
	}

	function openFilePicker() {
		fileInput.click();
	}

	function getAcceptTypes() {
		return selectedMode === 'slideshow'
			? IMAGE_TYPES.join(',')
			: ACCEPTED_TYPES.join(',');
	}
	function getIsMultiple() {
		return selectedMode === 'slideshow';
	}

	function handleAudioFile(file: File) {
		if (AUDIO_TYPES.includes(file.type) || file.type.startsWith('audio/')) {
			pendingAudio = file;
			onaudio?.(file);
		}
	}

	function openAudioPicker() {
		audioInput.click();
	}

	function onAudioInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) handleAudioFile(file);
		input.value = '';
	}

	function onAudioDrop(e: DragEvent) {
		audioDragging = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) handleAudioFile(file);
	}
</script>

<div class="upload-screen">
	<div class="hero">
		<h1 class="title">OpenMosh</h1>
		<p class="subtitle">Open-source image & video glitching in the browser.</p>
	</div>

	<div class="mode-toggle">
		<button
			class="mode-btn"
			class:active={selectedMode === 'single'}
			onclick={() => {
				selectedMode = 'single';
			}}
		>
			Single
		</button>
		<button
			class="mode-btn"
			class:active={selectedMode === 'slideshow'}
			onclick={() => {
				selectedMode = 'slideshow';
			}}
		>
			Slideshow
		</button>
	</div>
	<p class="mode-hint">
		{selectedMode === 'slideshow'
			? 'Upload multiple images — sequences them into a beat-synced slideshow'
			: 'Upload an image or video to apply glitch effects'}
	</p>

	<div
		class="drop-zone"
		class:dragging
		role="button"
		tabindex="0"
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
		<input
			bind:this={fileInput}
			type="file"
			accept={getAcceptTypes()}
			multiple={getIsMultiple()}
			onchange={onInputChange}
			hidden
		/>

		<button class="load-btn" onclick={openFilePicker}>
			<Upload size={18} />
			{selectedMode === 'slideshow' ? 'LOAD IMAGES' : 'LOAD FILE'}
		</button>

		<div class="separator">
			<span class="line"></span>
			<span class="or">OR</span>
			<span class="line"></span>
		</div>

		<div class="drop-hint">
			<Image size={16} />
			{selectedMode === 'slideshow'
				? 'DRAG AND DROP IMAGES HERE'
				: 'DRAG AND DROP FILE HERE'}
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
			{#if selectedMode === 'slideshow'}
				<span>ADD MUSIC <span class="optional">(RECOMMENDED)</span></span>
			{:else}
				<span>ADD MUSIC <span class="optional">(OPTIONAL)</span></span>
			{/if}
		</div>
		<p class="music-hint">
			{selectedMode === 'slideshow'
				? 'Sync transitions and effects to the beat'
				: 'Make your effects react to the beat'}
		</p>
	{/if}
</div>

<style>
	.upload-screen {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 2.5rem;
		padding: 2rem;
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
	}

	.subtitle {
		font-size: 0.95rem;
		color: #666;
		font-weight: 400;
	}

	.mode-toggle {
		display: flex;
		gap: 0;
		border: 1.5px solid #333;
		border-radius: 999px;
		overflow: hidden;
	}

	.mode-btn {
		padding: 0.45rem 1.5rem;
		border: none;
		background: transparent;
		color: #666;
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
		color: #aaa;
	}

	.mode-btn.active {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}

	.mode-hint {
		font-size: 0.8rem;
		color: #555;
		margin-top: -1.5rem;
		text-align: center;
	}

	.drop-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.5rem;
		padding: 2.5rem 3rem;
		border: 1.5px dashed #333;
		border-radius: 12px;
		width: 100%;
		max-width: 520px;
		transition:
			border-color 0.2s,
			background-color 0.2s;
		cursor: pointer;
		outline: none;
	}

	.drop-zone:hover,
	.drop-zone:focus-visible {
		border-color: #555;
	}

	.drop-zone.dragging {
		border-color: #888;
		background-color: rgba(255, 255, 255, 0.03);
	}

	.load-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 2rem;
		border: 1.5px solid #444;
		border-radius: 999px;
		background: transparent;
		color: #ccc;
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
		border-color: #888;
		color: #fff;
		background-color: rgba(255, 255, 255, 0.05);
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
		background: #2a2a2a;
	}

	.or {
		font-size: 0.7rem;
		color: #555;
		letter-spacing: 0.05em;
		font-weight: 500;
	}

	.drop-hint {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: #555;
		font-size: 0.75rem;
		font-weight: 600;
		letter-spacing: 0.08em;
	}

	.music-zone {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.75rem 1.5rem;
		border: 1.5px dashed #222;
		border-radius: 10px;
		width: 100%;
		max-width: 520px;
		color: #444;
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
		border-color: #3a3a3a;
		color: #666;
	}

	.music-zone--selected {
		border-color: #2a2a2a;
		color: #666;
		cursor: default;
	}

	.optional {
		color: #333;
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

	.music-hint {
		font-size: 0.75rem;
		color: #333;
		margin-top: -1.5rem;
	}

	@media (max-width: 800px) {
		.upload-screen {
			gap: 1.25rem;
			padding: 1rem;
		}

		.hero {
			gap: 0.4rem;
		}

		.drop-zone {
			padding: 1.5rem 1.25rem;
		}

		.separator {
			display: none;
		}

		.drop-hint {
			display: none;
		}
	}
</style>
