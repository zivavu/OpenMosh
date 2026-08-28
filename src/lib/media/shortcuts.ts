/** The media layer lanes' mouse and key vocabulary, for the shortcuts modal. */
export const MEDIA_LAYER_SHORTCUTS = {
  title: "Media layers",
  shortcuts: [
    {
      keys: ["Dbl-click", "Ctrl/Cmd+Click"],
      description: "Add a layer clip to a lane",
    },
    { keys: ["Dbl-click clip"], description: "Edit the layer's placement" },
    { keys: ["Drag"], description: "Move the clip (or the whole selection)" },
    { keys: ["Drag edge"], description: "Trim one clip" },
    { keys: ["Drag boundary"], description: "Trim both touching clips" },
    { keys: ["S"], description: "Split the clip under the playhead" },
    { keys: ["Ctrl/Cmd+C"], description: "Copy selected clips" },
    {
      keys: ["Ctrl/Cmd+V"],
      description: "Paste them at the playhead, on their own lanes",
    },
    { keys: ["Delete", "Backspace"], description: "Delete selected clips" },
    { keys: ["Esc"], description: "Deselect" },
  ],
};
