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
      id: "special-elite",
      label: "Special Elite (typewriter)",
      family: "'Special Elite'",
      url: "/fonts/special-elite.woff2",
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
      id: "pirata-one",
      label: "Pirata One (blackletter)",
      family: "'Pirata One'",
      url: "/fonts/pirata-one.woff2",
   },
   {
      id: "abril-fatface",
      label: "Abril Fatface (elegant)",
      family: "'Abril Fatface'",
      url: "/fonts/abril-fatface.woff2",
   },
   {
      id: "agu-display",
      label: "Agu Display",
      family: "'Agu Display'",
      url: "/fonts/agu-display.woff2",
   },
   {
      id: "atomic-age",
      label: "Atomic Age (retro sci-fi)",
      family: "'Atomic Age'",
      url: "/fonts/atomic-age.woff2",
   },
   {
      id: "bakbak-one",
      label: "Bakbak One (rounded)",
      family: "'Bakbak One'",
      url: "/fonts/bakbak-one.woff2",
   },
   {
      id: "calistoga",
      label: "Calistoga (western slab)",
      family: "'Calistoga'",
      url: "/fonts/calistoga.woff2",
   },
   {
      id: "changa",
      label: "Changa (rounded tech)",
      family: "'Changa'",
      url: "/fonts/changa.woff2",
   },
   {
      id: "coiny",
      label: "Coiny (playful)",
      family: "'Coiny'",
      url: "/fonts/coiny.woff2",
   },
   {
      id: "limelight",
      label: "Limelight (art deco)",
      family: "'Limelight'",
      url: "/fonts/limelight.woff2",
   },
   {
      id: "balsamiq-sans",
      label: "Balsamiq Sans (hand-drawn)",
      family: "'Balsamiq Sans'",
      url: "/fonts/balsamiq-sans.woff2",
   },
   {
      id: "chonburi",
      label: "Chonburi (bold slab)",
      family: "'Chonburi'",
      url: "/fonts/chonburi.woff2",
   },
   {
      id: "croissant-one",
      label: "Croissant One (elegant)",
      family: "'Croissant One'",
      url: "/fonts/croissant-one.woff2",
   },
   {
      id: "girassol",
      label: "Girassol (western)",
      family: "'Girassol'",
      url: "/fonts/girassol.woff2",
   },
   {
      id: "jaini",
      label: "Jaini (ornamental)",
      family: "'Jaini'",
      url: "/fonts/jaini.woff2",
   },
   {
      id: "joti-one",
      label: "Joti One (angular)",
      family: "'Joti One'",
      url: "/fonts/joti-one.woff2",
   },
   {
      id: "medievalsharp",
      label: "MedievalSharp (gothic)",
      family: "'MedievalSharp'",
      url: "/fonts/medievalsharp.woff2",
   },
   {
      id: "new-rocker",
      label: "New Rocker (western)",
      family: "'New Rocker'",
      url: "/fonts/new-rocker.woff2",
   },
   {
      id: "shojumaru",
      label: "Shojumaru (samurai)",
      family: "'Shojumaru'",
      url: "/fonts/shojumaru.woff2",
   },
];

const loaded = new Map<string, Promise<void>>();

/** Lookup table, not a scan: the renderer calls ensureFontLoaded per text layer
 * and per caption on every frame. */
const OPTIONS_BY_FAMILY = new Map(FONT_OPTIONS.map((f) => [f.family, f]));

/** Shared, so a system or unknown family doesn't mint a promise per frame. */
const RESOLVED = Promise.resolve();

let version = 0;
const listeners = new Set<() => void>();

/**
 * Bumped every time a bundled face lands. Renderers that cache drawn text by
 * signature mix this in, so a caption drawn with the fallback face is redrawn
 * once its real font is available.
 */
export function fontsVersion(): number {
   return version;
}

/** Notified when a face lands, so a paused preview can redraw. Returns an unsubscribe. */
export function onFontsChanged(cb: () => void): () => void {
   listeners.add(cb);
   return () => listeners.delete(cb);
}

/**
 * Ensure the font for the given CSS family value is registered and loaded
 * into document.fonts so 2D-canvas drawing (preview and export) uses it.
 * System fonts and unknown families resolve immediately.
 */
export function ensureFontLoaded(family: string): Promise<void> {
   const option = OPTIONS_BY_FAMILY.get(family);
   if (!option?.url) return RESOLVED;

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
            version++;
            for (const cb of listeners) cb();
         })
         .catch(() => {
            loaded.delete(option.id);
         });
      loaded.set(option.id, promise);
   }
   return promise;
}
