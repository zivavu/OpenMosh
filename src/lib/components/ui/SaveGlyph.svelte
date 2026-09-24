<script lang="ts">
	import { untrack } from "svelte";

	/** How long the arc takes to run round to a full ring once the save lands. */
	const CLOSE_MS = 380;

	/** Saving, a spinning arc. Saved, the arc closes into a ring, and the ring stops
	 * turning only once whole, when a stop can't be seen; then the check draws in. */
	let { saving, size = 12 }: { saving: boolean; size?: number } = $props();

	let phase = $state<"saving" | "closing" | "done">(
		untrack(() => saving) ? "saving" : "done",
	);
	/** Arrived at by a save, not mounted there: only then the pop and the flash. */
	let fresh = $state(false);

	$effect(() => {
		if (saving) {
			phase = "saving";
			fresh = false;
			return;
		}
		if (untrack(() => phase) === "done") return;
		phase = "closing";
		const timer = setTimeout(() => {
			phase = "done";
			fresh = true;
		}, CLOSE_MS);
		return () => clearTimeout(timer);
	});
</script>

<svg
	class="glyph {phase}"
	class:fresh
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2.25"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<g class="ring"><circle cx="12" cy="12" r="10" pathLength="100" /></g>
	<path class="check" d="M7.5 12.4 10.6 15.5 16.6 9" pathLength="100" />
</svg>

<style>
	.glyph {
		flex-shrink: 0;
		overflow: visible;
	}

	.ring {
		transform-box: view-box;
		transform-origin: 12px 12px;
	}

	.saving .ring,
	.closing .ring {
		animation: spin 0.8s linear infinite;
	}

	.ring circle {
		stroke-dasharray: 26 100;
		transition:
			stroke-dasharray 0.38s cubic-bezier(0.4, 0, 0.2, 1),
			opacity 0.3s ease;
	}

	.closing .ring circle,
	.done .ring circle {
		stroke-dasharray: 100 100;
	}

	/* Stepped back, so the check reads first. */
	.done .ring circle {
		opacity: 0.35;
	}

	.check {
		stroke-dasharray: 100;
		stroke-dashoffset: 100;
		opacity: 0;
	}

	.done .check {
		stroke-dashoffset: 0;
		opacity: 1;
		transition:
			stroke-dashoffset 0.34s cubic-bezier(0.65, 0, 0.35, 1) 0.04s,
			opacity 0.08s;
	}

	.done.fresh {
		animation: pop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 0.22s;
	}

	/* Lit as it lands, then back to the bar's quiet colour. */
	.done.fresh .check {
		animation: flash 1.4s ease-out forwards;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes pop {
		0% {
			transform: scale(1);
		}
		40% {
			transform: scale(1.3);
		}
		100% {
			transform: scale(1);
		}
	}

	@keyframes flash {
		0%,
		35% {
			stroke: var(--live);
		}
		100% {
			stroke: currentColor;
		}
	}
</style>
