import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import sharp from "sharp";

/**
 * Making a client's files fit what a court system accepts: a photo becomes a
 * PDF page, a PDF too large for one upload is split at page boundaries, and
 * the images inside a scanned PDF are compressed again.
 *
 * All of it runs in the function, with `sharp` (images) and `pdf-lib` (the
 * PDF structure): nothing here needs Ghostscript or qpdf. The limits come
 * from the table of court systems, never from this file. What the technical
 * test of M1 measured, and what it left out, is in the README.
 */

/** A4 in points. */
export const A4 = { width: 595.28, height: 841.89 } as const;

/** The long side, in pixels, of an A4 page at 200 dpi: enough to read a document, far below a phone photo. */
export const A4_200DPI = 2339;

export interface ImageOptions {
  /** The long side an image is reduced to, in pixels. Never enlarged. */
  maxPixels?: number;
  /** JPEG quality, 1 to 100. */
  quality?: number;
}

const DEFAULT_IMAGE: Required<ImageOptions> = { maxPixels: A4_200DPI, quality: 72 };

/** The most pixels an input image may have: a guard against a file crafted to exhaust memory. */
const INPUT_PIXEL_LIMIT = 120_000_000;

/**
 * An image as a page will carry it: upright (a phone photo says how it was
 * held in its metadata), no larger than needed, on white (a transparent PNG
 * would otherwise turn black), as a JPEG, with the metadata left out.
 */
