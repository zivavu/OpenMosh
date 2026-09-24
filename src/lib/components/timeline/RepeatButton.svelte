<script lang="ts">
	import { Repeat1 } from "lucide-svelte";
	import { getTimelineStack } from "../../editor/timeline-stack.svelte";

	/** Loops playback over the selected clips; R does the same. */
	let { clipIds }: { clipIds: string[] } = $props();

	const stack = getTimelineStack();
	let repeating = $derived(stack.isRepeating(clipIds));
</script>

{#if stack.toggleRepeat}
	<div class="tl-tool-sep"></div>
	<button
		class="tl-tool-btn"
		class:active={repeating}
		aria-pressed={repeating}
		title={repeating
			? "Repeating in the preview (R). Click to play on normally."
			: "Play this stretch over and over in the preview (R). The export isn't affected."}
		onclick={() => stack.toggleRepeat?.(clipIds)}
	>
		<Repeat1 size={12} /> Repeat
	</button>
{/if}
