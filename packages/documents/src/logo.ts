import sharp from "sharp";

import { brandColorOf, LOGO_BOX } from "@flyee/documents/brand";

/**
 * The firm's logo as ONE keeps it (0258): a PNG that fits `LOGO_BOX`, never enlarged, with what it is drawn on kept
 * see-through, and its main colour read by the rule of `@flyee/documents/brand`. Server only (sharp).
 */

export type NormalizedLogo = { png: Uint8Array; width: number; height: number; color: string | null };

export async function normalizeLogo(bytes: Uint8Array): Promise<NormalizedLogo> {
  const image = sharp(bytes, { density: 300, limitInputPixels: 40_000_000 }).rotate();
  const png = await image
    .clone()
    .resize({ width: LOGO_BOX.width, height: LOGO_BOX.height, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });
  const sample = await sharp(png.data)
    .resize({ width: 160, height: 160, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    png: new Uint8Array(png.data),
    width: png.info.width,
    height: png.info.height,
    color: brandColorOf(new Uint8Array(sample.data), sample.info.width, sample.info.height),
  };
}
