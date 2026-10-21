/**
 * What a file is, by its first bytes. The name and the type a browser declares
 * are what somebody says the file is; this is what it is. The backend runs it
 * on every upload before keeping it, so a page renamed to `.pdf` is rejected
 * as what it is.
 *
 * Only the types the platform works with are named; anything else is null,
 * and a null type is never kept.
 */

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));

/** The brands of the ISO media container that are HEIC or HEIF images. */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis"]);
const HEIF_BRANDS = new Set(["mif1", "msf1", "heif"]);
/** The brands of the same container that are an MP4 video. */
const MP4_BRANDS = new Set(["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "mmp4", "dash"]);

/**
 * True when the bytes open with the header of a PDF. Only a byte-order mark
 * and blank space may come before it: a file with anything else first (a page
 * of HTML that carries `%PDF-` further down, to pass for one) is not a PDF.
 */
function startsAsPdf(bytes: Uint8Array): boolean {
  let start = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (start < bytes.length && start < 64 && [0x09, 0x0a, 0x0d, 0x20].includes(bytes[start])) start += 1;
  return ascii(bytes, start, start + 5) === "%PDF-";
}

/**
 * The kinds of track an MP4 carries, read from the handler of each one (the
 * `hdlr` box, whose type comes twelve bytes after its name): `vide` for
 * pictures, `soun` for sound. The boxes may sit at the end of the file, so
 * the whole of it is looked at.
 */
function mp4Tracks(bytes: Uint8Array): { video: boolean; sound: boolean } {
  let video = false;
  let sound = false;
  for (let at = 4; at + 16 <= bytes.length; at += 1) {
    if (bytes[at] !== 0x68 || bytes[at + 1] !== 0x64 || bytes[at + 2] !== 0x6c || bytes[at + 3] !== 0x72) continue;
    const handler = ascii(bytes, at + 12, at + 16);
    if (handler === "vide") video = true;
    else if (handler === "soun") sound = true;
  }
  return { video, sound };
}

/** The DER of the OID of a CMS SignedData (1.2.840.113549.1.7.2), as it opens a `.p7s`. */
const SIGNED_DATA_OID = [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02];

/**
 * True when the bytes open as a CMS SignedData (a `.p7s`, RFC 5652): a
 * SEQUENCE, of any length form, whose first element is the OID of signed
 * data. What ONE signs for a court is kept as one.
 */
function startsAsSignedData(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0x30 || bytes.length < 2) return false;
  const lengthByte = bytes[1];
  // A short length, an indefinite one (0x80), or a long one of up to four bytes.
  const header = lengthByte < 0x80 || lengthByte === 0x80 ? 2 : lengthByte <= 0x84 ? 2 + (lengthByte & 0x7f) : -1;
  return header > 0 && startsWith(bytes, SIGNED_DATA_OID, header);
}

export function detectMime(bytes: Uint8Array): string | null {
  if (startsAsPdf(bytes)) return "application/pdf";
  if (startsAsSignedData(bytes)) return "application/pkcs7-mime";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
    // The same container carries what a phone records: sound alone, or a video.
    if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
    if (brand.startsWith("3gp") || brand.startsWith("3g2")) return "video/3gpp";
    if (MP4_BRANDS.has(brand)) {
      // A recorder may write sound alone under a general brand (`mp42`, `isom`): its tracks say what it is.
      const tracks = mp4Tracks(bytes);
      return tracks.sound && !tracks.video ? "audio/mp4" : "video/mp4";
    }
    return null;
  }
  // Sound, as a messaging app sends it: a voice message is Ogg, the rest varies by phone.
  if (ascii(bytes, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(bytes, 0, 5) === "#!AMR") return "audio/amr";
  if (ascii(bytes, 0, 3) === "ID3") return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff) {
    // An MPEG audio frame opens with eleven set bits; its layer tells AAC (none) from MP3.
    if ((bytes[1] & 0xf6) === 0xf0) return "audio/aac";
    if ((bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0) return "audio/mpeg";
  }
  return null;
}
