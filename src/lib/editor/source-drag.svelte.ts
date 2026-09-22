/** The source a drag is carrying, while it is in the air. A dragover sees the
 * payload's type but not its value, so previews read the id from here. */
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
