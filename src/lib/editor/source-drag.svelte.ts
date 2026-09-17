/**
 * The source a drag is carrying, while it is in the air.
 *
 * A dragover can see the payload's *type* but not its value — the browser only
 * hands the data over on drop — so anything that has to draw a preview before
 * then reads the id from here instead.
 */
let draggingId = $state<string | null>(null);

export function beginSourceDrag(sourceId: string) {
	draggingId = sourceId;
}

export function endSourceDrag() {
	draggingId = null;
}

export function draggedSourceId(): string | null {
	return draggingId;
}
