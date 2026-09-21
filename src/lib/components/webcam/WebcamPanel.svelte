<script lang="ts">
	import { Camera, Circle, Square } from "lucide-svelte";
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
	import ButtonGroup from "../ui/ButtonGroup.svelte";

	/**
	 * The one camera overlay, in three shapes: single mode takes the camera
	 * itself as its source, the editor records a take to land on a lane, the
	 * slideshow snaps stills on the beat.
	 */
	interface Props {
		mode: "live" | "record" | "burst";
		/** live: the camera, wrapped as the editor's file. */
		onLive?: (file: File) => void;
		/** record: the finished take. */
		onTake?: (file: File) => void;
		/** burst: the stills, in order. */
		onSnaps?: (files: File[]) => void;
		/** record/burst: start and stop the host's transport around the capture,
		 * so the song plays while you perform. */
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

	let busy = $derived(phase !== "idle");
	let title = $derived(
		mode === "live"
			? "Webcam"
			: mode === "record"
				? "Record a take"
				: "Snap on the beat",
	);
	/** The camera's own frame size, once it is open. */
	let streamSize = $derived.by(() => {
		const s = stream?.getVideoTracks()[0]?.getSettings();
		return s ? `${s.width ?? "?"} × ${s.height ?? "?"}` : undefined;
	});

	async function open(id: string | null) {
		opening = true;
		error = null;
		try {
			const next = await openCamera(id);
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

	onDestroy(() => {
		stopCapture();
		if (!handedOff) stopStream(stream);
	});

	function stopCapture() {
		clearInterval(countdownTimer);
		cancelAnimationFrame(rafId);
		if (phase === "capturing") onTransport?.(false);
		take?.cancel();
		take = null;
	}

	function goLive() {
		if (!stream) return;
		handedOff = true;
		onLive?.(createLiveFile(stream, deviceId));
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
			void startTake(stream!)
				.then((t) => {
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
			onTake?.(file);
			onClose();
		} catch (e) {
			fail(e);
		}
	}

	function startBurst() {
		begin(() => {
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
					void snapStill(videoEl!, `snap-${index + 1}.png`).then((f) => {
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
		} else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
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
		<video bind:this={videoEl} autoplay muted playsinline></video>
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
				value={deviceId ?? ""}
				disabled={busy || cameras.length < 2}
				onchange={(e) => void open(e.currentTarget.value || null)}
			>
				{#each cameras as c (c.deviceId)}
					<option value={c.deviceId}>{c.label}</option>
				{/each}
			</select>
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
	.preview video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
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
	}
	.state.error {
		color: var(--rec);
	}

	.count {
		position: relative;
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

	select {
		max-width: 260px;
		background: var(--sunken);
		color: var(--text-2);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		padding: 0.3rem 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		cursor: pointer;
		outline: none;
	}
	select:disabled {
		cursor: default;
		opacity: 0.7;
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
