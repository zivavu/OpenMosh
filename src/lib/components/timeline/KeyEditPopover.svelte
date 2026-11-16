<script lang="ts">
	import { untrack } from "svelte";
	import ContextMenu from "../ui/ContextMenu.svelte";

	/** A key's time and value, typed. Enter or a click away keeps them; Esc drops them. */
	interface Props {
		x: number;
		y: number;
		label: string;
		/** Timeline seconds. */
		time: number;
		value: number;
		onCommit: (time: number, value: number) => void;
		onClose: () => void;
	}

	let { x, y, label, time, value, onCommit, onClose }: Props = $props();

	const round = (n: number) => Math.round(n * 1000) / 1000;
	// Drafts start from the key as it was when the popover opened.
	let timeDraft = $state<number | null>(untrack(() => round(time)));
	let valueDraft = $state<number | null>(untrack(() => round(value)));
	let done = false;

	function commit() {
		if (done) return;
		done = true;
		const t = timeDraft ?? NaN;
		const v = valueDraft ?? NaN;
		onCommit(Number.isFinite(t) ? t : time, Number.isFinite(v) ? v : value);
		onClose();
	}

	function cancel() {
		done = true;
		onClose();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === "Enter") {
			e.preventDefault();
			commit();
		} else if (e.key === "Escape") {
			// Kept from the menu's own Esc, which would close it as a click away does.
			e.stopPropagation();
			cancel();
		}
	}

	function focusFirst(node: HTMLInputElement) {
		node.focus();
		node.select();
	}
</script>

<ContextMenu {x} {y} onClose={commit} role="dialog" {label}>
	<div class="key-edit">
		<span class="title">{label}</span>
		<label>
			<span>Time</span>
			<input
				type="number"
				step="any"
				bind:value={timeDraft}
				{onkeydown}
				aria-label="Time in seconds"
			/>
			<span class="unit">s</span>
		</label>
		<label>
			<span>Value</span>
			<input
				type="number"
				step="any"
				bind:value={valueDraft}
				{onkeydown}
				use:focusFirst
			/>
		</label>
	</div>
</ContextMenu>

<style>
	.key-edit {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.25rem 0.35rem;
	}

	.title {
		font-size: 0.68rem;
		color: var(--text-3);
		white-space: nowrap;
	}

	label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.7rem;
		color: var(--text-2);
	}

	label > span:first-child {
		width: 2.6rem;
	}

	input {
		width: 6rem;
		padding: 0.15rem 0.3rem;
		font-family: var(--font-mono);
		font-size: 0.7rem;
		color: var(--text);
		background: var(--sunken);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
	}

	.unit {
		color: var(--text-3);
	}
</style>
