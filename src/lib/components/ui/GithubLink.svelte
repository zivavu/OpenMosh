<script lang="ts">
	import { Github } from 'lucide-svelte';
</script>

<a
	class="github-link"
	href="https://github.com/zivavu/OpenMosh"
	target="_blank"
	rel="noopener noreferrer"
	title="View on GitHub"
	aria-label="View on GitHub"
>
	<Github size={14} />
</a>

<style>
	.github-link {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: rgba(18, 18, 18, 0.85);
		border: 1.5px solid #444;
		color: #888;
		flex-shrink: 0;
		box-sizing: border-box;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.github-link:hover {
		border-color: #777;
		color: #ccc;
	}
</style>
