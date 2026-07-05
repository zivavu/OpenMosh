<script lang="ts">
	import { Download, HelpCircle, Home, Library } from 'lucide-svelte';
	import { createAudioGraph } from '../../audio/audio-controller';
	import { AudioManager } from '../../audio/audio-manager.svelte';
	import { createTrackStore } from '../../audio/track-persistence';
	import { createKeyboardHandler } from '../../editor/keyboard';
	import {
		clearEffects as clearEffectsFn,
		generateMosh as generateMoshFn,
	} from '../../editor/mosh';
	import { executeRecording } from '../../editor/recording';
	import { createRecordingState } from '../../editor/recording-state.svelte';
	import { createEffectHistory } from '../../editor/history.svelte';
	import { loadSettings, saveSettings } from '../../editor/settings';
	import {
		loadInitialEffects,
		setVolumeLink,
		type EffectInstance,
	} from '../../effects';
	import type { GlRenderer } from '../../gl/renderer';
	import AudioTimeline from '../ui/AudioTimeline.svelte';
	import EffectsPanel from '../ui/EffectsPanel.svelte';
	import MobileSheet from '../ui/MobileSheet.svelte';
	import ResizeSettings from '../ui/ResizeSettings.svelte';
	import TrackAddBar from '../ui/TrackAddBar.svelte';
	import TrackLibrary from '../ui/TrackLibrary.svelte';
	import GlCanvas from './GlCanvas.svelte';
	import MoshGroup from './MoshGroup.svelte';
	import MoshSettingsPanel from './MoshSettingsPanel.svelte';
	import RecordGroup from './RecordGroup.svelte';
	import RecordOverlay from './RecordOverlay.svelte';
	import ShortcutsModal from '../ui/ShortcutsModal.svelte';

	interface Props {
		file: File;
		onfile: (f: File) => void;
		initialAudioFile?: File | null;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: import('../../gl/renderer').GlRenderer | null;
		onExit?: () => void;
	}

	let {
		file,
		onfile,
		initialAudioFile = null,
		warmCanvas = null,
		warmRenderer = null,
		onExit,
	}: Props = $props();
	let dragging = $state(false);
	let _mobileSheetRef: MobileSheet | undefined = undefined;

	let isVideo = $derived(file.type.startsWith('video/'));
	const isMobile = window.matchMedia('(pointer: coarse)').matches;
	let videoEl = $state<HTMLVideoElement | null>(null);
	let videoDuration = $state(0);
	let videoCurrentTime = $state(0);
	let videoSpanStart = $state(0);
	let videoSpanEnd = $state(0);
	let videoPlaying = $state(false);


	let format = $state<'png' | 'jpg' | 'webm'>(isMobile ? 'png' : 'webm');
	let isImageFormat = $derived(format === 'png' || format === 'jpg');
	let isVideoFormat = $derived(format === 'webm');
	let imageSrc = $state('');
	$effect(() => {
		const url = URL.createObjectURL(file);
		imageSrc = url;
		return () => URL.revokeObjectURL(url);
	});
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let glRenderer: GlRenderer | null = $state(null);
	let effects: EffectInstance[] = $state(loadInitialEffects());

	const saved = loadSettings();
	let moshMin = $state(saved.moshMin ?? 3);
	let moshMax = $state(saved.moshMax ?? 6);
	let randomizeOrder = $state(saved.randomizeOrder ?? true);
	let showMoshSettings = $state(false);
	let moshAudioLink = $state(saved.moshAudioLink ?? true);
	let moshAudioLinkStrength = $state(saved.moshAudioLinkStrength ?? 0.8);
	let showFps = $state(saved.showFps ?? false);
	let showShortcuts = $state(false);

	const shortcutGroups = [
		{
			title: 'Shortcuts',
			shortcuts: [
				{ keys: ['→'], description: 'Redo if available, otherwise new mosh' },
				{ keys: ['←', 'Ctrl/Cmd+Z'], description: 'Undo' },
				{ keys: ['Ctrl/Cmd+Shift+Z', 'Ctrl/Cmd+Y'], description: 'Redo' },
				{ keys: ['Ctrl/Cmd+S'], description: 'Save current frame' },
				{ keys: ['Space'], description: 'Play / pause' },
				{ keys: ['V'], description: 'Re-input current frame' },
			],
		},
	];

	const audio = new AudioManager({
		getEffects: () => effects,
		initialOutputVolume: saved.outputVolume ?? 1,
	});

	let normalizeGain = $state(1.0);

	// Sync audioEl DOM binding into the manager
	let audioEl = $state<HTMLAudioElement | undefined>(undefined);
	$effect(() => { audio.setAudioEl(audioEl); });

	// Seed track from audio selected on the upload screen
	$effect(() => {
		if (initialAudioFile && !audio.trackFile) {
			audio.trackFile = initialAudioFile;
		}
	});

	// Mute video when explicit audio track is active; re-hook video audio when cleared
	$effect(() => {
		if (!isVideo || !videoEl) return;
		if (audio.trackFile) {
			videoEl.muted = true;
		} else {
			ensureVideoAudioGraph();
		}
	});

	$effect(() => {
		// subscribe to all settings
		moshMin;
		moshMax;
		randomizeOrder;
		moshAudioLink;
		moshAudioLinkStrength;
		showFps;
		audio.outputVolume;
		saveSettings({
			moshMin,
			moshMax,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			showFps,
			outputVolume: audio.outputVolume,
		});
	});
	let currentFps = $state(0);

	let naturalWidth = $state<number | undefined>(undefined);
	let naturalHeight = $state<number | undefined>(undefined);
	let resizeWidth = $state(0);
	let resizeHeight = $state(0);

	let currentTrackId = $state<string | null>(null);

	const spanStore = createTrackStore<{ spanStart: number; spanEnd: number }>(
		'openmosh-single-span',
	);

	// Persist span changes for library tracks
	$effect(() => {
		audio.spanStart;
		audio.spanEnd;
		if (currentTrackId) {
			spanStore.save(currentTrackId, {
				spanStart: audio.spanStart,
				spanEnd: audio.spanEnd,
			});
		}
	});

	let trackInput: HTMLInputElement;

	$effect(() => {
		const nw = naturalWidth;
		const nh = naturalHeight;
		if (nw != null && nh != null && nw > 0 && nh > 0) {
			resizeWidth = nw;
			resizeHeight = nh;
		}
	});

	function openTrackPicker() {
		trackInput?.click();
	}

	function onTrackInputChange() {
		const f = trackInput?.files?.[0];
		if (f) {
			clearTrack();
			normalizeGain = 1.0;
			audio.trackFile = f;
			trackInput.value = '';
		}
	}

	function clearTrack() {
		audio.clearTrack();
		currentTrackId = null;
		normalizeGain = 1.0;
	}

	function onLibraryLoadTrack(file: File, trackId: string) {
		clearTrack();
		currentTrackId = trackId;
		audio.trackFile = file;
		const savedSpan = spanStore.load(trackId);
		if (savedSpan !== null) {
			audio.pendingSpan = { start: savedSpan.spanStart, end: savedSpan.spanEnd };
		}
	}

	function ensureVideoAudioGraph() {
		if (!videoEl || audio.audioContext || audio.trackFile) return;
		videoEl.muted = false;
		const state = createAudioGraph(videoEl);
		audio.applyAudioGraphState(state);
		audio.setNormalizeGain(normalizeGain);
		audio.audioContext!.resume().catch(() => {});
	}

	function playVideo() {
		if (!videoEl) return;
		audio.audioContext?.resume();
		videoEl.play().catch(() => {});
	}

	function pauseVideo() {
		videoEl?.pause();
	}

	function seekVideoTo(t: number) {
		if (!videoEl || !videoDuration) return;
		const tClamp = Math.max(0, Math.min(videoDuration, t));
		videoEl.currentTime = tClamp;
		videoCurrentTime = tClamp;
	}

	function getMoshOptions() {
		return {
			moshMin,
			moshMax,
			randomizeOrder,
			moshAudioLink,
			moshAudioLinkStrength,
			hasAudio: !!audio.trackFile && !!audio.audioContext,
			audioSampleRate: audio.audioSampleRate,
			frequencyData: audio.frequencyData,
		};
	}

	function playSpan() {
		audio.playAudio();
		if (isVideo && videoEl) {
			if (videoEl.currentTime < videoSpanStart || videoEl.currentTime >= videoSpanEnd) {
				videoEl.currentTime = videoSpanStart;
			}
			videoEl.play().catch(() => {});
		}
	}

	function pauseTrack() {
		audio.pauseAudio();
		if (isVideo) videoEl?.pause();
	}

	function seekTo(t: number) {
		audio.seekTo(t);
	}

	const history = createEffectHistory();
	let moshGroupRef: MoshGroup | undefined = undefined;
	// svelte-ignore non_reactive_update
	let recordGroupRef: RecordGroup | undefined = undefined;
	let trackLibraryRef: TrackLibrary | undefined = undefined;

	function generateMosh() {
		generateMoshFn(effects, getMoshOptions());
		history.push(effects);
	}

	function mosh() {
		const next = history.redo();
		if (next) {
			effects = next;
		} else {
			generateMosh();
		}
	}

	function undo() {
		const prev = history.undo();
		if (prev) effects = prev;
	}

	function redo() {
		const next = history.redo();
		if (next) effects = next;
	}

	function clearEffects() {
		clearEffectsFn(effects);
		history.push(effects);
	}

	function handleExit() {
		if (!onExit) return;
		if (recordingState.recording) {
			alert('Please cancel or wait for the recording to finish before exiting.');
			return;
		}
		if (history.canUndo && !confirm('Discard current edits and return to upload?')) {
			return;
		}
		onExit();
	}

	function reInput() {
		if (!canvasEl) return;
		canvasEl.toBlob((blob) => {
			if (!blob) return;
			const newFile = new File([blob], `openmosh-reinput-${Date.now()}.png`, {
				type: 'image/png',
			});
			effects.forEach((e) => (e.enabled = false));
			history.reset(effects);
			onfile(newFile);
		}, 'image/png');
	}

	const handleKeydown = createKeyboardHandler({
		save,
		mosh,
		undo,
		redo,
		reInput,
		playSpan,
		pauseTrack,
		hasTrack: () => (!!audio.trackFile && !!audioEl) || isVideo,
		isPlaying: () => audio.audioPlaying || videoPlaying,
	});

	function save() {
		if (!canvasEl) return;
		const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
		const ext = format === 'jpg' ? 'jpg' : 'png';
		canvasEl.toBlob(
			(blob) => {
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `openmosh-${Date.now()}.${ext}`;
				a.click();
				URL.revokeObjectURL(url);
			},
			mimeType,
			format === 'jpg' ? 0.92 : undefined,
		);
	}

	let showRecordSettings = $state(false);
	let recordDuration = $state(5);
	let recordFps = $state(60);
	let effectiveDuration = $derived(
		audio.trackFile && audio.trackDuration > 0 && audio.spanEnd - audio.spanStart > 0
			? audio.spanEnd - audio.spanStart
			: isVideo && videoDuration > 0
				? videoSpanEnd - videoSpanStart
				: recordDuration,
	);
	const recordingState = createRecordingState();

	async function startRecording() {
		if (!canvasEl || !glRenderer || recordingState.recording) return;
		showRecordSettings = false;

		await recordingState.run(
			(signal) =>
				executeRecording({
					fps: recordFps,
					recordDuration,
					canvas: canvasEl!,
					renderer: glRenderer!,
					effects,
					trackFile: audio.trackFile,
					trackDuration: audio.trackDuration,
					spanStart: audio.spanStart,
					spanEnd: audio.spanEnd,
					isVideo,
					videoEl,
					videoDuration,
					videoSpanStart,
					videoSpanEnd,
					file,
					normalizeGain,
					onProgress: (p) => {
						recordingState.recordProgress = p;
					},
					onFinalizing: () => {
						recordingState.recordFinalizing = true;
					},
					signal,
				}),
			{
				onError: (message) =>
					import('../../components/ui/toast.svelte').then(({ showToast }) =>
						showToast(message, 'error'),
					),
				fallbackErrorMessage:
					'Recording failed. Check the browser console for details.',
			},
		);

		if (isVideo && videoEl) videoEl.play().catch(() => {});
		if (canvasEl && glRenderer) {
			glRenderer.render(effects, performance.now() / 1000);
		}
	}

	function cancelRecording() {
		recordingState.cancel();
	}
