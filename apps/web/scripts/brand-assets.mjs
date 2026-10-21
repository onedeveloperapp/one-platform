/**
 * Derive every raster brand asset from the mark, so none of them is ever
 * exported by hand again. The masters are the SVGs in public/brand/ and stay
 * untouched: this script only reads them. The current masters are the
 * provisional ONE mark (2026-10-08); the official one replaces the same files.
 *
 *   public/brand/one-mark.svg       blue tile, for light surfaces
 *   public/brand/one-mark-dark.svg  cyan tile, for dark surfaces
 *
 * It writes:
 *   public/brand/one-mark.png          512x512, transparent corners. BRAND.mark:
 *                                      the icon a search engine reads, the
 *                                      Organization logo and the social card.
 *   public/brand/apple-touch-icon.png  180x180, full bleed. iOS paints black
 *                                      behind transparent pixels and applies
 *                                      its own mask, so this one has no corners.
 *   public/favicon/favicon-light.ico   16, 32 and 48 px, for light tab strips
 *   public/favicon/favicon-dark.ico    16, 32 and 48 px, for dark tab strips
 *   public/favicon.ico                 the dark-surface tile: what a client asks for
 *                                      when it reads no <link rel="icon">
 *
 * Usage: npm run brand:assets -w @flyee/web   (after replacing a master)
 *
 * sharp arrives with Next and is not a dependency of its own here; when it
 * cannot be resolved the script says so and exits 0, like marketing-shots.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "../public");

let sharp;
try {
  sharp = require("sharp");
} catch {
  console.log("sharp is not installed: run `npm install` at the repo root, then retry.");
  process.exit(0);
}

const MASTERS = {
  light: resolve(PUBLIC, "brand/one-mark.svg"),
  dark: resolve(PUBLIC, "brand/one-mark-dark.svg"),
};
const ICO_SIZES = [16, 32, 48];

/** The mark at `size` px, rendered large first so small sizes are downsampled, never upsampled. */
async function render(master, size) {
  const large = await sharp(readFileSync(master), { density: 288 }).png().toBuffer();
  return sharp(large).resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });
}

/**
 * One ICO holding BMP entries (32-bit BGRA plus the 1-bit mask the format
 * still requires). BMP rather than PNG entries: every reader of .ico accepts
 * them, including the ones that predate PNG-in-ICO.
 */
async function ico(master) {
  const images = [];
  for (const size of ICO_SIZES) {
    const { data } = await (await render(master, size)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0); // BITMAPINFOHEADER
    header.writeInt32LE(size, 4);
    header.writeInt32LE(size * 2, 8); // colour rows + mask rows
    header.writeUInt16LE(1, 12);
    header.writeUInt16LE(32, 14);
    header.writeUInt32LE(size * size * 4, 20);
    const pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const from = (y * size + x) * 4;
        const to = ((size - 1 - y) * size + x) * 4; // rows are stored bottom-up
        pixels[to] = data[from + 2];
        pixels[to + 1] = data[from + 1];
        pixels[to + 2] = data[from];
        pixels[to + 3] = data[from + 3];
      }
    }
    const maskRow = Math.ceil(size / 32) * 4; // 1 bit per pixel, rows padded to 32 bits
    images.push({ size, bytes: Buffer.concat([header, pixels, Buffer.alloc(maskRow * size)]) });
  }
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(1, 2); // type: icon
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    directory.writeUInt8(image.size, entry);
    directory.writeUInt8(image.size, entry + 1);
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(image.bytes.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += image.bytes.length;
  });
  return Buffer.concat([directory, ...images.map((image) => image.bytes)]);
}

const written = [];
const write = (path, bytes) => {
  writeFileSync(resolve(PUBLIC, path), bytes);
  written.push(`${path} (${bytes.length} bytes)`);
};

write("brand/one-mark.png", await (await render(MASTERS.dark, 512)).png({ compressionLevel: 9 }).toBuffer());

// The tile colour is read from the art (top edge, centre), so a new master
// carries its own colour here without an edit.
const probe = await (await render(MASTERS.dark, 180)).ensureAlpha().raw().toBuffer();
const at = (4 * 180 + 90) * 4;
const tile = { r: probe[at], g: probe[at + 1], b: probe[at + 2] };
write(
  "brand/apple-touch-icon.png",
  await (await render(MASTERS.dark, 180)).flatten({ background: tile }).png({ compressionLevel: 9 }).toBuffer(),
);

write("favicon/favicon-light.ico", await ico(MASTERS.light));
const darkIco = await ico(MASTERS.dark);
write("favicon/favicon-dark.ico", darkIco);
write("favicon.ico", darkIco);

console.log(written.map((line) => `wrote public/${line}`).join("\n"));
