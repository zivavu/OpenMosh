<script lang="ts">
	import { isInteractiveTarget } from "../../editor/shortcut-target";
	import {
		Camera,
		Circle,
		FlipHorizontal2,
		FlipVertical2,
		Square,
	} from "lucide-svelte";
	import { onDestroy, onMount } from "svelte";
	import PanelModal from "../ui/PanelModal.svelte";
	import {
		createLiveFile,
		listCameras,
		openCamera,
		stopStream,
		type CameraInfo,
	} from "../../webcam/camera";
	import { snapStill, startTake, type Take } from "../../webcam/take";
	import {
		isPlainShape,
		loadShape,
		saveShape,
		shapeLayout,
		shapeStream,
		type CameraShape,
		type ShapedStream,
	} from "../../webcam/shape";
	import { FULL_CROP, isFullCrop } from "../../media/source-edit";
	import {
		cropCursor as cropCursorFor,
		dragCrop,
		edgesAt,
		grabTolerance,
		insideCrop,
		startCropDrag,
		type CropDrag,
		type Point,
	} from "../../media/crop-drag";
	import ButtonGroup from "../ui/ButtonGroup.svelte";

	/** The one camera overlay, in three shapes: single mode takes the camera as its
	 * source, the editor records a take, the slideshow snaps stills on the beat. */
	interface Props {
		mode: "live" | "record" | "burst";
		/** live: the camera, wrapped as the editor's file. */
		onLive?: (file: File) => void;
		onTake?: (file: File) => void;
		onSnaps?: (files: File[]) => void;
		/** record/burst: start and stop the host's transport around the capture, so
		 * the song plays while you perform. */
		onTransport?: (playing: boolean) => void;
		/** burst: the host's clock in beats; null when it has no grid. */
		beatAt?: () => number | null;
		onClose: () => void;
	}

	let { mode, onLive, onTake, onSnaps, onTransport, beatAt, onClose }: Props =
		$props();

	const BEAT_COUNTS = ["4", "8", "16", "32"].map((v) => ({
		label: v,
		value: v,
	}));
	const EVERY = [
		{ label: "Beat", value: "1" },
		{ label: "2", value: "2" },
		{ label: "4", value: "4" },
	];
	/** Beats per snap when the host has no grid to follow. */
	const FALLBACK_BEAT_SEC = 0.5;
	const COUNTDOWN_SEC = 3;

	let videoEl = $state<HTMLVideoElement | null>(null);
	let stream = $state<MediaStream | null>(null);
	let cameras = $state<CameraInfo[]>([]);
	let deviceId = $state<string | null>(null);
	let error = $state<string | null>(null);
	let opening = $state(true);
	/** Set once the camera has been handed off, so closing keeps it running. */
	let handedOff = false;

	let beatCount = $state("8");
	let every = $state("1");

	type Phase = "idle" | "countdown" | "capturing" | "saving";
	let phase = $state<Phase>("idle");
	let countdown = $state(COUNTDOWN_SEC);
	let elapsed = $state(0);
	let snapped = $state(0);
	let take: Take | null = null;
	let rafId = 0;
	let countdownTimer: ReturnType<typeof setInterval> | undefined;

	let shape = $state<CameraShape>(loadShape());
	$effect(() => saveShape($state.snapshot(shape)));
	/** The take's own copy of the camera, shaped; released when the take ends. */
	let shaped: ShapedStream | null = null;

	let videoWidth = $state(0);
	let videoHeight = $state(0);
	let frameEl = $state<HTMLDivElement | null>(null);
	let cropDrag: CropDrag | null = null;
	let cursor = $state("");

	let busy = $derived(phase !== "idle");
	let title = $derived(
		mode === "live"
			? "Webcam"
			: mode === "record"
				? "Record a take"
				: "Snap on the beat",
	);
	let streamSize = $derived.by(() => {
		if (!videoWidth || !videoHeight) return undefined;
		const out = shapeLayout(videoWidth, videoHeight, shape);
		return `${out.width} × ${out.height}`;
	});

	async function open(id: string | null) {
		opening = true;
		error = null;
		try {
			const next = await openCamera(id);
			// Closed while the camera was starting: nothing else would turn it off.
			if (destroyed) {
				stopStream(next);
				return;
			}
			stopStream(stream);
			stream = next;
			deviceId = next.getVideoTracks()[0]?.getSettings().deviceId ?? id;
			// Labels only come back once a camera has been granted.
			cameras = await listCameras();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			opening = false;
		}
	}

	$effect(() => {
		if (videoEl) videoEl.srcObject = stream;
	});

	onMount(() => {
		void open(null);
	});

	let destroyed = false;
	onDestroy(() => {
		destroyed = true;
		stopCapture();
		if (!handedOff) stopStream(stream);
	});

	function stopCapture() {
		clearInterval(countdownTimer);
		cancelAnimationFrame(rafId);
		if (phase === "capturing") onTransport?.(false);
		take?.cancel();
		take = null;
		shaped?.release();
		shaped = null;
	}

	function goLive() {
		if (!stream) return;
		handedOff = true;
		onLive?.(createLiveFile(stream, deviceId, $state.snapshot(shape)));
	}

	/** A count-in, then the transport and the capture together. */
	function begin(capture: () => void) {
		if (!stream || busy) return;
		phase = "countdown";
		countdown = COUNTDOWN_SEC;
		countdownTimer = setInterval(() => {
			countdown--;
			if (countdown > 0) return;
			clearInterval(countdownTimer);
			phase = "capturing";
			onTransport?.(true);
			capture();
		}, 1000);
	}

	function startRecording() {
		begin(() => {
			elapsed = 0;
			const fixed = $state.snapshot(shape);
			const size =
				isPlainShape(fixed) || !videoWidth
					? undefined
					: shapeLayout(videoWidth, videoHeight, fixed);
			void shapeStream(stream!, fixed)
				.then((s) => {
					// Closed or failed while the canvas was starting.
					if (destroyed || phase !== "capturing") {
						s.release();
						return null;
					}
					shaped = s;
					return startTake(s.stream, size);
				})
				.then((t) => {
					if (!t) return;
					take = t;
					const tick = () => {
						elapsed = t.elapsed;
						rafId = requestAnimationFrame(tick);
					};
					rafId = requestAnimationFrame(tick);
				})
				.catch((e) => fail(e));
		});
	}

	async function stopRecording() {
		if (phase !== "capturing" || !take) return;
		cancelAnimationFrame(rafId);
		onTransport?.(false);
		phase = "saving";
		const t = take;
		take = null;
		try {
			const file = await t.stop();
			shaped?.release();
			shaped = null;
			onTake?.(file);
			onClose();
		} catch (e) {
			fail(e);
		}
	}

	function startBurst() {
		begin(() => {
			const fixed = $state.snapshot(shape);
			const want = Number(beatCount);
			const step = Number(every);
			const files: File[] = [];
			const startedAt = performance.now();
			let lastSlot: number | null = null;
			snapped = 0;
			let pending = 0;
			let finished = false;
			const finish = () => {
				if (finished || pending > 0) return;
				finished = true;
				onTransport?.(false);
				phase = "saving";
				onSnaps?.(files);
				onClose();
			};
			const tick = () => {
				const beat =
					beatAt?.() ??
					(performance.now() - startedAt) / 1000 / FALLBACK_BEAT_SEC;
				const slot = Math.floor(beat / step);
				if (lastSlot === null) lastSlot = slot - 1;
				if (slot > lastSlot && files.length + pending < want) {
					lastSlot = slot;
					const index = files.length + pending;
					pending++;
					void snapStill(videoEl!, fixed, `snap-${index + 1}.png`).then((f) => {
						pending--;
						if (f) files[index] = f;
						snapped = files.filter(Boolean).length;
						if (files.length + pending >= want) finish();
					});
				}
				if (files.length + pending < want) rafId = requestAnimationFrame(tick);
			};
			rafId = requestAnimationFrame(tick);
		});
	}

	function readVideoSize() {
		videoWidth = videoEl?.videoWidth ?? 0;
		videoHeight = videoEl?.videoHeight ?? 0;
	}

	function cropPoint(e: PointerEvent): Point | null {
		const rect = frameEl?.getBoundingClientRect();
		if (!rect?.width || !rect.height) return null;
		return {
			x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
			y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
		};
	}

	function cropTolerance() {
		const rect = frameEl?.getBoundingClientRect();
		return grabTolerance(shape.crop, rect?.width ?? 0, rect?.height ?? 0);
	}

	function onCropDown(e: PointerEvent) {
		if (e.button !== 0 || busy) return;
		const n = cropPoint(e);
		if (!n) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		const started = startCropDrag(shape.crop, n, cropTolerance());
		cropDrag = started.drag;
		if (started.crop) shape.crop = started.crop;
	}

	function onCropMove(e: PointerEvent) {
		const n = cropPoint(e);
		if (!n) return;
		if (cropDrag) {
			shape.crop = dragCrop(cropDrag, shape.crop, n);
			return;
		}
		const edges = edgesAt(shape.crop, n, cropTolerance());
		cursor = edges
			? cropCursorFor(edges)
			: insideCrop(shape.crop, n)
				? "move"
				: "";
	}

	function onCropUp(e: PointerEvent) {
		// A click without a drag leaves a sliver; read it as "no crop".
		const c = shape.crop;
		if (cropDrag?.kind === "new" && (c.w < 0.03 || c.h < 0.03)) {
			shape.crop = { ...FULL_CROP };
		}
		cropDrag = null;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}

	/** The crop flips with the picture, so it keeps framing the same thing. */
	function flipX() {
		const c = shape.crop;
		shape = { ...shape, flipX: !shape.flipX, crop: { ...c, x: 1 - c.x - c.w } };
	}

	function flipY() {
		const c = shape.crop;
		shape = { ...shape, flipY: !shape.flipY, crop: { ...c, y: 1 - c.y - c.h } };
	}

	function fail(e: unknown) {
		stopCapture();
		phase = "idle";
		error = e instanceof Error ? e.message : String(e);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			if (phase === "capturing" && mode === "record") void stopRecording();
			else if (!busy) onClose();
		} else if (
			e.key === " " &&
			// A button, a dropdown or a field takes its own Space.
			!(e.target instanceof HTMLButtonElement) &&
			!isInteractiveTarget(e.target)
		) {
			e.preventDefault();
			primary();
		}
	}

	function primary() {
		if (mode === "live") goLive();
		else if (mode === "record") {
			if (phase === "capturing") void stopRecording();
			else startRecording();
		} else startBurst();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<PanelModal {title} sub={streamSize} {busy} {onClose}>
	{#snippet icon()}<Camera size={12} />{/snippet}
	<div class="preview" class:capturing={phase === "capturing"}>
		<div
			class="frame"
			class:busy
			bind:this={frameEl}
			role="presentation"
			style:--ar={videoWidth && videoHeight
				? `${videoWidth} / ${videoHeight}`
				: undefined}
			style:cursor={busy ? undefined : cursor || "crosshair"}
			onpointerdown={onCropDown}
			onpointermove={onCropMove}
			onpointerup={onCropUp}
			onpointercancel={onCropUp}
		>
			<video
				bind:this={videoEl}
				style:scale="{shape.flipX ? -1 : 1}
				{shape.flipY ? -1 : 1}"
				onloadedmetadata={readVideoSize}
				onresize={readVideoSize}
				autoplay
				muted
				playsinline
			></video>
			{#if !isFullCrop(shape.crop)}
				{@const c = shape.crop}
				<div
					class="crop-shade"
					style="left:0; top:0; right:0; height:{c.y * 100}%"
				></div>
				<div
					class="crop-shade"
					style="left:0; top:{(c.y + c.h) * 100}%; right:0; bottom:0"
				></div>
				<div
					class="crop-shade"
					style="left:0; top:{c.y * 100}%; width:{c.x * 100}%; height:{c.h *
						100}%"
				></div>
				<div
					class="crop-shade"
					style="left:{(c.x + c.w) * 100}%; top:{c.y *
						100}%; right:0; height:{c.h * 100}%"
				></div>
				<div
					class="crop-box"
					style="left:{c.x * 100}%; top:{c.y * 100}%; width:{c.w *
						100}%; height:{c.h * 100}%"
				>
					<span class="crop-grip tl"></span>
					<span class="crop-grip tr"></span>
					<span class="crop-grip bl"></span>
					<span class="crop-grip br"></span>
				</div>
			{/if}
		</div>
		{#if error}
			<p class="state error">{error}</p>
		{:else if opening}
			<p class="state">Opening camera…</p>
		{/if}
		{#if phase === "countdown"}
			<span class="count">{countdown}</span>
		{:else if phase === "capturing"}
			<span class="tally">
				<span class="dot"></span>
				{#if mode === "record"}
					{elapsed.toFixed(1)}s
				{:else}
					{snapped} / {beatCount}
				{/if}
			</span>
		{:else if phase === "saving"}
			<p class="state">Saving…</p>
		{/if}
	</div>

	<div class="controls">
		<div class="ctrl">
			<span class="label">Camera</span>
			<select
				aria-label="Camera"
				value={deviceId ?? ""}
				disabled={busy || cameras.length < 2}
				onchange={(e) => void open(e.currentTarget.value || null)}
			>
				{#each cameras as c (c.deviceId)}
					<option value={c.deviceId}>{c.label}</option>
				{/each}
			</select>
		</div>
		<div class="ctrl">
			<span class="label">Flip</span>
			<div class="row">
				<button
					class="btn"
					class:on={shape.flipX}
					aria-pressed={shape.flipX}
					aria-label="Flip horizontally"
					title="Flip horizontally"
					disabled={busy}
					onclick={flipX}
				>
					<FlipHorizontal2 size={12} />
				</button>
				<button
					class="btn"
					class:on={shape.flipY}
					aria-pressed={shape.flipY}
					aria-label="Flip vertically"
					title="Flip vertically"
					disabled={busy}
					onclick={flipY}
				>
					<FlipVertical2 size={12} />
				</button>
			</div>
		</div>
		<div class="ctrl">
			<span class="label">Crop</span>
			<button
				class="btn"
				disabled={busy || isFullCrop(shape.crop)}
				onclick={() => (shape.crop = { ...FULL_CROP })}
			>
				Reset
			</button>
		</div>
		{#if mode === "burst"}
			<div class="ctrl">
				<span class="label">Snaps</span>
				<ButtonGroup
					buttons={BEAT_COUNTS}
					value={beatCount}
					onchange={(v) => (beatCount = v)}
				/>
			</div>
			<div class="ctrl">
				<span class="label">Every</span>
				<ButtonGroup
					buttons={EVERY}
					value={every}
					onchange={(v) => (every = v)}
				/>
			</div>
		{/if}
	</div>

	<p class="hint">
		{#if mode === "live"}
			The camera becomes the source: mosh it live, and export what the camera
			sees while the export runs.
		{:else if mode === "record"}
			Counts in from three, then the song plays from the playhead while you
			record. The take lands on the timeline where the playhead was.
		{:else}
			Counts in from three, then snaps a still on every beat of the song into
			the pool.
		{/if}
		Drag across the picture to crop it.
	</p>

	<div class="actions">
		<span class="spacer"></span>
		<button class="btn" onclick={onClose} disabled={busy}>Cancel</button>
		{#if mode === "live"}
			<button class="btn use" onclick={goLive} disabled={!stream || busy}>
				<Camera size={12} /> Go live
			</button>
		{:else if mode === "record"}
			{#if phase === "capturing"}
				<button class="btn rec" onclick={stopRecording}>
					<Square size={12} /> Stop
				</button>
			{:else}
				<button
					class="btn use"
					onclick={startRecording}
					disabled={!stream || busy}
				>
					<Circle size={12} /> Record
				</button>
			{/if}
		{:else}
			<button class="btn use" onclick={startBurst} disabled={!stream || busy}>
				<Camera size={12} /> Snap {beatCount}
			</button>
		{/if}
	</div>
</PanelModal>

<style>
	.preview {
		position: relative;
		aspect-ratio: 16 / 9;
		display: grid;
		place-items: center;
		background: var(--sunken);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		overflow: hidden;
	}
	.preview.capturing {
		border-color: var(--rec);
	}
	.preview {
		container-type: size;
	}
	/* The camera's own aspect, as large as the box allows, so the crop maps onto it. */
	.frame {
		--ar: 16 / 9;
		position: absolute;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		width: min(100cqw, 100cqh * (var(--ar)));
		aspect-ratio: var(--ar);
		touch-action: none;
	}
	.frame video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.crop-shade {
		position: absolute;
		background: rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}
	.crop-box {
		position: absolute;
		border: 1px dashed var(--live);
		pointer-events: none;
	}
	.frame.busy .crop-box {
		border: 1px solid rgba(255, 255, 255, 0.25);
	}
	.frame.busy .crop-grip {
		display: none;
	}
	.crop-grip {
		position: absolute;
		width: 7px;
		height: 7px;
		background: var(--live);
		border-radius: 1px;
	}
	.crop-grip.tl {
		left: -4px;
		top: -4px;
	}
	.crop-grip.tr {
		right: -4px;
		top: -4px;
	}
	.crop-grip.bl {
		left: -4px;
		bottom: -4px;
	}
	.crop-grip.br {
		right: -4px;
		bottom: -4px;
	}

	.state {
		position: relative;
		margin: 0;
		padding: 0 1rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-3);
		text-align: center;
		pointer-events: none;
	}
	.state.error {
		color: var(--rec);
	}

	.count {
		position: relative;
		pointer-events: none;
		font-family: var(--font-mono);
		font-size: 4rem;
		font-weight: 600;
		color: var(--text);
		text-shadow: 0 2px 16px rgba(0, 0, 0, 0.8);
	}

	.tally {
		position: absolute;
		top: 0.5rem;
		left: 0.6rem;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.5rem;
		border-radius: var(--r-1);
		background: rgba(0, 0, 0, 0.6);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--rec);
		box-shadow: 0 0 8px rgba(255, 95, 86, 0.9);
		animation: tally-blink 1s steps(1, end) infinite;
	}
	@keyframes tally-blink {
		0%,
		50% {
			opacity: 1;
		}
		51%,
		100% {
			opacity: 0.25;
		}
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem 1.2rem;
	}

	.ctrl {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.row {
		display: flex;
		gap: 0.3rem;
	}

	.btn.on {
		color: var(--text);
		border-color: var(--live);
	}

	select {
		max-width: 260px;
		background-color: var(--sunken);
		color: var(--text-2);
		border-radius: var(--r-2);
		padding-block: 0.3rem;
		padding-left: 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.08em;
	}

	.hint {
		margin: 0;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		line-height: 1.5;
		color: var(--text-3);
		letter-spacing: 0.06em;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.spacer {
		flex: 1;
	}

	.btn.rec {
		color: var(--text);
		background: var(--rec);
		border-color: var(--rec);
	}
	.btn.rec:hover:not(:disabled) {
		filter: brightness(1.1);
	}
</style>
