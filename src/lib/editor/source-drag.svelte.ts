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

/** dataTransfer type marking a drag that carries a library track id. */
export const TRACK_DND_TYPE = "application/x-openmosh-track";

/** The library track a drag is carrying, read the same way as the source above. */
let draggingTrackId = $state<string | null>(null);

export function beginTrackDrag(trackId: string) {
	draggingTrackId = trackId;
}

export function endTrackDrag() {
	draggingTrackId = null;
}

export function draggedTrackId(): string | null {
	return draggingTrackId;
}
