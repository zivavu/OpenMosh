<script lang="ts">
	import { modalDialog } from "../../actions/modal-dialog";
	import type { ModelProblem } from "../../mesh/support";

	interface Props {
		problems: ModelProblem[];
		onClose: () => void;
	}

	let { problems, onClose }: Props = $props();

	let closeBtnEl = $state<HTMLButtonElement | undefined>(undefined);

	$effect(() => {
		closeBtnEl?.focus();
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="overlay" onclick={onClose}>
	<div
		class="dialog"
		{@attach modalDialog()}
		role="alertdialog"
		aria-modal="true"
		aria-label="Model not supported"
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
	>
		<span class="title">
			{problems.length === 1 ? "Model not supported" : "Models not supported"}
		</span>
		<ul class="problems">
			{#each problems as problem, i (i)}
				<li>
					<div class="file">
						<span class="name" title={problem.name}>{problem.name}</span>
						<span class="format">{problem.format}</span>
					</div>
					<p>{problem.reason}</p>
					<p class="fix">{problem.fix}</p>
				</li>
			{/each}
		</ul>
		<div class="supported">
			<span class="label">OpenMosh reads</span>
			<ul>
				<li><b>GLB</b> (glTF 2.0)</li>
				<li><b>FBX</b> 7 or newer, binary</li>
				<li><b>OBJ</b> and <b>STL</b></li>
				<li><b>PLY</b>, meshes and point clouds</li>
			</ul>
			<p>Textures have to be inside the GLB or FBX file.</p>
		</div>
		<div class="actions">
			<button bind:this={closeBtnEl} class="btn" onclick={onClose}>OK</button>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.dialog {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		width: 400px;
		max-width: calc(100vw - 2rem);
		max-height: calc(100vh - 2rem);
		overflow-y: auto;
		padding: 1.25rem;
		background: var(--surface);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
	}

	.title,
	.label {
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--text);
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.label {
		font-size: 0.6rem;
		color: var(--text-3);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	p {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-2);
	}

	.problems {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.problems li {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.file {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		min-width: 0;
	}

	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		color: var(--text);
	}

	.format {
		flex-shrink: 0;
		padding: 0.05rem 0.35rem;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		color: var(--text-2);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
	}

	.fix {
		color: var(--text-3);
	}

	.supported {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--line);
	}

	.supported ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem 0.9rem;
		font-size: 0.75rem;
		color: var(--text-2);
	}

	.supported b {
		font-weight: 600;
		color: var(--text);
	}

	.supported p {
		color: var(--text-3);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
	}

	.btn {
		padding: 0.35rem 0.8rem;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		border-radius: var(--r-2);
		border: 1px solid var(--line-strong);
		background: rgba(255, 255, 255, 0.07);
		color: var(--text);
		cursor: pointer;
		transition: background var(--t-fast);
	}

	.btn:hover {
		background: rgba(255, 255, 255, 0.12);
	}

	.btn:focus-visible {
		outline: 1px solid var(--text-4);
		outline-offset: 2px;
	}
</style>