export async function normalizeImage(
  bytes: Uint8Array,
  options: ImageOptions = {},
): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const { maxPixels, quality } = { ...DEFAULT_IMAGE, ...options };
  const { data, info } = await sharp(bytes, { limitInputPixels: INPUT_PIXEL_LIMIT })
    .rotate()
    .resize({ width: maxPixels, height: maxPixels, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg({ quality, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { jpeg: data, width: info.width, height: info.height };
}

/** Photos and scans as one PDF, a page each: A4, upright or lying down as the image is, inside a margin. */
export async function imagesToPdf(
  images: Uint8Array[],
  options: ImageOptions & { margin?: number } = {},
): Promise<Uint8Array> {
  const margin = options.margin ?? 28;
  const pdf = await PDFDocument.create();
  for (const bytes of images) {
    const image = await normalizeImage(bytes, options);
    const landscape = image.width > image.height;
    const pageWidth = landscape ? A4.height : A4.width;
    const pageHeight = landscape ? A4.width : A4.height;
    const scale = Math.min((pageWidth - 2 * margin) / image.width, (pageHeight - 2 * margin) / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const page = pdf.addPage([pageWidth, pageHeight]);
    page.drawImage(await pdf.embedJpg(image.jpeg), {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height,
    });
  }
  return pdf.save();
}

async function pagesAsPdf(source: PDFDocument, indexes: number[]): Promise<Uint8Array> {
  const part = await PDFDocument.create();
  for (const page of await part.copyPages(source, indexes)) part.addPage(page);
  return part.save();
}

export interface SplitResult {
  /** The parts, in order, each within the limit unless it is a single page that alone exceeds it. */
  parts: Uint8Array[];
  /** The pages (from 0) that alone exceed the limit: they need compressing, a split cannot help. */
  oversized: number[];
}

/**
 * Splits a PDF into parts no larger than `maxBytes`, at page boundaries and
 * in order. Each page is measured once on its own; the parts are filled by
 * those measures and then checked at their real size, because pages that
 * share a font or an image weigh less together than apart.
 */
export async function splitPdfBySize(pdfBytes: Uint8Array, maxBytes: number): Promise<SplitResult> {
  if (pdfBytes.byteLength <= maxBytes) return { parts: [pdfBytes], oversized: [] };
  const source = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const count = source.getPageCount();

  const alone: number[] = [];
  for (let index = 0; index < count; index += 1) alone.push((await pagesAsPdf(source, [index])).byteLength);

  const groups: number[][] = [];
  let current: number[] = [];
  let weight = 0;
  for (let index = 0; index < count; index += 1) {
    if (current.length > 0 && weight + alone[index] > maxBytes) {
      groups.push(current);
      current = [];
      weight = 0;
    }
    current.push(index);
    weight += alone[index];
  }
  if (current.length > 0) groups.push(current);

  const parts: Uint8Array[] = [];
  const oversized: number[] = [];
  // A group is checked at its real size; one that still exceeds the limit
  // (the measures apart undercount what a part carries once) is halved.
  const queue = [...groups];
  while (queue.length > 0) {
    const group = queue.shift() as number[];
    const bytes = await pagesAsPdf(source, group);
    if (bytes.byteLength <= maxBytes || group.length === 1) {
      if (bytes.byteLength > maxBytes) oversized.push(group[0]);
      parts.push(bytes);
      continue;
    }
    const middle = Math.ceil(group.length / 2);
    queue.unshift(group.slice(0, middle), group.slice(middle));
  }
  return { parts, oversized };
}

const filterNames = (dict: PDFDict): string[] => {
  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter instanceof PDFName) return [filter.decodeText()];
  if (filter instanceof PDFArray) {
    return filter.asArray().map((item) => (item instanceof PDFName ? item.decodeText() : ""));
  }
  return [];
};

export interface RecompressResult {
  bytes: Uint8Array;
  /** Images found in the PDF. */
  images: number;
  /** Images replaced by a smaller version. */
  recompressed: number;
  /** Images left as they were: not a JPEG, or already as small as asked. */
  untouched: number;
}

/**
 * Compresses again the JPEG images inside a PDF (what a scan or a phone
 * scanner app produces): each is reduced to `maxPixels` on its long side and
 * re-encoded at `quality`, and replaces the original only when it is clearly
 * smaller. Text, vectors and every other kind of image are left exactly as
 * they are, so a PDF that is not a scan comes back unchanged.
 */
export async function recompressPdfImages(pdfBytes: Uint8Array, options: ImageOptions = {}): Promise<RecompressResult> {
  const { maxPixels, quality } = { ...DEFAULT_IMAGE, ...options };
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  let images = 0;
  let recompressed = 0;

  for (const [ref, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    const subtype = dict.lookup(PDFName.of("Subtype"));
    if (!(subtype instanceof PDFName) || subtype.decodeText() !== "Image") continue;
    images += 1;

    // Only a plain JPEG stream: anything else (lossless scans, masks, JPEG
    // 2000, a JPEG wrapped in another filter) is left alone.
    const filters = filterNames(dict);
    if (filters.length !== 1 || filters[0] !== "DCTDecode") continue;

    let replacement: { data: Buffer; info: sharp.OutputInfo };
    try {
      replacement = await sharp(object.contents, { limitInputPixels: INPUT_PIXEL_LIMIT })
        .resize({ width: maxPixels, height: maxPixels, fit: "inside", withoutEnlargement: true })
        .toColourspace("srgb")
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    } catch {
      // An image sharp cannot read stays as it is: the PDF must come out whole.
      continue;
    }
    if (replacement.data.byteLength > object.contents.byteLength * 0.9) continue;

    const next = dict.clone(pdf.context);
    next.set(PDFName.of("Width"), PDFNumber.of(replacement.info.width));
    next.set(PDFName.of("Height"), PDFNumber.of(replacement.info.height));
    next.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
    next.set(PDFName.of("ColorSpace"), PDFName.of(replacement.info.channels === 1 ? "DeviceGray" : "DeviceRGB"));
    next.set(PDFName.of("Length"), PDFNumber.of(replacement.data.byteLength));
    // What described the old encoding (an inverted CMYK, decode parameters) no longer applies.
    next.delete(PDFName.of("Decode"));
    next.delete(PDFName.of("DecodeParms"));
    pdf.context.assign(ref, PDFRawStream.of(next, replacement.data));
    recompressed += 1;
  }

  return { bytes: await pdf.save(), images, recompressed, untouched: images - recompressed };
}
