<script lang="ts">
	import { tick as domSettled, untrack } from "svelte";
	import { fileDrop } from "../../actions/file-drop";
	import { readJson, writeJson } from "../../storage";
	import {
		generateId,
		loadInitialEffects,
		loadPresets,
		setVolumeLink,
		type EffectInstance,
		type Preset,
	} from "../../effects";
	import { MicVocal, Plus } from "lucide-svelte";
	import {
		appendTextLane,
		createTextChainSource,
		createTextHistory,
		EMPTY_TEXT_TIMELINE,
		findTextClip,
		findTextClipLane,
		normalizeTextTimeline,
		resolveTextLayersAt,
		applyLyricsToTimeline,
		replaceTextClip,
		toggledTextTimeline,
		updateLane,
		type TextClip,
		type TextLane,
		type TextTimeline,
	} from "../../text";
	import type { LyricsSyncProps } from "../text/LyricsSyncModal.svelte";
	import TextTimelineLane from "../text/TextTimeline.svelte";
	import { setFeedbackChain } from "../ui/feedback.svelte";
	import TextClipPanel from "../text/TextClipPanel.svelte";
	import {
		applyLayerMoves,
		combinedLayerOrder,
		nextLayerZ,
		moveLayerTo,
		startLayerRowDrag,
	} from "../../timeline/layer-order";
	import type { GlRenderer, SourceFit } from "../../gl/renderer";
	import { fitPreviewSize, measureDisplaySize } from "../../gl/preview-size";
	import { detectBpm } from "../../slideshow/bpm-detector";
	import { SlideshowFrameDriver } from "../../slideshow/frame-driver";
	import { executeSlideshowRecording } from "../../slideshow/slideshow-recorder";
	import type { SlideshowConfig, SlideshowSlide } from "../../slideshow/types";
	import { DEFAULT_SLIDESHOW_CONFIG } from "../../slideshow/types";
	import {
		probeSlideVideo,
		SlideVideoSampler,
	} from "../../slideshow/video-sampler";
	import { showToast } from "../ui/toast.svelte";
	import { shuffleInPlace } from "../../utils";
	import { lazy } from "../../lazy";
	import { GeneratedSizeSync, readGenerated } from "../../generators";
	import GlCanvas from "../editor/GlCanvas.svelte";
	import RecordOverlay from "../editor/RecordOverlay.svelte";
	import AudioTimeline from "../ui/AudioTimeline.svelte";
	import TimelineStack from "../ui/TimelineStack.svelte";
	import type { TimelineStackState } from "../../editor/timeline-stack.svelte";
	import TimelineSegments from "./TimelineSegments.svelte";
	import EffectsPanel from "../ui/EffectsPanel.svelte";
	import MobileSheet from "../ui/MobileSheet.svelte";
	import TrackAddBar from "../ui/TrackAddBar.svelte";
	import TrackLibrary from "../ui/TrackLibrary.svelte";
	import SlideshowActionBar from "./SlideshowActionBar.svelte";
	import SlideshowConfigPanel from "./SlideshowConfigPanel.svelte";
	import SlideshowGridView from "./SlideshowGridView.svelte";
	import SlideshowTopBar from "./SlideshowTopBar.svelte";
	import ConfirmDialog from "../ui/ConfirmDialog.svelte";
	import { AudioManager } from "../../audio/audio-manager.svelte";
	import { DEFAULT_AUDIO_RESPONSE } from "../../audio/auto-range";
	import { createTrackStore } from "../../audio/track-persistence";
	import {
		loadRenderSettings,
		saveRenderSettings,
	} from "../../editor/render-settings";
	import { createRecordingState } from "../../editor/recording-state.svelte";
	import { createMoshSession } from "../../editor/mosh-session";
	import { PanelBurstController } from "../../editor/panel-burst";
	import { PENDING_EDIT } from "../../editor/edit-clock";
	import {
		redoLatest,
		undoLatest,
		type UndoSource,
	} from "../../editor/undo-router";
	import { snapshotUndoSource } from "../../timeline/snapshot-history.svelte";
	import { createSpanHistory } from "../../audio/span-history.svelte";
	import {
		isInteractiveTarget,
		isTextEntryTarget,
	} from "../../editor/shortcut-target";
	import { isModalKeyboardOpen } from "../../modal-keyboard";
	import {
		DEFAULT_SETTINGS,
		loadSettings,
		updateSettings,
	} from "../../editor/settings";
	import { linkBand } from "../../editor/link-band.svelte";
	import { saveSession } from "../../editor/sessions";
	import {
		deleteSequenceMediaProxy,
		getSequenceMediaProxy,
		pruneSequenceMedia,
		putSequenceMediaProxy,
	} from "../../editor/sequence-media-store";
	import { needsProxy, startProxyJob, type ProxyJob } from "../../video/proxy";
	import { gifsToVideo } from "../../media/gif";
	import {
		isProxyDisabled,
		setProxyDisabled,
	} from "../../video/proxy-preference";

	interface Props {
		initialFiles: File[];
		initialAudioFile?: File | null;
		initialTrackId?: string | null;
		initialConfig?: SlideshowConfig | null;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: import("../../gl/renderer").GlRenderer | null;
		onExit?: () => void;
	}

	let {
		initialFiles,
		initialAudioFile = null,
		initialTrackId = null,
		initialConfig = null,
		warmCanvas = null,
		warmRenderer = null,
		onExit,
	}: Props = $props();

	let slides: SlideshowSlide[] = $state([]);

	async function addFiles(files: FileList | File[]) {
		const imageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
		const videoTypes = ["video/mp4", "video/webm", "video/quicktime"];
		const all = await gifsToVideo(Array.from(files));
		const skipped = all.filter(
			(f) => !imageTypes.includes(f.type) && !videoTypes.includes(f.type),
		);
		if (skipped.length > 0) {
			showToast(
				skipped.length === all.length
					? `Can't add ${skipped.length === 1 ? `"${skipped[0].name}"` : "those files"}. Supported formats: PNG, JPG, WEBP, GIF, MP4, WEBM, MOV`
					: `Skipped ${skipped.length} unsupported file${skipped.length === 1 ? "" : "s"}`,
				skipped.length === all.length ? "error" : "info",
				6000,
			);
		}
		for (const file of all) {
			if (imageTypes.includes(file.type)) {
				const slide: SlideshowSlide = {
					id: generateId(),
					file,
					objectUrl: URL.createObjectURL(file),
					thumbUrl: null,
					thumbPending: true,
					presetIndex: null,
					kind: "image",
				};
				slides.push(slide);
				generateThumb(slide.id, slide.file, slide.objectUrl);
				void readGenerated(file).then((info) => {
					if (info && slides.some((s) => s.id === slide.id))
						sizeSync.track(slide.id, info.spec, info.width, info.height);
				});
			} else if (videoTypes.includes(file.type)) {
				const slide: SlideshowSlide = {
					id: generateId(),
					file,
					objectUrl: URL.createObjectURL(file),
					thumbUrl: null,
					thumbPending: true,
					presetIndex: null,
					kind: "video",
				};
				slides.push(slide);
				void probeVideoSlide(slide.id, file);
			}
		}
	}

	async function probeVideoSlide(id: string, file: File) {
		const probe = await probeSlideVideo(file);
		const i = slides.findIndex((s) => s.id === id);
		if (i === -1) return;
		if (!probe) {
			showToast(`Couldn't decode video "${file.name}"`, "error");
			removeSlide(id, false);
			return;
		}
		const s = slides[i];
		s.duration = probe.duration;
		s.width = probe.width;
		s.height = probe.height;
		if (probe.thumb) s.thumbUrl = URL.createObjectURL(probe.thumb);
		// The probe is the only shot at a video thumbnail.
		s.thumbPending = false;
		if (needsProxy(probe.width, probe.height)) {
			// The user's choice for this file decides whether a transcode happens.
			if (isProxyDisabled(file)) {
				s.proxyDisabled = true;
			} else {
				s.proxyPending = true;
				void makeSlideProxy(s.id, file);
			}
		}
	}

	/** Attach a <=1080p preview proxy: reuse the persisted one or transcode in the background. */
	async function makeSlideProxy(id: string, file: File) {
		const stored = await getSequenceMediaProxy(file);
		let proxy = stored;
		if (!proxy) {
			const job = startProxyJob(file, {
				onProgress: (progress) => {
					const live = slides.find((s) => s.id === id);
					if (live) live.proxyProgress = progress;
				},
				onSized: (width, height) => {
					const live = slides.find((s) => s.id === id);
					if (live) {
						live.proxyWidth = width;
						live.proxyHeight = height;
					}
				},
				onFailed: (reason) => {
					const live = slides.find((s) => s.id === id);
					if (live) live.proxyReason = reason;
				},
			});
			proxyJobs.set(id, job);
			proxy = await job.promise;
			proxyJobs.delete(id);
		}
		// A proxy that won't open would freeze the preview, so it gets the same
		// decodability check an added file gets.
		let opened: { width: number; height: number } | null = null;
		if (proxy) {
			const sampler = await SlideVideoSampler.create(proxy);
			if (sampler) opened = { width: sampler.width, height: sampler.height };
			sampler?.dispose();
			if (!sampler) {
				proxy = null;
				// A stored proxy that no longer opens must go, or the retry finds it again.
				if (stored) void deleteSequenceMediaProxy(file).catch(() => {});
			}
		}
		const live = slides.find((s) => s.id === id);
		if (!live) return;
		// Turned off during the transcode: nothing here may touch the slide's state.
		if (live.proxyDisabled) return;
		if (proxy) {
			// Persisted under the slide file's own id so the next run skips the transcode.
			if (!stored) void putSequenceMediaProxy(file, proxy).catch(() => {});
			live.proxyFile = proxy;
			live.proxyWidth = opened?.width;
			live.proxyHeight = opened?.height;
			live.proxyPending = false;
			live.proxyProgress = undefined;
			// A sampler on the original costs 4x the per-frame work; drop it for the proxy.
			videoSamplers.get(id)?.dispose();
			videoSamplers.delete(id);
			samplerPromises.delete(id);
		} else {
			live.proxyPending = false;
			live.proxyFailed = true;
		}
	}

	/** Turn the preview proxy on or off, the badge's click action. */
	function setSlideProxyEnabled(id: string, enabled: boolean) {
		const s = slides.find((x) => x.id === id);
		if (!s || s.kind !== "video") return;
		setProxyDisabled(s.file, !enabled);
		proxyJobs.get(id)?.cancel();
		proxyJobs.delete(id);
		s.proxyFile = undefined;
		s.proxyWidth = undefined;
		s.proxyHeight = undefined;
		s.proxyProgress = undefined;
		s.proxyFailed = false;
		s.proxyReason = undefined;
		s.proxyDisabled = !enabled;
		videoSamplers.get(id)?.dispose();
		videoSamplers.delete(id);
		samplerPromises.delete(id);
		const wanted = enabled && needsProxy(s.width ?? 0, s.height ?? 0);
		s.proxyPending = wanted;
		if (wanted) void makeSlideProxy(s.id, s.file);
	}

	function retrySlideProxy(id: string) {
		const s = slides.find((x) => x.id === id);
		if (!s || s.kind !== "video" || !s.proxyFailed) return;
		s.proxyFailed = false;
		s.proxyReason = undefined;
		s.proxyWidth = undefined;
		s.proxyHeight = undefined;
		s.proxyPending = true;
		void makeSlideProxy(s.id, s.file);
	}

	async function generateThumb(id: string, file: File, objectUrl: string) {
		const SIZE = 100;
		let thumbUrl: string;
		try {
			const full = await createImageBitmap(file);
			const scale = Math.max(SIZE / full.width, SIZE / full.height);
			const cropW = SIZE / scale;
			const cropH = SIZE / scale;
			const cropped = await createImageBitmap(
				full,
				(full.width - cropW) / 2,
				(full.height - cropH) / 2,
				cropW,
				cropH,
			);
			full.close();
			const resized = await createImageBitmap(cropped, {
				resizeWidth: SIZE,
				resizeHeight: SIZE,
				resizeQuality: "medium",
			});
			cropped.close();
			const canvas = new OffscreenCanvas(SIZE, SIZE);
			canvas.getContext("2d")!.drawImage(resized, 0, 0);
			resized.close();
			const blob = await canvas.convertToBlob({
				type: "image/jpeg",
				quality: 0.8,
			});
			thumbUrl = URL.createObjectURL(blob);
		} catch {
			thumbUrl = objectUrl;
		}
		const s = slides.find((s) => s.id === id);
		if (s) {
			s.thumbUrl = thumbUrl;
			s.thumbPending = false;
		}
	}

	const UNDO_WINDOW_MS = 8000;

	interface PendingRemoval {
		slide: SlideshowSlide;
		index: number;
		timer: ReturnType<typeof setTimeout>;
	}
	/** Removed slides awaiting Undo; their object URLs stay alive. */
	const pendingRemovals = new Map<string, PendingRemoval>();

	const sizeSync = new GeneratedSizeSync((id, url) => {
		const s = slides.find((s) => s.id === id) ?? pendingRemovals.get(id)?.slide;
		if (!s) {
			URL.revokeObjectURL(url);
			return;
		}
		const old = s.objectUrl;
		s.objectUrl = url;
		if (previewImageSrc === old) previewImageSrc = url;
		dropCachedImage(id);
		URL.revokeObjectURL(old);
	});

	$effect(() => {
		sizeSync.resize(resizeWidth, resizeHeight);
	});

	const loadGeneratePanel = lazy(
		() => import("../generators/GeneratePanel.svelte"),
	);
	let generateOpen = $state(false);

	// Photo booth on the beat: the song plays and the panel snaps a still per beat.
	const loadWebcamPanel = lazy(() => import("../webcam/WebcamPanel.svelte"));
	let webcamOpen = $state(false);
	let burstWallStart = 0;

	function burstTransport(playing: boolean) {
		burstWallStart = performance.now();
		if (playing) audio.playAudio();
		else audio.pauseAudio();
	}

	function burstBeat(): number | null {
		if (config.bpm <= 0) return null;
		if (audio.trackFile && audio.audioPlaying) {
			audio.tickCurrentTime();
			return beatsAt(audio.trackCurrentTime);
		}
		return ((performance.now() - burstWallStart) / 1000) * (config.bpm / 60);
	}

	function disposeSlide(s: SlideshowSlide) {
		sizeSync.untrack(s.id);
		URL.revokeObjectURL(s.objectUrl);
		if (s.thumbUrl && s.thumbUrl !== s.objectUrl)
			URL.revokeObjectURL(s.thumbUrl);
		videoSamplers.get(s.id)?.dispose();
		videoSamplers.delete(s.id);
		samplerPromises.delete(s.id);
		dropCachedImage(s.id);
	}

	function removeSlide(id: string, undoable = true) {
		const i = slides.findIndex((s) => s.id === id);
		if (i === -1) return;
		const [slide] = slides.splice(i, 1);
		proxyJobs.get(id)?.cancel();
		proxyJobs.delete(id);
		if (!undoable) {
			disposeSlide(slide);
			return;
		}
		const timer = setTimeout(() => {
			pendingRemovals.delete(id);
			disposeSlide(slide);
		}, UNDO_WINDOW_MS);
		pendingRemovals.set(id, { slide, index: i, timer });
		showToast(`Removed "${slide.file.name}"`, "info", UNDO_WINDOW_MS, {
			label: "Undo",
			run: () => restoreSlide(id),
		});
	}

	function restoreSlide(id: string) {
		const pending = pendingRemovals.get(id);
		if (!pending) return;
		clearTimeout(pending.timer);
		pendingRemovals.delete(id);
		slides.splice(Math.min(pending.index, slides.length), 0, pending.slide);
	}

	let showClearSlidesConfirm = $state(false);
	let slideInput = $state<HTMLInputElement | undefined>(undefined);

	function clearSlides() {
		showClearSlidesConfirm = false;
		for (const slide of [...slides]) removeSlide(slide.id, false);
	}

	function reorderSlides(from: number, to: number) {
		const [item] = slides.splice(from, 1);
		slides.splice(to, 0, item);
	}

	function shuffleSlides() {
		const previousOrder = slides.map((s) => s.id);
		shuffleInPlace(slides);
		showToast("Slides shuffled", "info", UNDO_WINDOW_MS, {
			label: "Undo",
			run: () => restoreOrder(previousOrder),
		});
	}

	function restoreOrder(order: string[]) {
		const byId = new Map(slides.map((s) => [s.id, s]));
		const restored = order
			.map((id) => byId.get(id))
			.filter((s): s is SlideshowSlide => s !== undefined);
		const known = new Set(order);
		slides = [...restored, ...slides.filter((s) => !known.has(s.id))];
	}

	let sessionSaveTimer: ReturnType<typeof setTimeout> | undefined;

	function saveSlideshowSession() {
		const files = slides.map((s) => s.file);
		if (files.length === 0) return;
		void saveSession(
			"slideshow",
			files,
			{ config: $state.snapshot(config) as SlideshowConfig },
			currentTrackId,
		)
			.then(() => pruneSequenceMedia())
			.catch((e) => {
				// Logged, not swallowed: a silent failure here is invisible.
				if (import.meta.env.DEV)
					console.error("Slideshow session save failed:", e);
			});
	}

	$effect(() => {
		// Deep-read, discarded: a shallow read of `slides`/`config` never re-arms the debounce.
		$state.snapshot(slides);
		$state.snapshot(config);
		// Loading a different song re-keys the session, so it has to re-save.
		currentTrackId;
		clearTimeout(sessionSaveTimer);
		sessionSaveTimer = setTimeout(saveSlideshowSession, 600);
		return () => clearTimeout(sessionSaveTimer);
	});

	function handleExit() {
		if (!onExit) return;
		if (recordingState.recording) {
			showToast(
				"Cancel or wait for the recording to finish before exiting",
				"error",
			);
			return;
		}
		// No confirm: the slideshow is saved as a session and offered back on upload.
		clearTimeout(sessionSaveTimer);
		saveSlideshowSession();
		onExit();
	}

	function setPresetIndex(slideId: string, presetIndex: number | null) {
		const s = slides.find((s) => s.id === slideId);
		if (s) s.presetIndex = presetIndex;
	}

	// svelte-ignore state_referenced_locally
	if (initialFiles.length > 0) {
		addFiles(initialFiles);
	}

	$effect(() => {
		return () => {
			for (const s of slides) {
				URL.revokeObjectURL(s.objectUrl);
				if (s.thumbUrl && s.thumbUrl !== s.objectUrl)
					URL.revokeObjectURL(s.thumbUrl);
			}
			// Slides still inside their undo window own live object URLs too
			for (const { slide, timer } of pendingRemovals.values()) {
				clearTimeout(timer);
				URL.revokeObjectURL(slide.objectUrl);
				if (slide.thumbUrl && slide.thumbUrl !== slide.objectUrl)
					URL.revokeObjectURL(slide.thumbUrl);
			}
			pendingRemovals.clear();
			sizeSync.dispose();
			for (const job of proxyJobs.values()) job.cancel();
			proxyJobs.clear();
			for (const sampler of videoSamplers.values()) sampler.dispose();
			videoSamplers.clear();
			samplerPromises.clear();
		};
	});

	const videoSamplers = new Map<string, SlideVideoSampler>();
	const samplerPromises = new Map<string, Promise<SlideVideoSampler | null>>();
	/** In-flight proxy transcodes, keyed by slide id, so removeSlide can stop one. */
	const proxyJobs = new Map<string, ProxyJob>();

	function ensureSampler(
		slide: SlideshowSlide,
	): Promise<SlideVideoSampler | null> {
		let p = samplerPromises.get(slide.id);
		if (!p) {
			// The proxy decodes at a fraction of the per-frame cost; the original is the fallback.
			const file = slide.proxyFile ?? slide.file;
			p = SlideVideoSampler.create(file).then((s) => {
				if (s) {
					// A proxy landed mid-creation: keeping the sampler would pin the slow path.
					if (slide.proxyFile && slide.proxyFile !== file) {
						s.dispose();
						return null;
					}
					videoSamplers.set(slide.id, s);
				}
				return s;
			});
			samplerPromises.set(slide.id, p);
		}
		return p;
	}

	const CONFIG_KEY = "openmosh-slideshow-config";
	function loadConfig(): SlideshowConfig {
		// A reopened session carries its own config; the global key is the new-session default.
		const restored = untrack(() => initialConfig);
		if (restored) {
			return {
				...DEFAULT_SLIDESHOW_CONFIG,
				...restored,
				text: normalizeTextTimeline(restored.text),
			};
		}
		const saved = readJson<Partial<SlideshowConfig> | null>(CONFIG_KEY, null);
		if (saved) {
			return {
				...DEFAULT_SLIDESHOW_CONFIG,
				...saved,
				text: normalizeTextTimeline(saved.text),
			};
		}
		return { ...DEFAULT_SLIDESHOW_CONFIG };
	}
	let config: SlideshowConfig = $state(loadConfig());

	$effect(() => {
		writeJson(CONFIG_KEY, { ...config, outputVolume: audio.outputVolume });
	});

	let currentTrackId = $state<string | null>(null);

	interface SegmentsEntry {
		segments: SlideshowConfig["segments"];
		bpm?: number;
		/** Absent on entries saved before the text timeline existed. */
		text?: TextTimeline;
		spanStart?: number;
		spanEnd?: number;
	}

	const segmentsStore = createTrackStore<SegmentsEntry>(
		"openmosh-track-segments",
		// Backward compat: old format stored the segments array directly
		(raw) => (Array.isArray(raw) ? { segments: raw } : (raw as SegmentsEntry)),
	);

	/** The span worth writing back: between adopting a track id and the audio element
	 * reporting its duration the live span reads 0/0, which would wipe the saved one. */
	function spanForSave(
		trackId: string,
	): Pick<SegmentsEntry, "spanStart" | "spanEnd"> {
		const pending = audio.pendingSpan;
		if (pending) return { spanStart: pending.start, spanEnd: pending.end };
		if (audio.trackDuration > 0 && audio.spanEnd > audio.spanStart) {
			return { spanStart: audio.spanStart, spanEnd: audio.spanEnd };
		}
		const prev = segmentsStore.load(trackId);
		if (prev?.spanStart !== undefined && prev.spanEnd !== undefined) {
			return { spanStart: prev.spanStart, spanEnd: prev.spanEnd };
		}
		return {};
	}

	function saveSegments(trackId: string) {
		segmentsStore.save(trackId, {
			segments: config.segments,
			bpm: config.bpm,
			text: $state.snapshot(config.text) as TextTimeline,
			...spanForSave(trackId),
		});
	}

	function onConfigChange(next: SlideshowConfig) {
		// A tempo set by hand outranks a detection still running.
		if (next.bpm !== config.bpm) bpmEpoch++;
		config = next;
		if (currentTrackId) saveSegments(currentTrackId);
	}

	$effect(() => {
		audio.spanStart;
		audio.spanEnd;
		if (currentTrackId) saveSegments(currentTrackId);
	});

	let selectedSegmentId = $state<string | null>(null);

	let effects: EffectInstance[] = $state(loadInitialEffects());

	// The feedback modal is mounted at the app root and can't otherwise see the chain.
	$effect(() => {
		setFeedbackChain(() => $state.snapshot(effects) as EffectInstance[]);
		return () => setFeedbackChain(null);
	});

	let presets: Preset[] = $state(loadPresets());

	const moshSession = createMoshSession({
		getEffects: () => effects,
		setEffects: (v) => (effects = v),
		getMoshOptions,
		cancelBurst: () => panelBurst.cancel(),
		endBurst: () => panelBurst.end(),
	});

	let canvasEl: HTMLCanvasElement | null = $state(null);
	let glRenderer: GlRenderer | null = $state(null);
	let naturalWidth = $state<number | undefined>(undefined);
	let naturalHeight = $state<number | undefined>(undefined);
	let currentFps = $state(0);
	let showFps = $state(loadSettings().showFps ?? DEFAULT_SETTINGS.showFps);
	// GlCanvas is externally driven here, so the preview loop feeds this counter instead.
	let frameTimes: number[] = [];
	let lastFpsUpdate = 0;
	/** Only called while the overlay is on; see GlCanvas.trackFps. */
	function trackFps(now: number) {
		frameTimes.push(now);
		if (now - lastFpsUpdate < 400) return;
		lastFpsUpdate = now;
		frameTimes = frameTimes.filter((t) => t > now - 1000);
		currentFps = frameTimes.length;
	}
	$effect(() => {
		updateSettings({ showFps });
	});
	// Slides rarely share the output aspect, so this one matters here.
	let sourceFit = $state<SourceFit>(
		loadSettings().sourceFit ?? DEFAULT_SETTINGS.sourceFit,
	);
	$effect(() => {
		updateSettings({ sourceFit });
	});
	let resizeWidth = $state(0);
	let resizeHeight = $state(0);

	/** Set when a project restores its output size, so slides finishing their load don't
	 * default it back to their own. */
	let sizeRestoredFromProject = false;

	$effect(() => {
		const nw = naturalWidth;
		const nh = naturalHeight;
		if (nw != null && nh != null && nw > 0 && nh > 0) {
			if (sizeRestoredFromProject) {
				sizeRestoredFromProject = false;
				return;
			}
			resizeWidth = nw;
			resizeHeight = nh;
		}
	});

	// Preview render size, decoupled from the output size; the video-first path drives it itself.
	let previewArea = $state<HTMLDivElement | null>(null);
	let displayW = $state(0);
	let displayH = $state(0);
	$effect(() => {
		const el = previewArea;
		if (!el) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const measure = () => {
			const { width, height } = measureDisplaySize(el);
			displayW = width;
			displayH = height;
		};
		measure();
		const ro = new ResizeObserver(() => {
			clearTimeout(timer);
			timer = setTimeout(measure, 150);
		});
		ro.observe(el);
		return () => {
			clearTimeout(timer);
			ro.disconnect();
		};
	});
	const previewRenderSize = $derived(
		fitPreviewSize(resizeWidth, resizeHeight, displayW, displayH),
	);

	let previewImageSrc = $state("");
	$effect(() => {
		const first = slides[0];
		if (!first) return;
		if (first.kind === "image") {
			if (!previewImageSrc) previewImageSrc = first.objectUrl;
			return;
		}
		if (previewImageSrc || !glRenderer || naturalWidth != null) return;
		if (first.width && first.height) {
			glRenderer.initVideoSource(first.width, first.height);
			naturalWidth = first.width;
			naturalHeight = first.height;
			void ensureSampler(first).then(async (sampler) => {
				if (!sampler || !glRenderer || previewPlaying) return;
				const frame = await sampler.at(0);
				if (frame) {
					glRenderer.updateSourceFrame(frame);
					frame.close();
					glRenderer.render(effects, 0, currentTextLayers());
				}
			});
		}
	});

	// GlCanvas applies the preview size only after its own load, which the video-first
	// path bypasses. Also re-runs when recording ends.
	$effect(() => {
		recordingState.recording;
		if (previewImageSrc || !glRenderer || naturalWidth == null) return;
		if (previewRenderSize) {
			glRenderer.resize(previewRenderSize.width, previewRenderSize.height);
			glRenderer.setSourceFit(sourceFit);
			if (!previewPlaying) glRenderer.render(effects, 0, currentTextLayers());
		}
	});

	// Image-first counterpart: GlCanvas uploads the texture and sizes the canvas but
	// never draws, since the slideshow owns rendering.
	$effect(() => {
		recordingState.recording;
		if (!previewImageSrc || !glRenderer || naturalWidth == null) return;
		if (previewPlaying) return;
		// Re-draw after a resize and on effect edits, so a stopped preview reflects the panel.
		previewRenderSize;
		for (const e of effects) {
			e.enabled;
			for (const k of Object.keys(e.values)) e.values[k];
		}
		textTime;
		textTimeline;
		// Set here too: this effect can run before the child's, leaving no later frame to fix it.
		glRenderer.setSourceFit(sourceFit);
		glRenderer.setBeat(beatsAt(textTime), config.bpm / 60);
		glRenderer.render(effects, 0, currentTextLayers());
	});

	const savedOutputVolume = loadConfig().outputVolume ?? 1;

	const audio = new AudioManager({
		// One group: the slideshow drives effects from beats, so there are no per-lane responses.
		getLinkGroups: () => [
			{
				scope: "",
				effects:
					previewPlaying && previewEffects.length > 0
						? previewEffects
						: effects,
				response: DEFAULT_AUDIO_RESPONSE,
			},
			// Each text layer's chain follows the music too, read off the resolved layers.
			...currentTextLayers().map((layer) => ({
				scope: layer.laneId,
				effects: layer.effects,
				response: DEFAULT_AUDIO_RESPONSE,
			})),
		],
		initialOutputVolume: savedOutputVolume,
		initialLoop: loadSettings().loopAudio ?? false,
	});

	function toggleLoop() {
		audio.loopAudio = !audio.loopAudio;
		updateSettings({ loopAudio: audio.loopAudio });
	}

	// Close the AudioContext on unmount so repeated visits don't leak contexts.
	$effect(() => () => audio.disposeAudioGraph());

	let audioEl = $state<HTMLAudioElement | undefined>(undefined);
	$effect(() => {
		audio.setAudioEl(audioEl);
	});

	$effect(() => {
		if (initialAudioFile && !audio.trackFile) {
			audio.trackFile = initialAudioFile;
			// Reopened from a saved session: adopting the library id brings its segments back.
			if (initialTrackId) adoptLibraryTrack(initialTrackId);
		}
	});

	let trackInput: HTMLInputElement;

	function openTrackPicker() {
		trackInput?.click();
	}

	function onTrackInputChange() {
		const f = trackInput?.files?.[0];
		if (f) {
			// Drop the previous track's normalize gain until the auto-add measurement lands.
			audio.setNormalizeGain(1.0);
			audio.trackFile = f;
			trackInput.value = "";
		}
	}

	function clearTrack() {
		// Unloading is a song change too, so dropping the track saves like a switch does.
		if (currentTrackId) saveSegments(currentTrackId);
		audio.clearTrack();
		currentTrackId = null;
	}

	function onLibraryLoadTrack(file: File, trackId: string, autoplay = false) {
		stopPreview();
		if (currentTrackId) saveSegments(currentTrackId);
		// Partial reset: trackDuration and trackFile are left, so AudioTimeline doesn't flash.
		audio.resetPlayback();
		currentTrackId = null;
		audio.disposeAudioGraph();
		currentTrackId = trackId;
		audio.trackFile = file;
		applySavedSegments(trackId);
		if (autoplay) audio.autoplayOnLoad = true;
	}

	function applySavedSegments(trackId: string) {
		const saved = segmentsStore.load(trackId);
		if (saved === null) return;
		config = {
			...config,
			segments: saved.segments,
			...(saved.bpm !== undefined ? { bpm: saved.bpm } : {}),
			...(saved.text !== undefined
				? { text: normalizeTextTimeline(saved.text) }
				: {}),
		};
		if (saved.bpm !== undefined) {
			// The song brought its own tempo back; a running detection must not overwrite it.
			bpmEpoch++;
			bpmRestoredFor = trackId;
		}
		// An empty span is an older build's leftover, never a choice; use the whole track.
		if (
			saved.spanStart !== undefined &&
			saved.spanEnd !== undefined &&
			saved.spanEnd > saved.spanStart
		) {
			audio.pendingSpan = { start: saved.spanStart, end: saved.spanEnd };
		}
	}

	function adoptLibraryTrack(trackId: string) {
		if (currentTrackId === trackId) return;
		currentTrackId = trackId;
		applySavedSegments(trackId);
	}

	let bpmDetecting = $state(false);
	let bpmDetectAbort: AbortController | null = $state(null);
	/** Bumped when the BPM is settled elsewhere; older detections yield to it. */
	let bpmEpoch = 0;
	let autoBpmFor: File | null = null;
	let bpmRestoredFor: string | null = null;

	// A new track detects its own tempo: everything here is cut to the beat.
	$effect(() => {
		const file = audio.trackFile;
		if (!file) return;
		untrack(() => {
			if (autoBpmFor === file) return;
			autoBpmFor = file;
			if (currentTrackId && bpmRestoredFor === currentTrackId) return;
			void runBpmDetection(true);
		});
	});

	async function runBpmDetection(auto = false) {
		if (!audio.trackFile || bpmDetecting) return;
		const file = audio.trackFile;
		const epoch = bpmEpoch;
		bpmDetecting = true;
		bpmDetectAbort = new AbortController();
		try {
			const result = await detectBpm(file, bpmDetectAbort.signal);
			// The automatic pass never overrules what landed while it ran.
			if (auto && (bpmEpoch !== epoch || audio.trackFile !== file)) return;
			config = { ...config, bpm: result.bpm, beatOffset: result.offset };
		} catch (e) {
			if (!(e instanceof DOMException && e.name === "AbortError")) {
				console.error("BPM detection failed:", e);
				showToast(
					"Couldn't detect the BPM for this track. Set it by hand or use Tap.",
					"error",
					6000,
				);
			}
		} finally {
			bpmDetecting = false;
			bpmDetectAbort = null;
		}
	}

	// A reopened show lands on the preview; a fresh pile of media starts on the grid.
	let activeView: "grid" | "preview" = $state(
		untrack(() => initialConfig) ? "preview" : "grid",
	);
	let previewPlaying = $state(false);
	let previewRafId = $state<number | null>(null);
	let previewEffects: EffectInstance[] = $state([]);
	// A silent preview runs on a wall clock; these anchor it at the static marker.
	let noTrackAnchor = 0;
	let noTrackWallStart = 0;
	let previewDriver: SlideshowFrameDriver | null = null;

	// ImageBitmaps, not <img>: uploading an <img> re-decodes it on every texImage2D.
	const imageCache = new Map<string, ImageBitmap>();
	/** In-flight decodes, so a slide recurring before it lands isn't decoded twice. */
	const imageDecodes = new Map<string, Promise<void>>();

	/** Bitmaps are decoded at the size the preview draws, not the file's size, rounded
	 * up to 512px steps so window resizing doesn't invalidate the whole cache. */
	const bitmapCap = $derived(
		Math.max(
			1024,
			Math.ceil(
				Math.max(
					previewRenderSize?.width ?? 0,
					previewRenderSize?.height ?? 0,
				) / 512,
			) * 512,
		),
	);

	/** Backstop for pools too big to hold at preview size (~256 MB of RGBA). */
	const IMAGE_CACHE_PIXELS = 64_000_000;
	let cachedPixels = 0;
	/** Play position of the last slide asked for; eviction measures against it. */
	let lastRequestedIndex = 0;

	function dropCachedImage(id: string) {
		const bitmap = imageCache.get(id);
		if (!bitmap) return;
		cachedPixels -= bitmap.width * bitmap.height;
		bitmap.close();
		imageCache.delete(id);
	}

	function clearImageCache() {
		for (const id of [...imageCache.keys()]) dropCachedImage(id);
		cachedPixels = 0;
	}

	let cachedCap = 0;

	// Only a preview that outgrows the cached bitmaps forces a re-decode; oversized is fine.
	$effect(() => {
		const cap = bitmapCap;
		untrack(() => {
			if (cap <= cachedCap) return;
			clearImageCache();
			cachedCap = cap;
		});
	});

	function evictImages() {
		// Slides loop in order, so evict the one furthest ahead of the playhead, not the oldest.
		while (cachedPixels > IMAGE_CACHE_PIXELS && imageCache.size > 4) {
			let victim: string | null = null;
			let furthest = -1;
			for (const id of imageCache.keys()) {
				const i = slides.findIndex((s) => s.id === id);
				const ahead =
					i < 0
						? Number.MAX_SAFE_INTEGER
						: (i - lastRequestedIndex + slides.length) % slides.length;
				if (ahead > furthest) {
					furthest = ahead;
					victim = id;
				}
			}
			if (!victim) break;
			dropCachedImage(victim);
		}
	}

	function loadSlideBitmap(slide: SlideshowSlide): Promise<void> {
		if (imageCache.has(slide.id)) return Promise.resolve();
		const pending = imageDecodes.get(slide.id);
		if (pending) return pending;
		const cap = bitmapCap;
		const job = fetch(slide.objectUrl)
			.then((r) => r.blob())
			.then((blob) => createImageBitmap(blob))
			.then(async (full) => {
				const scale = Math.min(1, cap / Math.max(full.width, full.height));
				if (scale >= 1) return full;
				const shrunk = await createImageBitmap(full, {
					resizeWidth: Math.max(1, Math.round(full.width * scale)),
					resizeHeight: Math.max(1, Math.round(full.height * scale)),
					resizeQuality: "high",
				});
				full.close();
				return shrunk;
			})
			.then((bitmap) => {
				// Dropped while decoding, or decoded against a cap that has since changed.
				if (!slides.some((s) => s.id === slide.id) || cap < bitmapCap) {
					bitmap.close();
					return;
				}
				imageCache.set(slide.id, bitmap);
				cachedCap = Math.max(cachedCap, cap);
				cachedPixels += bitmap.width * bitmap.height;
				evictImages();
			})
			.catch(() => {})
			.finally(() => imageDecodes.delete(slide.id));
		imageDecodes.set(slide.id, job);
		return job;
	}

	function getCachedImage(slide: SlideshowSlide): ImageBitmap | undefined {
		const at = slides.indexOf(slide);
		if (at >= 0) lastRequestedIndex = at;
		const hit = imageCache.get(slide.id);
		if (hit) return hit;
		void loadSlideBitmap(slide);
		return undefined;
	}

	async function startPreview() {
		if (slides.length === 0) return;
		activeView = "preview";
		previewPlaying = true;

		// Measure the preview box now, or a pool decoded against the grid's size is thrown out.
		await domSettled();
		if (previewArea) {
			const { width, height } = measureDisplaySize(previewArea);
			displayW = width;
			displayH = height;
		}

		await Promise.all([
			...slides.filter((s) => s.kind === "image").map(loadSlideBitmap),
			...slides
				.filter((s) => s.kind === "video")
				.map((slide) => ensureSampler(slide).then(() => {})),
		]);

		if (!previewPlaying || !glRenderer) return;

		// Fresh run: video slides start from their beginning, like the export
		for (const sampler of videoSamplers.values()) sampler.reset();

		if (audio.trackFile) {
			// Resume from the static marker rather than wherever it last stopped.
			if (timelineAxis) audio.seekTo(timelineAxis.staticTime);
			audio.playAudio();
			selectedSegmentId = null;
		} else {
			noTrackAnchor = timelineAxis?.staticTime ?? textTime;
			noTrackWallStart = performance.now() / 1000;
		}

		previewDriver?.dispose();
		const driver = new SlideshowFrameDriver({
			getConfig: () => config,
			getSlides: () => slides,
			baseEffects: effects,
			getMoshOptions,
			getRenderer: () => glRenderer!,
			sources: {
				getImage: getCachedImage,
				getSampler: (slide) => videoSamplers.get(slide.id),
			},
			// Preview ignores the `ready` promise; this stops the decoder stalling inside it too.
			waitForFrames: false,
		});
		previewDriver = driver;
		// Raw reference of the last chain handed to `previewEffects`; the proxy never matches.
		let lastAppliedEffects: EffectInstance[] | null = null;

		function tick() {
			if (!previewPlaying || !glRenderer) return;

			let t: number;
			if (audio.trackFile && audio.audioPlaying) {
				audio.tickCurrentTime();
				t = audio.trackCurrentTime;
				// A run started past the span end ignores it and plays out the track.
				if (audio.pastSpan) {
					if (t >= audio.trackDuration) {
						stopPreview();
						return;
					}
				} else if (t >= audio.spanEnd) {
					if (audio.loopAudio) {
						audio.seekTo(audio.spanStart);
						t = audio.spanStart;
					} else {
						stopPreview();
						return;
					}
				}
			} else if (audio.trackFile && audio.trackDuration > 0) {
				// The track stopped on its own, so the preview goes with it, not the silent clock.
				stopPreview();
				return;
			} else {
				const fallbackInterval =
					config.subdivision === 0 ? 1 : (60 / config.bpm) * config.subdivision;
				const cycle = slides.length * fallbackInterval;
				// Signed modulo, so positions before the anchor still wrap forward.
				const elapsed = performance.now() / 1000 - noTrackWallStart;
				t =
					((((elapsed + noTrackAnchor - config.beatOffset) % cycle) + cycle) %
						cycle) +
					config.beatOffset;
			}

			// The video-frame upload is unawaited: the render loop must not stall on the decoder.
			const nowMs = performance.now();
			if (showFps) trackFps(nowMs);
			const frame = driver.advance(t);
			if (frame.effects !== lastAppliedEffects) {
				lastAppliedEffects = frame.effects;
				previewEffects = frame.effects;
			}

			textTime = t;
			// Slideshow drives the renderer itself, so it owns this call too.
			glRenderer.setSpectrum(audio.frequencyData, nowMs / 1000);
			glRenderer.setBeat(beatsAt(t), config.bpm / 60);
			glRenderer.render(
				previewEffects.length > 0 ? previewEffects : effects,
				nowMs / 1000,
				currentTextLayers(),
			);

			previewRafId = requestAnimationFrame(tick);
		}

		previewRafId = requestAnimationFrame(tick);
	}

	function stopPreview() {
		previewPlaying = false;
		frameTimes = [];
		currentFps = 0;
		if (previewRafId !== null) {
			cancelAnimationFrame(previewRafId);
			previewRafId = null;
		}
		if (audio.audioPlaying) {
			audio.pauseAudio();
		}
		previewDriver?.dispose();
		previewDriver = null;
		previewEffects = [];
	}

	function togglePreview() {
		if (previewPlaying) stopPreview();
		else startPreview();
	}

	function addTextLane() {
		pushTextHistory();
		setTextTimeline(appendTextLane(textTimeline, nextLayerZ(layerOrder)));
	}

	function seekMaster(t: number) {
		textTime = t;
		if (audio.trackFile) audio.seekTo(t);
		else if (previewPlaying) {
			// The silent preview runs off a wall clock, so a seek mid-run has to re-anchor it.
			noTrackAnchor = t;
			noTrackWallStart = performance.now() / 1000;
		}
	}

	function getMoshOptions() {
		return {
			moshMin: config.moshMin,
			moshMax: config.moshMax,
			randomizeOrder: true,
			moshAudioLink: config.moshAudioLink,
			moshAudioLinkStrength: config.moshAudioLinkStrength,
			moshLinkBand: linkBand.value,
			hasAudio: !!audio.trackFile && !!audio.audioContext,
		};
	}

	// Panel edits mutate in place, so the post-edit state is pushed once the burst settles.
	const panelBurst = new PanelBurstController({
		onEditStart: () => () => moshSession.pushEdit(effects),
	});
	const endPanelBurst = () => panelBurst.end();
	const panelBeforeEdit = (coalesceKey?: string) =>
		panelBurst.beforeEdit(coalesceKey);

	// The span handles are an edit like any other; see span-history.svelte.ts.
	const spanHistory = createSpanHistory(audio);
	$effect(() => spanHistory.trackChanged(currentTrackId));

	// Ctrl+Z lands on whichever stack was edited last, not the selected one. See
	// Editor.svelte and undo-router.ts.
	let segmentUndo = $state<UndoSource | undefined>(undefined);
	const undoSources = (): (UndoSource | undefined)[] => [
		spanHistory.undoSource,
		snapshotUndoSource(
			textHistory,
			() => $state.snapshot(textTimeline) as TextTimeline,
			setTextTimeline,
		),
		segmentUndo,
		{
			get undoSeq() {
				// A burst inside its coalescing window hasn't reached its stack yet, and is newest.
				return panelBurst.open ? PENDING_EDIT : moshSession.undoSeq;
			},
			get redoSeq() {
				return moshSession.redoSeq;
			},
			undo: () => moshSession.undoEdit(),
			redo: () => moshSession.redoEdit(),
		},
	];

	/** Random and smooth decide what is on themselves, so the switches would set
	 * something overwritten before it renders. */
	let panelRolledNote = $derived(
		config.moshMode === "random"
			? "Random mode rolls the switches, order and params every beat. Hide an effect to keep it out of the roll."
			: config.moshMode === "smooth"
				? "Smooth mode toggles the chain as the track runs, so the switches follow it. Hide an effect to keep it out of the drift."
				: null,
	);

	let recordFps = $state(60);
	let recordDuration = $state(10);

	// Export settings ride with the song under their own mode prefix.
	let renderKey = $derived(currentTrackId && `slideshow:${currentTrackId}`);
	let renderKeyLoaded = $state<string | null>(null);

	$effect(() => {
		const key = renderKey;
		if (!key || untrack(() => renderKeyLoaded) === key) return;
		untrack(() => {
			renderKeyLoaded = key;
			const saved = loadRenderSettings(key);
			if (saved?.fps) recordFps = saved.fps;
			if (saved?.duration) recordDuration = saved.duration;
			if (saved?.width && saved?.height) {
				resizeWidth = saved.width;
				resizeHeight = saved.height;
				sizeRestoredFromProject = true;
			}
		});
	});

	$effect(() => {
		const key = renderKey;
		const fps = recordFps;
		const duration = recordDuration;
		const width = resizeWidth;
		const height = resizeHeight;
		// Until this song's own values are in, the live ones are the last song's.
		if (!key || renderKeyLoaded !== key) return;
		saveRenderSettings(key, {
			fps,
			duration,
			...(width > 0 && height > 0 ? { width, height } : {}),
		});
	});

	// Keyed to audio time, the same clock the beat driver runs on.
	let selectedTextClipId = $state<string | null>(null);
	let lyricsOpen = $state(false);
	let textTime = $state(0);
	const textHistory = createTextHistory();

	let textTimeline = $derived(config.text ?? EMPTY_TEXT_TIMELINE);
	let textDuration = $derived(
		audio.trackFile && audio.trackDuration > 0
			? audio.trackDuration
			: recordDuration,
	);
	/** The slideshow has text lanes only, but the stack order is the same one. */
	let layerOrder = $derived(combinedLayerOrder([], textTimeline.lanes));

	function reorderLayer(laneId: string, toIndex: number, coalesceKey?: string) {
		const moves = moveLayerTo(layerOrder, laneId, toIndex);
		if (!moves) return;
		pushTextHistory(coalesceKey);
		setTextTimeline({
			...textTimeline,
			lanes: applyLayerMoves(textTimeline.lanes, moves),
		});
	}

	let draggingLaneId = $state<string | null>(null);

	function startLayerDrag(laneId: string, e: PointerEvent) {
		startLayerRowDrag(e, laneId, {
			order: () => layerOrder,
			reorder: reorderLayer,
			setDragging: (id) => (draggingLaneId = id),
		});
	}
	let selectedTextClip = $derived(
		findTextClip(textTimeline, selectedTextClipId),
	);
	let selectedTextLane = $derived(
		findTextClipLane(textTimeline, selectedTextClipId),
	);

	// Same resolver the export builds, so an auto clip's rolls reproduce.
	const previewTextChains = createTextChainSource(getMoshOptions);

	function currentTextLayers() {
		return resolveTextLayersAt(textTimeline, textTime, previewTextChains);
	}

	function beatsAt(t: number): number | null {
		if (config.bpm <= 0) return null;
		return ((t - config.beatOffset) * config.bpm) / 60;
	}

	function setTextTimeline(next: TextTimeline) {
		onConfigChange({ ...config, text: next });
	}

	function pushTextHistory(coalesceKey?: string) {
		textHistory.push(
			$state.snapshot(textTimeline) as TextTimeline,
			coalesceKey,
		);
	}

	function updateTextClip(next: TextClip) {
		setTextTimeline(replaceTextClip(textTimeline, next));
	}

	function updateTextLane(next: TextLane) {
		setTextTimeline(updateLane(textTimeline, next.id, () => next));
	}

	function toggleTextTimeline() {
		pushTextHistory();
		setTextTimeline(toggledTextTimeline(textTimeline, nextLayerZ(layerOrder)));
		if (!textTimeline.enabled) {
			selectedTextClipId = null;
			lyricsOpen = false;
		}
	}

	let lyricsSync = $derived<LyricsSyncProps | null>(
		textTimeline.enabled
			? {
					isPlaying: previewPlaying,
					spanStart: audio.spanStart,
					spanEnd: audio.spanEnd,
					getCurrentTime: () => textTime,
					onPlay: () => void startPreview(),
					onPause: stopPreview,
					onSeek: (t) => {
						textTime = t;
						if (audio.trackFile) audio.seekTo(t);
					},
					onApply: applyLyrics,
				}
			: null,
	);

	function applyLyrics(clips: TextClip[]) {
		if (clips.length === 0) return;
		pushTextHistory();
		setTextTimeline(applyLyricsToTimeline(textTimeline, clips));
		selectedTextClipId = clips[0].id;
	}
	const recordingState = createRecordingState();

	async function startRecording() {
		if (
			!canvasEl ||
			!glRenderer ||
			recordingState.recording ||
			slides.length === 0
		)
			return;

		if (previewPlaying) stopPreview();
		// Generated slides may still be catching up with a size change.
		await sizeSync.settle();

		await recordingState.run(
			(signal) =>
				executeSlideshowRecording({
					fps: recordFps,
					slides: [...slides],
					config,
					baseEffects: effects.map((e) => ({
						...e,
						values: { ...e.values },
						volumeLinks: e.volumeLinks
							? JSON.parse(JSON.stringify(e.volumeLinks))
							: undefined,
					})),
					audioFile: audio.trackFile,
					audioStart: audio.spanStart,
					audioEnd: audio.spanEnd,
					normalizeGain: audio.normalizeGain,
					noAudioDuration: recordDuration,
					canvas: canvasEl!,
					renderer: glRenderer!,
					outputWidth: resizeWidth > 0 ? resizeWidth : undefined,
					outputHeight: resizeHeight > 0 ? resizeHeight : undefined,
					moshOptions: getMoshOptions(),
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
					import("../../components/ui/toast.svelte").then(({ showToast }) =>
						showToast(message, "error"),
					),
				fallbackErrorMessage: "Recording failed.",
			},
		);

		if (canvasEl && glRenderer) {
			if (previewRenderSize) {
				glRenderer.resize(previewRenderSize.width, previewRenderSize.height);
			}
			glRenderer.render(effects, performance.now() / 1000, currentTextLayers());
		}
	}

	function cancelRecording() {
		recordingState.cancel();
	}

	let dragging = $state(false);

	function handleDroppedFiles(files: FileList) {
		if (files[0].type.startsWith("audio/")) {
			clearTrack();
			audio.trackFile = files[0];
		} else {
			addFiles(files);
		}
	}

	let _mobileSheetRef: MobileSheet | undefined = undefined;

	/** The timeline's shared axis, once mounted: the C shortcut fires from the window. */
	let timelineAxis = $state<TimelineStackState | undefined>(undefined);

	function handleKeydown(e: KeyboardEvent) {
		const mod = e.ctrlKey || e.metaKey;
		const key = e.key.toLowerCase();

		// Undo/redo reach the app even while a dropdown holds focus; only a text field owns it.
		if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
			redoLatest(undoSources());
			return;
		}
		if (mod && key === "z") {
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
			undoLatest(undoSources());
			return;
		}
		// Leave every other modifier combo (copy, paste, save…) to the browser.
		if (mod) return;

		// The media lightbox owns the keyboard while it's up.
		if (isModalKeyboardOpen()) return;

		// Space is the transport whatever holds focus, or a focused dropdown would swallow it.
		if (e.code === "Space") {
			if (isTextEntryTarget(e.target)) return;
			e.preventDefault();
			togglePreview();
			return;
		}

		// Bare keys belong to whichever control has focus, if any.
		if (isInteractiveTarget(e.target)) return;

		if (e.code === "Escape" && previewPlaying) {
			stopPreview();
		} else if (e.key === "ArrowRight") {
			e.preventDefault();
			moshSession.forward();
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			moshSession.back();
		} else if (key === "c" && !e.altKey && !e.shiftKey) {
			e.preventDefault();
			if (timelineAxis)
				timelineAxis.followPlayhead = !timelineAxis.followPlayhead;
		} else if (e.key === "+" || e.key === "=") {
			// "=" as well as "+": on most layouts the latter needs Shift.
			e.preventDefault();
			timelineAxis?.vp.zoomStep(true);
		} else if (e.key === "-" || e.key === "_") {
			e.preventDefault();
			timelineAxis?.vp.zoomStep(false);
		}
	}
