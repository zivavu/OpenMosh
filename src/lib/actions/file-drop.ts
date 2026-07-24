export interface FileDropOptions {
  /** Called with the dropped files (never empty). */
  onDrop: (files: FileList) => void;
  /** Fires on enter/leave so the caller can show its own drop affordance. */
  onDraggingChange: (dragging: boolean) => void;
}

/**
 * Whole-pane file drop target. Drags that carry no files (text selections,
 * in-page element drags) are ignored, and the leave check tolerates moving
 * over child elements — a plain `dragleave` fires for those too and would
 * flicker the affordance off.
 */
export function fileDrop(node: HTMLElement, options: FileDropOptions) {
  let opts = options;

  const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

  const onDragOver = (e: DragEvent) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    opts.onDraggingChange(true);
  };

  const onDragLeave = (e: DragEvent) => {
    if (e.target === node || !node.contains(e.relatedTarget as Node)) {
      opts.onDraggingChange(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    opts.onDraggingChange(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) opts.onDrop(files);
  };

  node.addEventListener("dragover", onDragOver);
  node.addEventListener("dragenter", onDragOver);
  node.addEventListener("dragleave", onDragLeave);
  node.addEventListener("drop", onDrop);

  return {
    update(next: FileDropOptions) {
      opts = next;
    },
    destroy() {
      node.removeEventListener("dragover", onDragOver);
      node.removeEventListener("dragenter", onDragOver);
      node.removeEventListener("dragleave", onDragLeave);
      node.removeEventListener("drop", onDrop);
    },
  };
}
