import sharp from "sharp";

/**
 * When a photo says it was taken: the `DateTimeOriginal` its camera wrote in the photo's EXIF (or, with none, the
 * `DateTimeDigitized`), with the `OffsetTimeOriginal` when the camera wrote one. It is the device's own clock, as the
 * device was set: the evidence kit shows it beside the moment ONE received the file, never in its place. A photo
 * with no EXIF (one sent through WhatsApp, a screenshot, a picture an app saved again) says nothing, and nothing is
 * guessed. Pure over the bytes; `photoTakenAt` reads the EXIF with sharp, `takenAtOfExif` parses it.
 */
export type PhotoMoment = {
  /** As the device wrote it, at the device's local time: `2099-10-22T14:35:10`. */
  local: string;
  /** The device's offset from UTC when it wrote one (`-03:00`), or null. */
  offset: string | null;
};

const TAG_EXIF_IFD = 0x8769;
const TAG_ORIGINAL = 0x9003;
const TAG_DIGITIZED = 0x9004;
const TAG_OFFSET_ORIGINAL = 0x9011;
const ASCII = 2;

type Reader = { u16: (at: number) => number; u32: (at: number) => number; bytes: Uint8Array };

function readerOf(tiff: Uint8Array): Reader | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const reader: Reader = {
    bytes: tiff,
    u16: (at) => (at + 2 <= tiff.length ? view.getUint16(at, little) : -1),
    u32: (at) => (at + 4 <= tiff.length ? view.getUint32(at, little) : -1),
  };
  return reader.u16(2) === 42 ? reader : null;
}

/** The entries of one IFD, by tag: where its value is and how long, for an ASCII value. */
function entriesOf(reader: Reader, offset: number): Map<number, { type: number; count: number; at: number }> {
  const entries = new Map<number, { type: number; count: number; at: number }>();
  const count = reader.u16(offset);
  if (count < 0 || count > 500) return entries;
  for (let index = 0; index < count; index += 1) {
    const entry = offset + 2 + index * 12;
    const tag = reader.u16(entry);
    const type = reader.u16(entry + 2);
    const length = reader.u32(entry + 4);
    if (tag < 0 || type < 0 || length < 0) break;
    // A value of four bytes or fewer sits in the entry itself; a longer one, at the offset the entry gives.
    const at = type === ASCII && length > 4 ? reader.u32(entry + 8) : entry + 8;
    entries.set(tag, { type, count: length, at });
  }
  return entries;
}

function asciiOf(reader: Reader, entry: { type: number; count: number; at: number } | undefined): string | null {
  if (!entry || entry.type !== ASCII || entry.count < 1 || entry.count > 64) return null;
  if (entry.at < 0 || entry.at + entry.count > reader.bytes.length) return null;
  let text = "";
  for (let index = 0; index < entry.count; index += 1) {
    const code = reader.bytes[entry.at + index]!;
    if (code === 0) break;
    text += String.fromCharCode(code);
  }
  return text.trim();
}

/** `2099:10:22 14:35:10` as `2099-10-22T14:35:10`, or null for what is no real moment (a blank or zeroed clock). */
function momentOf(value: string | null): string | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number) as number[];
  if (year! < 1990 || year! > 2200 || month! < 1 || month! > 12 || day! < 1 || day! > 31) return null;
  if (hour! > 23 || minute! > 59 || second! > 60) return null;
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  if (date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
}

/** The moment an EXIF block says its photo was taken, or null. Takes the block with or without its `Exif\0\0` mark. */
export function takenAtOfExif(exif: Uint8Array | null | undefined): PhotoMoment | null {
  if (!exif || exif.length < 14) return null;
  const marked = exif[0] === 0x45 && exif[1] === 0x78 && exif[2] === 0x69 && exif[3] === 0x66 && exif[4] === 0;
  const reader = readerOf(marked ? exif.subarray(6) : exif);
  if (!reader) return null;
  const first = reader.u32(4);
  if (first < 8) return null;
  const pointer = entriesOf(reader, first).get(TAG_EXIF_IFD);
  if (!pointer) return null;
  const exifIfd = reader.u32(pointer.at);
  if (exifIfd < 8) return null;
  const entries = entriesOf(reader, exifIfd);
  const local =
    momentOf(asciiOf(reader, entries.get(TAG_ORIGINAL))) ?? momentOf(asciiOf(reader, entries.get(TAG_DIGITIZED)));
  if (!local) return null;
  const offset = asciiOf(reader, entries.get(TAG_OFFSET_ORIGINAL));
  return { local, offset: offset && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null };
}

/** When the photo in these bytes says it was taken, or null (no photo, no EXIF, no moment, an image sharp cannot open). */
export async function photoTakenAt(bytes: Uint8Array): Promise<PhotoMoment | null> {
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata();
    return takenAtOfExif(metadata.exif ? new Uint8Array(metadata.exif) : null);
  } catch {
    return null;
  }
}