</script>

<svelte:window
	onkeydown={handleKeydown}
	onpointerdown={(e) => {
		audio.audioContext?.resume();
		moshGroupRef?.handleClickOutside(e);
		recordGroupRef?.handleClickOutside(e);
	}}
/>

{#if audio.trackObjectUrl}
	<audio
		bind:this={audioEl}
		src={audio.trackObjectUrl}
		onloadedmetadata={() => audio.onAudioLoadedMetadata()}
		ontimeupdate={() => audio.onAudioTimeUpdate()}
		onplay={() => (audio.audioPlaying = true)}
		onpause={() => (audio.audioPlaying = false)}
		hidden
	></audio>
{/if}

{#snippet formatButtons()}
	<button class="format-btn" class:active={format === 'png'} onclick={() => (format = 'png')}
		>PNG</button
	>
	<button class="format-btn" class:active={format === 'jpg'} onclick={() => (format = 'jpg')}
		>JPG</button
	>
	<button class="format-btn" class:active={format === 'webm'} onclick={() => (format = 'webm')}
		>WebM</button
	>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="editor"
	class:drag-over={dragging}
	ondragover={(e) => {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragging = true;
	}}
	ondragenter={(e) => {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={(e) => {
		if (
			e.currentTarget === e.target ||
			!e.currentTarget.contains(e.relatedTarget as Node)
		)
			dragging = false;
	}}
	ondrop={(e) => {
		e.preventDefault();
		dragging = false;
		const f = e.dataTransfer?.files[0];
		if (!f) return;
		if (f.type.startsWith('audio/')) {
			clearTrack();
			audio.trackFile = f;
		} else if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
			onfile(f);
		}
	}}
>
	<TrackLibrary
		bind:this={trackLibraryRef}
		activeTrackName={audio.trackFile?.name ?? null}
		activeTrackId={currentTrackId}
		onLoadTrack={onLibraryLoadTrack}
		onPreviewStart={() => audio.pauseAudio()}
		mainPlaying={audio.audioPlaying}
		pendingTrack={audio.trackFile}
		onNormalizeChange={(gain) => {
			normalizeGain = gain;
			audio.setNormalizeGain(gain);
		}}
	/>
	<div class="main-area">
		<div class="top-bar">
			<div class="toolbar">
				{#if onExit}
					<button class="help-btn" onclick={handleExit} title="Back to upload">
						<Home size={14} />
					</button>
				{/if}
				<div class="format-group">
					{@render formatButtons()}
				</div>
			</div>
		</div>

		{#if isVideo}
			<video
				bind:this={videoEl}
				src={imageSrc}
				muted
				autoplay
				playsinline
				onloadedmetadata={() => {
					const dur = videoEl!.duration;
					videoDuration = dur;
					videoSpanStart = 0;
					videoSpanEnd = dur;
					recordDuration = Math.round(dur * 10) / 10;
					ensureVideoAudioGraph();
				}}
				ontimeupdate={() => {
					videoCurrentTime = videoEl?.currentTime ?? 0;
					// Span-loop: skip during recording (export seeks the video directly)
					if (!recordingState.recording && videoEl && videoCurrentTime >= videoSpanEnd) {
						videoEl.currentTime = videoSpanStart;
					}
				}}
				onended={() => {
					// Video reached natural end — loop back to span start
					if (!recordingState.recording && videoEl) {
						videoEl.currentTime = videoSpanStart;
						videoEl.play().catch(() => {});
					}
				}}
				onplay={() => (videoPlaying = true)}
				onpause={() => (videoPlaying = false)}
				onseeking={() => {
					audio.audioContext?.resume();
				}}
				style="display:none"
			></video>
		{/if}

		<GlCanvas
			{imageSrc}
			{effects}
			canvasWidth={resizeWidth || undefined}
			canvasHeight={resizeHeight || undefined}
			bind:canvasEl
			bind:glRenderer
			bind:naturalWidth
			bind:naturalHeight
			bind:fps={currentFps}
			showFps={showFps && !isImageFormat}
			videoEl={isVideo ? videoEl : null}
			freezeAnimation={isImageFormat}
			{warmCanvas}
			{warmRenderer}
		/>

		<div class="action-bar">
			<button
				class="library-btn"
				onclick={() => trackLibraryRef?.openLibrary()}
				title="Track library"
			>
				<Library size={12} />
			</button>
			<div class="mosh-group-wrap">
				<button
					class="help-btn"
					onclick={() => (showShortcuts = true)}
					title="Keyboard shortcuts"
				>
					<HelpCircle size={14} />
				</button>
				<MoshGroup
					bind:this={moshGroupRef}
					onMosh={mosh}
					onClear={clearEffects}
					onUndo={undo}
					canUndo={history.canUndo}
					canClear={history.canUndo}
					bind:showSettings={showMoshSettings}
				>
					{#snippet settingsContent()}
						<div class="format-group-mobile">
							{@render formatButtons()}
						</div>
						<div class="settings-divider"></div>
						<div class="mosh-setting-row">
							<label for="show-fps">Show FPS</label>
							<input id="show-fps" type="checkbox" bind:checked={showFps} />
						</div>
						<div class="settings-divider"></div>
						<ResizeSettings
							bind:width={resizeWidth}
							bind:height={resizeHeight}
							{naturalWidth}
							{naturalHeight}
						/>
					{/snippet}
				</MoshGroup>
			</div>
			{#if isImageFormat}
				<button class="action-btn save-btn" onclick={save}>
					<Download size={16} />
					SAVE
				</button>
			{/if}

			{#if isVideoFormat && !isMobile}
				<RecordGroup
					bind:this={recordGroupRef}
					recording={recordingState.recording}
					bind:showSettings={showRecordSettings}
				>
					{#snippet settingsContent()}
						{#if !audio.trackFile && !isVideo}
							<div class="mosh-setting-row">
								<label for="rec-duration">Duration</label>
								<input
									id="rec-duration"
									type="range"
									min="1"
									max="30"
									step="1"
									bind:value={recordDuration}
								/>
								<span class="mosh-setting-val">{recordDuration}s</span>
							</div>
						{:else}
							<div class="mosh-setting-row">
								<span class="rec-duration-label">Duration</span>
								<span class="mosh-setting-val"
									>{effectiveDuration.toFixed(1)}s</span
								>
							</div>
						{/if}
						<div class="mosh-setting-row">
							<label for="rec-fps">FPS</label>
							<select id="rec-fps" bind:value={recordFps}>
								<option value={15}>15</option>
								<option value={24}>24</option>
								<option value={30}>30</option>
								<option value={60}>60</option>
								<option value={120}>120</option>
							</select>
						</div>
						<button class="rec-start-btn" onclick={startRecording}>
							Start Recording
						</button>
					{/snippet}
				</RecordGroup>
			{/if}
		</div>
		{#if isVideo && videoDuration > 0}
			<AudioTimeline
				label="VID"
				trackDuration={videoDuration}
				trackCurrentTime={videoCurrentTime}
				spanStart={videoSpanStart}
				spanEnd={videoSpanEnd}
				isPlaying={videoPlaying}
				onPlay={playVideo}
				onPause={pauseVideo}
				onSeek={seekVideoTo}
				onSpanStartChange={(t) => (videoSpanStart = t)}
				onSpanEndChange={(t) => (videoSpanEnd = t)}
				ariaLabel="Video timeline"
				outputVolume={audio.outputVolume}
				onVolumeChange={audio.analyserNode && !audio.trackFile ? (v) => audio.setOutputVolume(v) : undefined}
			/>
		{/if}
		{#if !audio.trackFile}
			<TrackAddBar
				onOpenPicker={openTrackPicker}
				hintText="Add music to make effects react to the beat"
			/>
		{/if}
		{#if audio.trackFile && audio.trackDuration > 0}
			<AudioTimeline
				label="AUD"
				trackDuration={audio.trackDuration}
				trackCurrentTime={audio.trackCurrentTime}
				spanStart={audio.spanStart}
				spanEnd={audio.spanEnd}
				isPlaying={audio.audioPlaying}
				outputVolume={audio.outputVolume}
				onPlay={playSpan}
				onPause={pauseTrack}
				onSeek={seekTo}
				onSpanStartChange={(t) => (audio.spanStart = t)}
				onSpanEndChange={(t) => (audio.spanEnd = t)}
				onVolumeChange={(v) => audio.setOutputVolume(v)}
				onRemoveTrack={clearTrack}
			/>
		{/if}
		<input
			bind:this={trackInput}
			type="file"
			accept="audio/*"
			onchange={onTrackInputChange}
			hidden
		/>
	</div>
	<MobileSheet bind:this={_mobileSheetRef}>
		{#snippet settings()}
			<div class="mosh-settings-wrapper">
				<MoshSettingsPanel
					bind:moshMin
					bind:moshMax
					bind:randomizeOrder
					bind:moshAudioLink
					bind:moshAudioLinkStrength
				/>
			</div>
		{/snippet}
		{#snippet effectsPanel()}
			<EffectsPanel
				bind:effects
				hasTrack={!!audio.trackFile || (isVideo && !!audio.analyserNode)}
				spectrumData={audio.spectrumData}
				onVolumeLinkChange={(index, paramKey, link) => {
					effects = setVolumeLink(effects, index, paramKey, link);
				}}
				onEffectsReplaced={() => history.push(effects)}
			/>
		{/snippet}
	</MobileSheet>

	<RecordOverlay
		recording={recordingState.recording}
		recordProgress={recordingState.recordProgress}
		recordFinalizing={recordingState.recordFinalizing}
		onCancel={cancelRecording}
	/>

	{#if dragging}
		<div class="drop-overlay">
			<span>Drop image/video to replace · Drop audio to set track</span>
		</div>
	{/if}

	{#if showShortcuts}
		<ShortcutsModal groups={shortcutGroups} onClose={() => (showShortcuts = false)} />
	{/if}
</div>

<style>
	.editor {
		display: flex;
		height: 100%;
		width: 100%;
		overflow: hidden;
		position: relative;
	}

	.main-area {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		position: relative;
		min-width: 0;
	}

	.top-bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
	}

	.format-group {
		display: flex;
		background: rgba(30, 30, 30, 0.85);
		border: 1px solid #333;
		border-radius: 6px;
		overflow: hidden;
	}

	@media (max-width: 800px) {
		.format-group {
			display: none;
		}
	}

	.format-btn {
		padding: 0.35rem 0.9rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		font-family: inherit;
		background: none;
		border: none;
		color: #777;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.format-btn:not(:last-child) {
		border-right: 1px solid #333;
	}

	.format-btn.active {
		color: #ddd;
		background: rgba(255, 255, 255, 0.06);
	}

	.format-btn:hover {
		color: #ccc;
	}

	.mosh-group-wrap {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.help-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: none;
		border: 1.5px solid #444;
		color: #888;
		cursor: pointer;
		flex-shrink: 0;
		padding: 0;
		box-sizing: border-box;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.help-btn:hover {
		border-color: #777;
		color: #ccc;
	}

	@media (max-width: 800px) {
		.help-btn {
			width: 26px;
			height: 26px;
		}
	}

	.settings-divider {
		height: 1px;
		background: #333;
		margin: 0.15rem 0;
	}

	.format-group-mobile {
		display: none;
	}

	@media (max-width: 800px) {
		.format-group-mobile {
			display: flex;
			background: #111;
			border: 1px solid #333;
			border-radius: 6px;
			overflow: hidden;
			align-self: stretch;
		}

		.format-group-mobile .format-btn {
			flex: 1;
		}
	}

	/* Action bar */
	.action-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 1rem;
	}

	.library-btn {
		display: none;
	}

	.library-btn:hover {
		border-color: #777;
		color: #ccc;
	}

	@media (max-width: 800px) {
		.action-bar {
			padding: 0.6rem 0.5rem;
			gap: 0.4rem;
		}

		.action-btn {
			padding: 0.6rem 1.2rem;
			font-size: 0.72rem;
		}

		.library-btn {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 26px;
			height: 26px;
			border-radius: 50%;
			background: none;
			border: 1.5px solid #444;
			color: #888;
			cursor: pointer;
			flex-shrink: 0;
			padding: 0;
			box-sizing: border-box;
			transition:
				border-color 0.2s,
				color 0.2s;
		}
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 2rem;
		border: 1.5px solid #444;
		border-radius: 999px;
		background: transparent;
		color: #ccc;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}

	.action-btn:hover {
		border-color: #888;
		color: #fff;
		background: rgba(255, 255, 255, 0.04);
	}

	.mosh-setting-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.mosh-setting-row label,
	.rec-duration-label {
		font-size: 0.7rem;
		color: #888;
		min-width: 72px;
		flex-shrink: 0;
	}

	.mosh-setting-row input[type='range'] {
		flex: 1;
		height: 3px;
		appearance: none;
		background: #333;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.mosh-setting-row input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
	}

	.mosh-setting-row input[type='checkbox'] {
		appearance: none;
		width: 14px;
		height: 14px;
		border: 1px solid #555;
		border-radius: 2px;
		background: #1a1a1a;
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
	}

	.mosh-setting-row input[type='checkbox']:hover {
		border-color: #777;
	}

	.mosh-setting-row input[type='checkbox']:checked {
		background: #555;
		border-color: #888;
	}

	.mosh-setting-row input[type='checkbox']:checked::after {
		content: '';
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6l2.5 2.5 4.5-5' stroke='%23ddd' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			center/contain no-repeat;
	}

	.mosh-setting-row select {
		flex: 1;
		background: #1a1a1a;
		color: #aaa;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		font-size: 0.7rem;
		font-family: inherit;
		cursor: pointer;
		outline: none;
	}

	.mosh-setting-row select:focus {
		border-color: #555;
	}

	.mosh-setting-val {
		font-size: 0.7rem;
		color: #999;
		min-width: 20px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.editor.drag-over::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 99;
		border: 2px dashed #888;
		border-radius: 8px;
		pointer-events: none;
	}

	.rec-start-btn {
		margin-top: 0.25rem;
		padding: 0.45rem 1rem;
		border: 1.5px solid #c05050;
		border-radius: 6px;
		background: rgba(192, 80, 80, 0.1);
		color: #e88;
		font-size: 0.72rem;
		font-weight: 600;
		font-family: inherit;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition:
			background 0.15s,
			color 0.15s;
	}

	.rec-start-btn:hover {
		background: rgba(192, 80, 80, 0.2);
		color: #faa;
	}

	.drop-overlay {
		position: absolute;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.drop-overlay span {
		font-size: 1.2rem;
		font-weight: 600;
		color: #ccc;
		letter-spacing: 0.04em;
	}

	@media (max-width: 800px) {
		.main-area {
			padding-bottom: 44px;
		}
	}
</style>
