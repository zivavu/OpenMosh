<script lang="ts">
	import { onMount } from "svelte";
	import { showToast } from "./toast.svelte";

	/** Stands in for a lazy panel whose chunk didn't download: says so, then closes the
	 * panel, so the next click asks for the chunk again. */
	let { onclose }: { onclose: () => void } = $props();

	onMount(() => {
		showToast(
			"Couldn't load that part of the app. Check your connection and try again.",
			"error",
		);
		onclose();
	});
</script>
