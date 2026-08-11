<script lang="ts">
	import { ChevronLeft, ChevronRight, X } from 'lucide-svelte';
	import { onDestroy } from 'svelte';

	/** Anything with a name and an object URL can be shown here: slideshow
	 * slides, sequence sources. */
	export interface LightboxItem {
		name: string;
		kind: 'image' | 'video';
		objectUrl: string;
	}

	interface Props {
		items: LightboxItem[];
		/** Index into `items`; arrows walk it, so the owner sees where we are. */
		index: number;
		/** Where the opening zoom starts from, as an offset from screen centre.
		 * Null skips the flight and the item just fades in. */
		origin?: { x: number; y: number } | null;
		onClose: () => void;
	}

	let {
		items,
		index = $bindable(),
		origin = null,
		onClose,
	}: Props = $props();

	let closing = $state(false);
	let imageEl = $state<HTMLImageElement | null>(null);

	let item = $derived(items[index]);
	let originStyle = $derived(
		`--lb-ox: ${origin?.x ?? 0}px; --lb-oy: ${origin?.y ?? 0}px`,
	);

	// The owner can drop items under us (a slide removed while open).
	$effect(() => {
		if (items.length === 0) onClose();
		else if (index >= items.length) index = items.length - 1;
	});

	let closeVersion = 0;
	let closeTimer: ReturnType<typeof setTimeout> | null = null;

	/** Fly back to where it came from, then unmount. The timer is the fallback
	 * for when no transitionend arrives (video, reduced motion, a tab that was
	 * backgrounded mid-flight). */
	function close() {
		if (closing) return;
		closing = true;
		if (closeTimer) clearTimeout(closeTimer);
		const version = ++closeVersion;
		imageEl?.addEventListener(
			'transitionend',
			() => {
				if (closeVersion === version) finish();
			},
			{ once: true },
		);
		closeTimer = setTimeout(() => {
			if (closeVersion === version) finish();
		}, 400);
	}

	function finish() {
		closing = false;
		onClose();
	}

	onDestroy(() => {
		if (closeTimer) clearTimeout(closeTimer);
	});

	function next() {
		closeVersion++;
		closing = false;
		index = (index + 1) % items.length;
	}

	function prev() {
		closeVersion++;
		closing = false;
		index = (index - 1 + items.length) % items.length;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') next();
		else if (e.key === 'ArrowLeft') prev();
		else if (e.key === 'Escape') close();
		else return;
		// Both editors bind these keys at the window (mosh history, segment
		// deletes) — while the lightbox is up it consumes them outright.
		e.preventDefault();
		e.stopPropagation();
	}
</script>

<svelte:window onkeydown={onKeydown} />

{#if item}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="lb-backdrop" class:lb-closing={closing} onclick={close}>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="lb-content" onclick={(e) => e.stopPropagation()}>
			<div class="lb-topbar">
				<span class="lb-info">
					{#if items.length > 1}{index + 1} / {items.length}&nbsp;·&nbsp;{/if}{item.name}
				</span>
				<button class="lb-close" onclick={close} title="Close (Esc)">
					<X size={14} />
				</button>
			</div>
			<div class="lb-img-wrap">
				{#if items.length > 1}
					<button
						class="lb-arrow lb-arrow-left"
						onclick={prev}
						title="Previous"
					>
						<ChevronLeft size={18} />
					</button>
				{/if}
				{#if item.kind === 'video'}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						class="lb-img"
						class:lb-closing={closing}
						src={item.objectUrl}
						style={originStyle}
						autoplay
						muted
						loop
						controls
					></video>
				{:else}
					<img
						bind:this={imageEl}
						class="lb-img"
						class:lb-closing={closing}
						src={item.objectUrl}
						alt={item.name}
						style={originStyle}
					/>
				{/if}
				{#if items.length > 1}
					<button class="lb-arrow lb-arrow-right" onclick={next} title="Next">
						<ChevronRight size={18} />
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.lb-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		opacity: 1;
		transition: opacity 200ms ease;
	}

	.lb-backdrop.lb-closing {
		opacity: 0;
		pointer-events: none;
	}

	.lb-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		max-width: 90vw;
	}

	.lb-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0 0.25rem;
	}

	.lb-info {
		font-size: 0.7rem;
		color: #888;
		letter-spacing: 0.03em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 80%;
	}

	.lb-close {
		background: none;
		border: none;
		color: #666;
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.15s;
	}

	.lb-close:hover {
		color: #ccc;
	}

	.lb-img-wrap {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.lb-img {
		display: block;
		max-width: 90vw;
		max-height: 82vh;
		object-fit: contain;
		border-radius: 4px;
		--lb-ox: 0px;
		--lb-oy: 0px;
		animation: lb-in 220ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
		transition:
			transform 220ms cubic-bezier(0.4, 0, 0.2, 1),
			opacity 180ms ease;
	}

	@keyframes lb-in {
		from {
			transform: translate(var(--lb-ox), var(--lb-oy)) scale(0.12);
			opacity: 0;
		}
		to {
			transform: translate(0, 0) scale(1);
			opacity: 1;
		}
	}

	.lb-img.lb-closing {
		transform: translate(var(--lb-ox), var(--lb-oy)) scale(0.12);
		opacity: 0;
	}

	.lb-arrow {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		background: rgba(0, 0, 0, 0.5);
		border: 1px solid #333;
		border-radius: 50%;
		color: #888;
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
		z-index: 1;
	}

	.lb-arrow:hover {
		color: #fff;
		background: rgba(0, 0, 0, 0.75);
	}

	.lb-arrow-left {
		left: -48px;
	}

	.lb-arrow-right {
		right: -48px;
	}
</style>
