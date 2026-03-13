<script lang="ts">
	interface Props {
		activeView: 'grid' | 'preview';
		slideCount: number;
		onViewChange: (view: 'grid' | 'preview') => void;
	}

	let { activeView, slideCount, onViewChange }: Props = $props();
</script>

<div class="top-bar">
	<div class="toolbar">
		<div class="view-toggle">
			<button
				class="view-btn"
				class:active={activeView === 'grid'}
				onclick={() => onViewChange('grid')}
			>
				Grid
			</button>
			<button
				class="view-btn"
				class:active={activeView === 'preview'}
				onclick={() => onViewChange('preview')}
			>
				Preview
			</button>
		</div>

		<span class="slide-count">{slideCount} images</span>
	</div>
</div>

<style>
	.top-bar {
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid #2a2a2a;
		flex-shrink: 0;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.view-toggle {
		display: flex;
		border: 1px solid #333;
		border-radius: 6px;
		overflow: hidden;
	}

	.view-btn {
		padding: 0.3rem 0.8rem;
		border: none;
		background: transparent;
		color: #666;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
	}

	.view-btn.active {
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
	}

	.slide-count {
		font-size: 0.75rem;
		color: #666;
	}
</style>
