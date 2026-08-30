import { createSnapshotHistory } from "../timeline/snapshot-history.svelte";
import type { MediaTimeline } from "./types";

/** Undo stack for the media timeline. See createSnapshotHistory. */
export function createMediaHistory() {
  return createSnapshotHistory<MediaTimeline>();
}
