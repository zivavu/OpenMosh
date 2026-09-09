<script lang="ts">
	import { Youtube } from "lucide-svelte";
</script>

<a
	class="youtube-link"
	href="https://www.youtube.com/@zivavu144"
	target="_blank"
	rel="noopener noreferrer"
	title="See what's been made with OpenMosh"
	aria-label="See what's been made with OpenMosh"
>
	<Youtube size={14} />
</a>

<style>
	.youtube-link {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: rgba(18, 18, 18, 0.85);
		border: 1.5px solid var(--line-strong);
		color: var(--text-3);
		flex-shrink: 0;
		box-sizing: border-box;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.youtube-link:hover {
		border-color: var(--text-3);
		color: var(--text);
	}
</style>
