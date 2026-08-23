<script lang="ts">
	import { Plus, Trash2, X } from 'lucide-svelte';
	import {
		addCustomFont,
		customFonts,
		ensureFontLoaded,
		FONT_OPTIONS,
		removeCustomFont,
	} from '../../text-overlay';

	interface Props {
		id?: string;
		/** CSS font-family value of the selected face. */
		value: string;
		onChange: (family: string) => void;
	}

	let { id, value, onChange }: Props = $props();

	let open = $state(false);
	let link = $state('');
	let busy = $state(false);
	let error: string | null = $state(null);

	const custom = $derived(customFonts());

	function select(family: string) {
		void ensureFontLoaded(family);
		onChange(family);
	}

	async function add() {
		if (busy || !link.trim()) return;
		busy = true;
		error = null;
		try {
			const font = await addCustomFont(link);
			link = '';
			select(font.family);
		} catch (e) {
			error = e instanceof Error ? e.message : "Couldn't add that font.";
		} finally {
			busy = false;
		}
	}

	async function remove(fontId: string, family: string) {
		await removeCustomFont(fontId);
		// The removed face would otherwise stay selected and draw as a fallback.
		if (value === family) select(FONT_OPTIONS[0].family);
	}

	/** The editors bind their shortcuts on window, so keys pressed in here must stop first. */
	function onKeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') open = false;
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
	<button
		type="button"
		class="add-btn"
		title="Add a font from a Google Fonts link"
		aria-label="Add a font"
		onclick={(e) => {
			// The host row treats a double-click as "reset this style"; opening the
			// picker must not count towards one.
			e.stopPropagation();
			open = true;
		}}
	>
		<Plus size={12} />
	</button>
</div>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="font-overlay" onclick={() => (open = false)} onkeydown={onKeydown}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="font-modal" onclick={(e) => e.stopPropagation()}>
			<div class="header">
				<span class="title">Add a font</span>
				<button class="close-btn" onclick={() => (open = false)} title="Close">
					<X size={14} />
				</button>
			</div>

			<p class="hint">
				Paste a <a
					href="https://fonts.google.com"
					target="_blank"
					rel="noreferrer">Google Fonts</a
				> link — the specimen page URL works. A direct .woff2, .ttf or .otf URL works
				too. The file is saved in this browser, so it stays available offline.
			</p>

			<div class="add-row">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="link-input"
					type="url"
					autofocus
					placeholder="https://fonts.google.com/specimen/Rubik+Glitch"
					bind:value={link}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							void add();
						}
					}}
				/>
				<button
					class="primary-btn"
					disabled={busy || !link.trim()}
					onclick={() => void add()}
				>
					{busy ? 'Adding…' : 'Add'}
				</button>
			</div>

			{#if error}
				<p class="error">{error}</p>
			{/if}

			{#if custom.length > 0}
				<ul class="font-list">
					{#each custom as font (font.id)}
						<li>
							<span class="sample" style="font-family: {font.family}"
								>{font.name}</span
							>
							<button
								class="del-btn"
								title="Remove font"
								aria-label="Remove {font.name}"
								onclick={() => void remove(font.id, font.family)}
							>
								<Trash2 size={12} />
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
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
		/* Font names are long; without this the select refuses to shrink below
		   its widest option and pushes the row wider than the panel. */
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

	.font-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.font-modal {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 440px;
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		padding: 1.25rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.title {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		background: none;
		border: none;
		border-radius: 4px;
		color: var(--text-3);
		cursor: pointer;
	}

	.close-btn:hover {
		color: var(--text);
	}

	.hint {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-3);
	}

	.hint a {
		color: var(--text-2);
	}

	.add-row {
		display: flex;
		gap: 0.5rem;
	}

	.link-input {
		flex: 1;
		min-width: 0;
		padding: 0.5rem;
		background: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		color: var(--text);
		font-family: inherit;
		font-size: 0.78rem;
	}

	.link-input:focus {
		border-color: var(--live-dim);
		outline: none;
	}

	.primary-btn {
		flex: none;
		padding: 0 0.9rem;
		background: var(--ink);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
	}

	.primary-btn:hover:not(:disabled) {
		border-color: var(--live-dim);
		color: var(--live);
	}

	.primary-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.error {
		margin: 0;
		font-size: 0.75rem;
		color: var(--rec);
	}

	.font-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--line);
		padding-top: 0.5rem;
	}

	.font-list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.3rem 0.1rem;
	}

	.sample {
		overflow: hidden;
		font-size: 1rem;
		color: var(--text);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.del-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: none;
		padding: 3px;
		background: none;
		border: none;
		border-radius: 4px;
		color: var(--text-3);
		cursor: pointer;
	}

	.del-btn:hover {
		color: var(--rec);
	}
</style>
