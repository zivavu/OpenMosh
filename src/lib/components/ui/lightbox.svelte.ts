/**
 * Open/closed state of a MediaLightbox plus the gesture that opens it: the
 * preview zooms from the clicked card, so opening records its viewport offset.
 */
export function createLightbox() {
	let index = $state<number | null>(null);
	let origin = $state({ x: 0, y: 0 });

	return {
		get index() {
			return index;
		},
		set index(v: number | null) {
			index = v;
		},
		get origin() {
			return origin;
		},
		open(e: Event, i: number) {
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			origin = {
				x: rect.left + rect.width / 2 - window.innerWidth / 2,
				y: rect.top + rect.height / 2 - window.innerHeight / 2,
			};
			index = i;
		},
		close() {
			index = null;
		},
	};
}
