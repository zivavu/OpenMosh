/** A selectable font for the text overlay. Fonts with a url are bundled woff2 files. */
export interface FontOption {
  id: string;
  label: string;
  /** CSS font-family value used when drawing to canvas. */
  family: string;
  /** Bundled font file; absent for system fonts. */
  url?: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { id: "georgia", label: "Georgia (serif)", family: "Georgia, serif" },
  {
    id: "rubik-glitch",
    label: "Rubik Glitch",
    family: "'Rubik Glitch'",
    url: "/fonts/rubik-glitch.woff2",
  },
  {
    id: "vt323",
    label: "VT323 (terminal)",
    family: "'VT323'",
    url: "/fonts/vt323.woff2",
  },
  {
    id: "press-start-2p",
    label: "Press Start 2P (arcade)",
    family: "'Press Start 2P'",
    url: "/fonts/press-start-2p.woff2",
  },
  {
    id: "orbitron",
    label: "Orbitron (sci-fi)",
    family: "'Orbitron'",
    url: "/fonts/orbitron.woff2",
  },
  {
    id: "major-mono-display",
    label: "Major Mono Display",
    family: "'Major Mono Display'",
    url: "/fonts/major-mono-display.woff2",
  },
  {
    id: "monoton",
    label: "Monoton (neon)",
    family: "'Monoton'",
    url: "/fonts/monoton.woff2",
  },
  {
    id: "bungee",
    label: "Bungee",
    family: "'Bungee'",
    url: "/fonts/bungee.woff2",
  },
  {
    id: "bungee-shade",
    label: "Bungee Shade (3D)",
    family: "'Bungee Shade'",
    url: "/fonts/bungee-shade.woff2",
  },
  {
    id: "faster-one",
    label: "Faster One (speed)",
    family: "'Faster One'",
    url: "/fonts/faster-one.woff2",
  },
  {
    id: "wallpoet",
    label: "Wallpoet (stencil)",
    family: "'Wallpoet'",
    url: "/fonts/wallpoet.woff2",
  },
  {
    id: "special-elite",
    label: "Special Elite (typewriter)",
    family: "'Special Elite'",
    url: "/fonts/special-elite.woff2",
  },
  {
    id: "rye",
    label: "Rye (western)",
    family: "'Rye'",
    url: "/fonts/rye.woff2",
  },
  {
    id: "creepster",
    label: "Creepster (horror)",
    family: "'Creepster'",
    url: "/fonts/creepster.woff2",
  },
  {
    id: "nosifer",
    label: "Nosifer (dripping)",
    family: "'Nosifer'",
    url: "/fonts/nosifer.woff2",
  },
  {
    id: "eater",
    label: "Eater (decay)",
    family: "'Eater'",
    url: "/fonts/eater.woff2",
  },
  {
    id: "metal-mania",
    label: "Metal Mania",
    family: "'Metal Mania'",
    url: "/fonts/metal-mania.woff2",
  },
  {
    id: "unifrakturmaguntia",
    label: "UnifrakturMaguntia (gothic)",
    family: "'UnifrakturMaguntia'",
    url: "/fonts/unifrakturmaguntia.woff2",
  },
  {
    id: "pirata-one",
    label: "Pirata One (blackletter)",
    family: "'Pirata One'",
    url: "/fonts/pirata-one.woff2",
  },
];

const loaded = new Map<string, Promise<void>>();

/**
 * Ensure the font for the given CSS family value is registered and loaded
 * into document.fonts so 2D-canvas drawing (preview and export) uses it.
 * System fonts and unknown families resolve immediately.
 */
export function ensureFontLoaded(family: string): Promise<void> {
  const option = FONT_OPTIONS.find((f) => f.family === family);
  if (!option?.url) return Promise.resolve();

  let promise = loaded.get(option.id);
  if (!promise) {
    const face = new FontFace(
      option.family.replace(/'/g, ""),
      `url(${option.url})`,
    );
    promise = face
      .load()
      .then((f) => {
        document.fonts.add(f);
      })
      .catch(() => {
        loaded.delete(option.id);
      });
    loaded.set(option.id, promise);
  }
  return promise;
}
