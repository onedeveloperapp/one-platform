import assert from "node:assert/strict";
import test from "node:test";

import { PDFDocument } from "pdf-lib";
import sharp from "sharp";

import { A4, imagesToPdf, normalizeImage, recompressPdfImages, splitPdfBySize } from "./normalize.ts";

/** A picture that compresses like a photo does: noise, so its size follows its pixels. */
const noisy = (width: number, height: number, quality = 90) =>
  sharp({
    create: { width, height, channels: 3, background: "#808080", noise: { type: "gaussian", mean: 128, sigma: 35 } },
  })
    .jpeg({ quality })
    .toBuffer();

/** A PDF of `count` pages, each a little wider than the one before so the order can be read back. */
async function scannedPdf(count: number, pixels: [number, number] = [600, 800]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) {
    const page = pdf.addPage([400 + index * 10, 600]);
    page.drawImage(await pdf.embedJpg(await noisy(pixels[0], pixels[1])), { x: 0, y: 0, width: 400, height: 600 });
  }
  return pdf.save();
}

const widthsOf = async (parts: Uint8Array[]): Promise<number[]> => {
  const widths: number[] = [];
  for (const part of parts) {
    for (const page of (await PDFDocument.load(part)).getPages()) widths.push(Math.round(page.getWidth()));
  }
  return widths;
};

test("a photo becomes what a page carries: upright, no larger than needed, a JPEG", async () => {
  const photo = await noisy(3000, 2000);
  const normal = await normalizeImage(photo);
  assert.equal(normal.width, 2339);
  assert.equal(normal.height, 1559);
  assert.ok(normal.jpeg.byteLength < photo.byteLength);

  // Held upright, stored lying down: the metadata says so, and the page gets it upright.
  const sideways = await sharp(photo).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const upright = await normalizeImage(sideways, { maxPixels: 1000 });
  assert.equal(upright.width < upright.height, true);
  assert.equal((await sharp(upright.jpeg).metadata()).orientation, undefined);

  // A small image is never enlarged.
  const small = await normalizeImage(await noisy(300, 200));
  assert.deepEqual([small.width, small.height], [300, 200]);
});

test("a transparent image lands on white, not on black", async () => {
  const transparent = await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png()
    .toBuffer();
  const normal = await normalizeImage(transparent);
  const { data } = await sharp(normal.jpeg).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[0] > 250 && data[1] > 250 && data[2] > 250);
});

test("photos become one PDF, a page each, lying down or upright as the photo is", async () => {
  const pdf = await PDFDocument.load(await imagesToPdf([await noisy(1200, 800), await noisy(800, 1200)], { maxPixels: 600 }));
  const [first, second] = pdf.getPages();
  assert.equal(pdf.getPageCount(), 2);
  assert.deepEqual([Math.round(first.getWidth()), Math.round(first.getHeight())], [Math.round(A4.height), Math.round(A4.width)]);
  assert.deepEqual([Math.round(second.getWidth()), Math.round(second.getHeight())], [Math.round(A4.width), Math.round(A4.height)]);
});

test("a PDF too large for one upload is split at page boundaries, in order, each part within the limit", async () => {
  const pdf = await scannedPdf(8);
  const limit = Math.ceil(pdf.byteLength / 3);
  const { parts, oversized } = await splitPdfBySize(pdf, limit);
  assert.ok(parts.length >= 3);
  assert.deepEqual(oversized, []);
  for (const part of parts) assert.ok(part.byteLength <= limit, `${part.byteLength} > ${limit}`);
  assert.deepEqual(await widthsOf(parts), [400, 410, 420, 430, 440, 450, 460, 470]);
});

test("a PDF already within the limit is left exactly as it is", async () => {
  const pdf = await scannedPdf(2);
  const { parts, oversized } = await splitPdfBySize(pdf, pdf.byteLength);
  assert.equal(parts.length, 1);
  assert.equal(parts[0], pdf);
  assert.deepEqual(oversized, []);
});

test("a page that alone exceeds the limit is named: a split cannot help it", async () => {
  const pdf = await scannedPdf(3);
  const { parts, oversized } = await splitPdfBySize(pdf, 2000);
  assert.equal(parts.length, 3);
  assert.deepEqual(oversized, [0, 1, 2]);
  assert.deepEqual(await widthsOf(parts), [400, 410, 420]);
});

test("the images of a scan are compressed again, and the PDF keeps its pages", async () => {
  const scan = await scannedPdf(2, [1800, 2400]);
  const result = await recompressPdfImages(scan, { maxPixels: 1000, quality: 50 });
  assert.deepEqual([result.images, result.recompressed, result.untouched], [2, 2, 0]);
  assert.ok(result.bytes.byteLength < scan.byteLength * 0.5, `${result.bytes.byteLength} of ${scan.byteLength}`);
  assert.deepEqual(await widthsOf([result.bytes]), [400, 410]);

  // Asking again for the same finds nothing left to gain.
  const again = await recompressPdfImages(result.bytes, { maxPixels: 1000, quality: 50 });
  assert.equal(again.recompressed, 0);
});

test("what is not a JPEG scan comes back untouched", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([400, 600]);
  page.drawText("Um documento que nasceu digital", { x: 40, y: 540 });
  const lossless = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#346" } }).png().toBuffer();
  page.drawImage(await pdf.embedPng(lossless), { x: 40, y: 200, width: 200, height: 200 });
  const result = await recompressPdfImages(await pdf.save(), { maxPixels: 100, quality: 30 });
  assert.deepEqual([result.images, result.recompressed, result.untouched], [1, 0, 1]);
  assert.equal((await PDFDocument.load(result.bytes)).getPageCount(), 1);
});
