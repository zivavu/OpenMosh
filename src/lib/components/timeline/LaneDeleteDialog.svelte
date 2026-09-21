<script lang="ts">
	import ConfirmDialog from "../ui/ConfirmDialog.svelte";

	/** "Delete this lane?" — asked only for lanes with clips on them. */
	interface Props {
		lane: { id: string; name: string; clips: unknown[] };
		/** "layer" or "lane", and what its clips are called. */
		laneNoun?: string;
		clipNoun?: string;
		onConfirm: (laneId: string) => void;
		onCancel: () => void;
	}

	let {
		lane,
		laneNoun = "lane",
		clipNoun = "clip",
		onConfirm,
		onCancel,
	}: Props = $props();

	let count = $derived(lane.clips.length);
</script>

<ConfirmDialog
	title="Delete “{lane.name}”?"
	message="This removes the {laneNoun} and the {count} {clipNoun}{count === 1
		? ''
		: 's'} on it."
	confirmLabel="Delete lane"
	cancelLabel="Cancel"
	danger
	onConfirm={() => onConfirm(lane.id)}
	{onCancel}
/>
