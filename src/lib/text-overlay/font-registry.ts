/**
 * Shared bookkeeping for every face the canvas renderers can draw with —
 * bundled (fonts.ts) and user-added (custom-fonts.svelte.ts) alike. It lives in
 * its own module so those two don't have to import each other.
 */

const families = new Map<string, Promise<void>>();

let version = 0;
const listeners = new Set<() => void>();

/**
 * Bumped every time a face lands. Renderers that cache drawn text by signature
 * mix this in, so a caption drawn with the fallback face is redrawn once its
 * real font is available.
 */
export function fontsVersion(): number {
   return version;
}

/** Notified when a face lands, so a paused preview can redraw. Returns an unsubscribe. */
export function onFontsChanged(cb: () => void): () => void {
   listeners.add(cb);
   return () => listeners.delete(cb);
}

/** Tell every listener a face landed (or went away) and invalidate cached draws. */
export function bumpFontsVersion(): void {
   version++;
   for (const cb of listeners) cb();
}

/** Record the in-flight load for a CSS family value, so a second ask reuses it. */
export function registerFamily(family: string, promise: Promise<void>): void {
   families.set(family, promise);
}

export function unregisterFamily(family: string): void {
   families.delete(family);
}

/** The pending/settled load for a family, or undefined if nothing claims it. */
export function familyPromise(family: string): Promise<void> | undefined {
   return families.get(family);
}

let pending: Promise<void> | null = null;

/**
 * The in-flight read of the user's saved fonts. Set once at startup and
 * cleared when it settles, so asking for a family before it lands can wait
 * for it — and so the per-frame path costs nothing once it has.
 */
export function setFontsPending(p: Promise<void>): void {
   pending = p;
   void p.then(
      () => {
         if (pending === p) pending = null;
      },
      () => {
         if (pending === p) pending = null;
      },
   );
}

export function fontsPending(): Promise<void> | null {
   return pending;
}