</script>

<svelte:window
	onkeydown={handleKeydown}
	onpointerdown={() => audio.audioContext?.resume()}
/>

{#if audio.trackObjectUrl}
	<audio
		bind:this={audioEl}
		src={audio.trackObjectUrl}
		onloadedmetadata={() => audio.onAudioLoadedMetadata()}
		onerror={() => showToast("Could not load this audio track", "error")}
		ontimeupdate={() => audio.onAudioTimeUpdate()}
		onended={() => audio.onAudioEnded()}
		onplay={() => {
			audio.audioPlaying = true;
			if (!previewPlaying) startPreview();
		}}
		onpause={() => {
			audio.audioPlaying = false;
			if (previewPlaying) stopPreview();
		}}
		hidden
	></audio>
{/if}

<input
	bind:this={trackInput}
	type="file"
	accept="audio/*"
	onchange={onTrackInputChange}
	hidden
/>

<div
	class="editor"
	class:drag-over={dragging}
	{@attach fileDrop({
		onDraggingChange: (d) => (dragging = d),
		onDrop: handleDroppedFiles,
	})}
>
	<TrackLibrary
		activeTrackName={audio.trackFile?.name ?? null}
		activeTrackId={currentTrackId}
		onLoadTrack={onLibraryLoadTrack}
		onUnloadTrack={clearTrack}
		onPlay={() => startPreview()}
		onPause={stopPreview}
		mainPlaying={audio.audioPlaying}
		pendingTrack={audio.trackFile}
		onNormalizeChange={(gain) => audio.setNormalizeGain(gain)}
		onAutoAdded={adoptLibraryTrack}
	/>
	<div class="main-area">
		<SlideshowTopBar
			{activeView}
			slideCount={slides.length}
			onViewChange={(view) => {
				activeView = view;
				if (view === "grid" && previewPlaying) stopPreview();
			}}
			onShuffle={shuffleSlides}
			onAdd={() => slideInput?.click()}
			onGenerate={() => (generateOpen = true)}
			onSnap={() => (webcamOpen = true)}
			onClear={() => (showClearSlidesConfirm = true)}
			onExit={onExit ? handleExit : undefined}
		/>
		<input
			bind:this={slideInput}
			type="file"
			accept="image/*,video/*"
			multiple
			hidden
			onchange={(e) => {
				const picked = Array.from(e.currentTarget.files ?? []);
				if (picked.length > 0) void addFiles(picked);
				e.currentTarget.value = "";
			}}
		/>

		{#if activeView === "grid"}
			<SlideshowGridView
				{slides}
				{config}
				{presets}
				onAddFiles={(files) => addFiles(files)}
				onGenerate={() => (generateOpen = true)}
				onSnap={() => (webcamOpen = true)}
				onRemoveSlide={removeSlide}
				onReorderSlides={reorderSlides}
				onSetPresetIndex={setPresetIndex}
				onProxyAction={(id, action) => {
					if (action === "retry") retrySlideProxy(id);
					else setSlideProxyEnabled(id, action === "enable");
				}}
			/>
		{/if}
		<div
			class="preview-area"
			class:hidden={activeView === "grid"}
			bind:this={previewArea}
		>
			<GlCanvas
				imageSrc={previewImageSrc}
				effects={previewPlaying && previewEffects.length > 0
					? previewEffects
					: effects}
				canvasWidth={resizeWidth || undefined}
				canvasHeight={resizeHeight || undefined}
				bind:canvasEl
				bind:glRenderer
				bind:naturalWidth
				bind:naturalHeight
				fps={currentFps}
				{showFps}
				freezeAnimation={!previewPlaying}
				suspended={recordingState.recording}
				externallyDriven
				{warmCanvas}
				{warmRenderer}
				{sourceFit}
			/>
		</div>

		<SlideshowActionBar
			{previewPlaying}
			slidesEmpty={slides.length === 0}
			trackFile={audio.trackFile}
			bind:resizeWidth
			bind:resizeHeight
			{naturalWidth}
			{naturalHeight}
			recording={recordingState.recording}
			{recordFps}
			recordDuration={audio.trackFile && audio.trackDuration > 0
				? audio.spanEnd - audio.spanStart
				: recordDuration}
			textEnabled={textTimeline.enabled}
			onToggleText={toggleTextTimeline}
			onTogglePreview={togglePreview}
			onStartRecording={startRecording}
			bind:showFps
			bind:sourceFit
			onRecordFpsChange={(fps) => (recordFps = fps)}
			onRecordDurationChange={(d) => (recordDuration = d)}
		/>

		<RecordOverlay
			recording={recordingState.recording}
			recordProgress={recordingState.recordProgress}
			recordFinalizing={recordingState.recordFinalizing}
			onCancel={cancelRecording}
		/>

		<TimelineStack
			bind:axis={timelineAxis}
			trackDuration={textDuration}
			currentTime={textTime}
			isPlaying={previewPlaying}
			onTogglePlay={() => (previewPlaying ? stopPreview() : startPreview())}
			onSeek={seekMaster}
			spanStart={audio.spanStart}
			loopEnabled={audio.loopAudio}
			onToggleLoop={audio.trackFile ? toggleLoop : null}
		>
			{#snippet toolbar()}
				{#if textTimeline.enabled}
					<div class="tl-tool-sep"></div>
					<span class="tl-tool-label">Text</span>
					<button
						class="tl-tool-btn"
						title="Add a text lane"
						onclick={addTextLane}
					>
						<Plus size={12} /> Lane
					</button>
					{#if lyricsSync}
						<button
							class="tl-tool-btn"
							class:active={lyricsOpen}
							title="Sync lyrics to the song: paste them, then press Space as it plays"
							onclick={() => (lyricsOpen = true)}
						>
							<MicVocal size={12} /> Lyrics
						</button>
					{/if}
				{/if}
			{/snippet}
			<!-- Read bottom to top, the way a frame is built: the track at the foot is
			     the input, the beat segments above it drive the chain. -->
			<div class="tl-layers">
				{#if textTimeline.enabled}
					<TextTimelineLane
						timeline={textTimeline}
						{layerOrder}
						{draggingLaneId}
						onLaneDragStart={startLayerDrag}
						bind:selectedClipId={selectedTextClipId}
						onChange={setTextTimeline}
						onBeforeEdit={pushTextHistory}
						{lyricsSync}
						bind:lyricsOpen
					/>
				{/if}
			</div>
			{#if audio.trackFile && audio.trackDuration > 0}
				<TimelineSegments
					{config}
					{onConfigChange}
					bind:selectedSegmentId
					bind:undoSource={segmentUndo}
					onSeek={seekMaster}
				/>
			{/if}
			{#if audio.trackFile && audio.trackDuration > 0}
				<AudioTimeline
					layout="lane"
					label="AUD"
					trackDuration={audio.trackDuration}
					trackCurrentTime={audio.trackCurrentTime}
					spanStart={audio.spanStart}
					spanEnd={audio.spanEnd}
					isPlaying={previewPlaying}
					outputVolume={audio.outputVolume}
					onPlay={() => startPreview()}
					onPause={stopPreview}
					onSeek={seekMaster}
					onSpanCommit={spanHistory.push}
					onSpanStartChange={(t) => (audio.spanStart = t)}
					onSpanEndChange={(t) => (audio.spanEnd = t)}
					onVolumeChange={(v) => audio.setOutputVolume(v)}
				/>
			{/if}
		</TimelineStack>
		{#if !audio.trackFile}
			<TrackAddBar
				onOpenPicker={openTrackPicker}
				hintText="Add music to sync transitions to the beat"
			/>
		{/if}
	</div>

	{#snippet textPanel(section: "clip" | "chain")}
		<TextClipPanel
			lane={selectedTextLane}
			clip={selectedTextClip}
			onLaneChange={updateTextLane}
			onClipChange={updateTextClip}
			onBeforeEdit={pushTextHistory}
			onClose={() => (selectedTextClipId = null)}
			hasTrack={!!audio.trackFile}
			spectrumData={audio.spectrumData}
			response={DEFAULT_AUDIO_RESPONSE}
			{section}
		/>
	{/snippet}

	<MobileSheet
		bind:this={_mobileSheetRef}
		topPanel={selectedTextClip ? textPanel : undefined}
		topPanelLabel="Text clip"
	>
		{#snippet settings()}
			<SlideshowConfigPanel
				{config}
				{bpmDetecting}
				hasTrack={!!audio.trackFile}
				onDetectBpm={runBpmDetection}
				{onConfigChange}
				trackCurrentTime={audio.trackCurrentTime}
				trackDuration={audio.trackDuration}
			/>
		{/snippet}
		{#snippet effectsPanel()}
			<EffectsPanel
				headless
				bind:effects
				hasTrack={!!audio.trackFile}
				spectrumData={audio.spectrumData}
				rolledNote={panelRolledNote}
				rolledChain={config.moshMode === "random"}
				rolledScope="moshable"
				onVolumeLinkChange={(index, paramKey, link) => {
					panelBeforeEdit(`link:${index}:${paramKey}`);
					effects = setVolumeLink(effects, index, paramKey, link);
				}}
				onBeforeUserEdit={panelBeforeEdit}
				onEffectsReplaced={endPanelBurst}
			/>
		{/snippet}
	</MobileSheet>

	{#if dragging}
		<div class="drop-overlay">
			<span>Drop to add images or replace audio</span>
		</div>
	{/if}

	{#if showClearSlidesConfirm}
		<ConfirmDialog
			title="Clear all images?"
			message="Every image and video is removed from this slideshow. The files stay where they came from."
			confirmLabel="Clear images"
			cancelLabel="Cancel"
			danger
			onConfirm={clearSlides}
			onCancel={() => (showClearSlidesConfirm = false)}
		/>
	{/if}

	{#if webcamOpen}
		{#await loadWebcamPanel() then WebcamPanel}
			<WebcamPanel
				mode="burst"
				onTransport={burstTransport}
				beatAt={burstBeat}
				onSnaps={(files) => void addFiles(files)}
				onClose={() => (webcamOpen = false)}
			/>
		{/await}
	{/if}

	{#if generateOpen}
		{#await loadGeneratePanel() then GeneratePanel}
			<GeneratePanel
				single={false}
				size={resizeWidth > 0 && resizeHeight > 0
					? { width: resizeWidth, height: resizeHeight }
					: null}
				onUse={(files) => {
					generateOpen = false;
					addFiles(files);
				}}
				onClose={() => (generateOpen = false)}
			/>
		{/await}
	{/if}
</div>

<style>
	/* The lane renders straight into this (display:contents), so gap and order live here. */
	.tl-layers {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.editor {
		display: flex;
		height: 100%;
		overflow: hidden;
	}

	.main-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}

	.preview-area {
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: stretch;
		justify-content: center;
		overflow: hidden;
		background: #0a0a0a;
	}

	.preview-area.hidden {
		display: none;
	}

	.editor {
		position: relative;
	}

	.editor.drag-over::before {
		content: "";
		position: absolute;
		inset: 0;
		z-index: 99;
		border: 2px dashed var(--text-3);
		border-radius: 8px;
		pointer-events: none;
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
		color: var(--text);
		letter-spacing: 0.04em;
	}

	@media (max-width: 800px) {
		.main-area {
			padding-bottom: 44px;
		}
	}
</style>
