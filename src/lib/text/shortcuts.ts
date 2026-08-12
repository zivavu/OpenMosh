/** The text timeline's mouse and key vocabulary, for the shortcuts modal of
 * whichever mode is showing it (editor, sequence, slideshow). */
export const TEXT_TIMELINE_SHORTCUTS = {
  title: "Text timeline",
  shortcuts: [
    {
      keys: ["Dbl-click", "Ctrl/Cmd+Click"],
      description: "Add a text clip to a lane",
    },
    { keys: ["Drag"], description: "Move the clip (or the whole selection)" },
    { keys: ["Drag edge"], description: "Trim one clip" },
    { keys: ["Drag boundary"], description: "Trim both touching clips" },
    { keys: ["Shift+Click"], description: "Select a range of clips" },
    {
      keys: ["Ctrl/Cmd+Click clip"],
      description: "Add / remove one clip from the selection",
    },
    { keys: ["Delete", "Backspace"], description: "Delete selected clips" },
    { keys: ["Esc"], description: "Deselect" },
    { keys: ["Scroll", "Shift+Scroll"], description: "Zoom / pan timeline" },
  ],
};
