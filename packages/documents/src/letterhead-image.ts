import sharp from "sharp";

/**
 * A picture of the firm's letterhead (its header's logo, its footer's band) as ONE keeps it to draw on every page
 * (0260): no wider than 1200 pixels, a PNG where it has a see-through ground and a JPEG otherwise, so the pieces it
 * goes on stay light and a filing package within the size each court takes. Server only (sharp).
 */

export const LETTERHEAD_IMAGE_WIDTH = 1200;

export type KeptImage = { bytes: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number };

export async function compressLetterheadImage(bytes: Uint8Array): Promise<KeptImage> {
  const image = sharp(bytes, { limitInputPixels: 40_000_000 }).rotate();
  const meta = await image.metadata();
  const resized = image.resize({ width: LETTERHEAD_IMAGE_WIDTH, fit: "inside", withoutEnlargement: true });
  if (meta.hasAlpha) {
    const out = await resized.png({ compressionLevel: 9, palette: true }).toBuffer({ resolveWithObject: true });
    return { bytes: new Uint8Array(out.data), mime: "image/png", width: out.info.width, height: out.info.height };
  }
  const out = await resized.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(out.data), mime: "image/jpeg", width: out.info.width, height: out.info.height };
}
