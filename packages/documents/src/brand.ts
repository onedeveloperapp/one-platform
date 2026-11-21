/**
 * The firm's brand (the plan "o escritório preparado antes do primeiro atendimento", phase 2, the owner, 2026-11-20):
 * its logo, as ONE keeps it for the pages and documents a client sees, and its main colour, read from the logo by a
 * rule (never a model's guess) and confirmed or changed by the person. The colour goes on icons, bars and fills; the
 * words on a fill of it take the text colour its contrast allows (WCAG 2.1, 1.4.3 and 1.4.11).
 *
 * Pure, for the browser too; the logo's image is read by `@flyee/documents/logo`.
 */

export const BRAND_RULE = "marca-v1";

/** How large ONE keeps a logo: it fits this box, never enlarged. */
export const LOGO_BOX = { width: 800, height: 400 } as const;

/** The colour of words on a light ground, and the light words on a dark fill. */
export const INK = "#1a1a1f";
export const PAPER = "#ffffff";

const hex = (value: number): string => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0");
export const toHex = (r: number, g: number, b: number): string => `#${hex(r)}${hex(g)}${hex(b)}`;

/** A colour written `#rrggbb`, or null. */
export function readHex(value: unknown): { r: number; g: number; b: number } | null {
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value.trim())) return null;
  const text = value.trim().slice(1);
  return {
    r: Number.parseInt(text.slice(0, 2), 16),
    g: Number.parseInt(text.slice(2, 4), 16),
    b: Number.parseInt(text.slice(4, 6), 16),
  };
}

/** The relative luminance of a colour (WCAG 2.1). */
export function luminance(color: string): number {
  const rgb = readHex(color);
  if (!rgb) return 0;
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** The contrast between two colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The words on a fill of the colour: the light ones or the dark ones, whichever reads better. */
export const wordsOn = (fill: string): string => (contrast(fill, PAPER) >= contrast(fill, INK) ? PAPER : INK);

/** Whether the colour may draw icons and bars on a light ground (3:1, WCAG 2.1, 1.4.11). */
export const drawsOnLight = (color: string): boolean => contrast(color, PAPER) >= 3;

/**
 * The main colour of a logo, from its pixels (RGBA, row by row): the most frequent colour that is no ground (white,
 * black, grey, or see-through), each colour taken by a coarse bucket and answered as the average of its bucket. Null
 * when the logo has none (a logo in black and white). Pure.
 */
export function brandColorOf(rgba: Uint8Array, width: number, height: number): string | null {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const pixels = Math.min(width * height, Math.floor(rgba.length / 4));
  for (let index = 0; index < pixels; index += 1) {
    const offset = index * 4;
    const r = rgba[offset]!;
    const g = rgba[offset + 1]!;
    const b = rgba[offset + 2]!;
    const alpha = rgba[offset + 3]!;
    if (alpha < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // A ground: nearly white, nearly black, or grey (little saturation).
    if (max > 245 && min > 235) continue;
    if (max < 28) continue;
    if (max - min < 32) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    bucket.count += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) if (!best || bucket.count > best.count) best = bucket;
  // A colour of a few stray pixels is none.
  if (!best || best.count < Math.max(4, pixels * 0.002)) return null;
  return toHex(best.r / best.count, best.g / best.count, best.b / best.count);
}

export const LOGO_MIMES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"] as const;
