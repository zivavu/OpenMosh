<script lang="ts">
	import { Instagram } from "lucide-svelte";
</script>

<a
	class="instagram-link"
	href="https://www.instagram.com/zivavu144/"
	target="_blank"
	rel="noopener noreferrer"
	title="Moshes on Instagram"
	aria-label="Moshes on Instagram"
>
	<Instagram size={14} />
</a>

<style>
	.instagram-link {
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

	.instagram-link:hover {
		border-color: var(--text-3);
		color: var(--text);
	}
</style>
