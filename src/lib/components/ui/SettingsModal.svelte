<script lang="ts">
	import { uiPrefs } from "../../ui-prefs.svelte";
	import Checkbox from "./Checkbox.svelte";
	import PanelModal from "./PanelModal.svelte";
	import { closeSettings } from "./settings-modal.svelte";
</script>

<PanelModal title="Settings" width="360px" onClose={closeSettings}>
	<label class="setting">
		<Checkbox
			checked={uiPrefs.numberInputs}
			onchange={(e) => (uiPrefs.numberInputs = e.currentTarget.checked)}
		/>
		<span class="text">
			<span class="name">Number inputs</span>
			<span class="hint">Type exact values instead of dragging sliders.</span>
		</span>
	</label>
	<label class="setting">
		<Checkbox
			checked={uiPrefs.highContrast}
			onchange={(e) => (uiPrefs.highContrast = e.currentTarget.checked)}
		/>
		<span class="text">
			<span class="name">High contrast</span>
			<span class="hint"
				>Brighter text, lines and controls on a darker background.</span
			>
		</span>
	</label>
	<label class="setting">
		<Checkbox
			checked={uiPrefs.previewProxies}
			onchange={(e) => (uiPrefs.previewProxies = e.currentTarget.checked)}
		/>
		<span class="text">
			<span class="name">Optimize large videos</span>
			<span class="hint"
				>Videos over 1080p preview from a smaller copy made in the background.
				Export always uses the original. Clicking a video's badge overrides this
				for that one file.</span
			>
		</span>
	</label>
</PanelModal>

<style>
	.setting {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		cursor: pointer;
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}

	.name {
		font-size: 0.8rem;
		color: var(--text);
	}

	.hint {
		font-size: 0.7rem;
		color: var(--text-2);
	}
</style>
