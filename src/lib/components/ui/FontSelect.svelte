<script lang="ts">
	import { Plus } from "lucide-svelte";
	import {
		customFonts,
		ensureFontLoaded,
		FONT_OPTIONS,
	} from "../../text-overlay";
	import AddFontDialog from "./AddFontDialog.svelte";

	interface Props {
		id?: string;
		/** CSS font-family value of the selected face. */
		value: string;
		onChange: (family: string) => void;
		/** Hosts with an add-font button of their own leave this one out. */
		showAdd?: boolean;
	}

	let { id, value, onChange, showAdd = true }: Props = $props();

	let open = $state(false);

	const custom = $derived(customFonts());

	function select(family: string) {
		void ensureFontLoaded(family);
		onChange(family);
	}
</script>

<div class="font-select">
	<select
		{id}
		{value}
		onchange={(e) => select((e.currentTarget as HTMLSelectElement).value)}
	>
		<optgroup label="Built-in">
			{#each FONT_OPTIONS as font (font.id)}
				<option value={font.family}>{font.label}</option>
			{/each}
		</optgroup>
		{#if custom.length > 0}
			<optgroup label="Yours">
				{#each custom as font (font.id)}
					<option value={font.family}>{font.name}</option>
				{/each}
			</optgroup>
		{/if}
	</select>
	{#if showAdd}
		<button
			type="button"
			class="add-btn"
			title="Add a font from a link or a file"
			aria-label="Add a font"
			onclick={(e) => {
				// The host row treats a double-click as "reset this style"; opening the picker
				// must not count towards one.
				e.stopPropagation();
				open = true;
			}}
		>
			<Plus size={12} />
		</button>
	{/if}
</div>

{#if open}
	<AddFontDialog
		onClose={() => (open = false)}
		onAdded={select}
		onRemoved={(family) => {
			// The removed face would otherwise stay selected and draw as a fallback.
			if (value === family) select(FONT_OPTIONS[0].family);
		}}
	/>
{/if}

<style>
	.font-select {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}

	/* Matches the effect panel's selects; hosts with a different look override
	   these through :global, since scoping stops at the component boundary. */
	.font-select select {
		flex: 1;
		/* Font names are long; without this the select refuses to shrink below its
		   widest option and pushes the row wider than the panel. */
		min-width: 0;
		padding: 0.25rem 0.45rem;
		background: var(--sunken);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.66rem;
		cursor: pointer;
		outline: none;
	}

	.font-select select:focus {
		border-color: var(--line-strong);
	}

	.add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 20px;
		height: 20px;
		padding: 0;
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		color: var(--text-3);
		cursor: pointer;
	}

	.add-btn:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}
</style>
