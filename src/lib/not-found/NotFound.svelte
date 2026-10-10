<script lang="ts">
	import { glitchText, type Glitch } from "./glitch";

	let canvas: HTMLCanvasElement;
	let glitch: Glitch | undefined;

	const path = (() => {
		try {
			return decodeURI(location.pathname);
		} catch {
			return location.pathname;
		}
	})();

	$effect(() => {
		glitch = glitchText(canvas, "404");
		return () => glitch?.destroy();
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "ArrowRight") glitch?.mosh();
	}

	function onPointerMove(e: PointerEvent) {
		glitch?.disturb(Math.hypot(e.movementX, e.movementY) / 400);
	}
</script>

<svelte:window onkeydown={onKeydown} onpointermove={onPointerMove} />

<main>
	<canvas bind:this={canvas} aria-hidden="true"></canvas>
	<h1>There's no page at <code>{path}</code></h1>
	<p>The link may be old or have a typo. Your projects are safe in the app.</p>
	<div class="actions">
		<button class="bar-key mosh" onclick={() => glitch?.mosh()}>Mosh it</button>
		<a class="bar-key" href="/">Go to OpenMosh</a>
	</div>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100svh;
		padding: 2rem 1.5rem 3rem;
		text-align: center;
	}

	canvas {
		display: block;
		width: min(92vw, 620px);
		aspect-ratio: 2 / 1;
	}

	h1 {
		margin-top: 0.75rem;
		font-size: clamp(1.1rem, 2.6vw, 1.4rem);
		font-weight: 650;
		letter-spacing: -0.01em;
		line-height: 1.35;
	}

	code {
		padding: 0.05em 0.4em;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		background: var(--raised);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.82em;
		font-weight: 500;
		overflow-wrap: anywhere;
	}

	p {
		max-width: 42ch;
		margin-top: 0.6rem;
		color: var(--text-2);
		font-size: 0.95rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.6rem;
		margin-top: 1.75rem;
	}

	.bar-key {
		height: 38px;
		padding: 0 1.4rem;
		text-decoration: none;
	}
</style>
