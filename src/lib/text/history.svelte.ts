import { createSnapshotHistory } from "../timeline/snapshot-history.svelte";
import { EMPTY_TEXT_TIMELINE, type TextTimeline } from "./types";

/** Undo stack for the text timeline. See createSnapshotHistory. */
export function createTextHistory() {
  return createSnapshotHistory<TextTimeline>({ ...EMPTY_TEXT_TIMELINE });
}
