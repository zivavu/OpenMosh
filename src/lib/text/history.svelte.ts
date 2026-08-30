import { createSnapshotHistory } from "../timeline/snapshot-history.svelte";
import type { TextTimeline } from "./types";

/** Undo stack for the text timeline. See createSnapshotHistory. */
export function createTextHistory() {
  return createSnapshotHistory<TextTimeline>();
}
