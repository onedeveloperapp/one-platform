/**
 * The technical test of M1: can the normalization of a client's files run
 * inside a serverless function (pdf-lib + sharp), or does it need a worker in
 * a container (Ghostscript, qpdf)?
 *
 *   npm run bench -w @flyee/documents
 *
 * It builds inputs the size of the real ones (phone photos of 12 megapixels,
 * a scan of 40 pages at 300 dpi), runs each operation of `normalize.ts` on
 * them and prints how long it took and the most memory the process held
 * while it ran. Nothing here is a client's file: the pictures are noise.
 * The README records what was measured and what was decided.
 */
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import { imagesToPdf, recompressPdfImages, splitPdfBySize } from "../src/normalize.ts";

const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

/** A picture with the weight of a phone photo: detail everywhere, so the JPEG is as heavy as a real one. */
const photo = (width: number, height: number, quality: number) =>
  sharp({
    create: { width, height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 28 } },
  })
    .blur(1.2)
    .jpeg({ quality })
    .toBuffer();

async function measured<T>(label: string, run: () => Promise<T>, describe: (result: T) => string): Promise<T> {
  globalThis.gc?.();
  const before = process.memoryUsage().rss;
  let peak = before;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 20);
  const started = performance.now();
  try {
    const result = await run();
    const seconds = (performance.now() - started) / 1000;
    peak = Math.max(peak, process.memoryUsage().rss);
    console.log(
      `${label.padEnd(46)} ${seconds.toFixed(1).padStart(6)} s   peak ${mb(peak).padStart(9)}   ${describe(result)}`,
    );
    return result;
  } finally {
    clearInterval(timer);
  }
}

console.log(`node ${process.version}, sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips}`);
console.log(`resting memory ${mb(process.memoryUsage().rss)}\n`);

// 1. Ten photos from a phone (4032 x 3024), as a client sends a boarding pass or an ID.
const photos: Uint8Array[] = [];
for (let index = 0; index < 10; index += 1) photos.push(await photo(4032, 3024, 88));
const photoBytes = photos.reduce((sum, item) => sum + item.byteLength, 0);
console.log(`input: 10 photos of 12 MP, ${mb(photoBytes)} in all`);
await measured(
  "10 photos to one PDF (A4 at 200 dpi, q72)",
  () => imagesToPdf(photos),
  (pdf) => `${mb(pdf.byteLength)}, ${(100 - (pdf.byteLength / photoBytes) * 100).toFixed(0)}% smaller`,
);

// 2. A scan of 40 pages at 300 dpi (2480 x 3508), as an office scanner or a scanner app produces.
const scanPages = 40;
const source = await PDFDocument.create();
for (let index = 0; index < scanPages; index += 1) {
  const page = source.addPage([595.28, 841.89]);
  page.drawImage(await source.embedJpg(await photo(2480, 3508, 85)), { x: 0, y: 0, width: 595.28, height: 841.89 });
}
const scan = await source.save();
console.log(`\ninput: a scan of ${scanPages} pages at 300 dpi, ${mb(scan.byteLength)}`);

// The limits the plan lists: Projudi TJGO 6 MB (files of 30 pages or more), eproc 11 MB.
for (const limit of [6, 11]) {
  await measured(
    `split the scan at ${limit} MB`,
    () => splitPdfBySize(scan, limit * MB),
    ({ parts, oversized }) =>
      `${parts.length} parts, largest ${mb(Math.max(...parts.map((part) => part.byteLength)))}, ${oversized.length} page(s) over the limit alone`,
  );
}

const smaller = await measured(
  "recompress the scan (200 dpi, q60)",
  () => recompressPdfImages(scan, { maxPixels: 2339, quality: 60 }),
  (result) =>
    `${mb(result.bytes.byteLength)}, ${(100 - (result.bytes.byteLength / scan.byteLength) * 100).toFixed(0)}% smaller, ${result.recompressed}/${result.images} images`,
);
await measured(
  "recompress the scan (150 dpi, q50)",
  () => recompressPdfImages(scan, { maxPixels: 1754, quality: 50 }),
  (result) => `${mb(result.bytes.byteLength)}, ${(100 - (result.bytes.byteLength / scan.byteLength) * 100).toFixed(0)}% smaller`,
);
await measured(
  "split the recompressed scan at 6 MB",
  () => splitPdfBySize(smaller.bytes, 6 * MB),
  ({ parts, oversized }) => `${parts.length} parts, ${oversized.length} page(s) over the limit alone`,
);

// 3. The worst case for a split: one page that alone is over the limit.
const heavy = await PDFDocument.create();
heavy.addPage([595.28, 841.89]).drawImage(await heavy.embedJpg(await photo(4960, 7016, 95)), {
  x: 0,
  y: 0,
  width: 595.28,
  height: 841.89,
});
const heavyBytes = await heavy.save();
console.log(`\ninput: one page scanned at 600 dpi, ${mb(heavyBytes.byteLength)}`);
await measured(
  "recompress the heavy page (200 dpi, q60)",
  () => recompressPdfImages(heavyBytes, { maxPixels: 2339, quality: 60 }),
  (result) => `${mb(result.bytes.byteLength)}`,
);
