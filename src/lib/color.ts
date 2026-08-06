export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  /** 0–360 */
  h: number;
  /** 0–1 */
  s: number;
  /** 0–1 */
  v: number;
}

/** Accepts #rgb and #rrggbb (with or without the #). Null when unparseable. */
export function hexToRgb(hex: string): Rgb | null {
  const s = hex.trim().replace(/^#/, "");
  const full =
    s.length === 3
      ? s[0] + s[0] + s[1] + s[1] + s[2] + s[2]
      : s.length === 6
        ? s
        : null;
  if (!full || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b))
    .toString(16)
    .slice(1)}`;
}

/** A valid #rrggbb, or `fallback` when the input isn't one yet (half-typed hex). */
export function normalizeHex(value: string | number, fallback: string): string {
  const rgb = hexToRgb(String(value));
  return rgb ? rgbToHex(rgb) : fallback;
}

/** 0–1 per channel, for shader uniforms. */
export function hexToVec3(hex: string, fallback = "#000000"): [number, number, number] {
  const rgb = hexToRgb(hex) ?? hexToRgb(fallback)!;
  return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = v - c;
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export function hexToHsv(hex: string, fallback = "#000000"): Hsv {
  return rgbToHsv(hexToRgb(hex) ?? hexToRgb(fallback)!);
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(hsvToRgb(hsv));
}

/** Fully saturated color for a hue, matching the duotone shader's old hue ramp. */
export function hueToHex(hue: number, value = 1): string {
  return hsvToHex({ h: hue, s: 1, v: value });
}
