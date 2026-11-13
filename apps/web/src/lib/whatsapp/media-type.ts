/** `audio/ogg; codecs=opus` is `audio/ogg`: the list of the purpose names types, not their parameters. */
export const baseMime = (mime: string | null | undefined): string => (mime ?? "").split(";")[0].trim().toLowerCase();

/** Types that name no format: what a server answers for "some bytes". */
const GENERIC = new Set([
  "application/octet-stream",
  "binary/octet-stream",
  "application/binary",
  "application/unknown",
]);

const specific = (mime: string | null | undefined): string | null => {
  const base = baseMime(mime);
  return base && !GENERIC.has(base) ? base : null;
};

/**
 * The type a media from WhatsApp is kept under: what its bytes are, when ONE knows the format; else the type
 * the vendor's download came with, unless it names no format; else the type the message itself declared.
 * OpenWA answers the download of a document as `application/octet-stream` while the message says
 * `application/pdf`: on 2026-11-13 a client's boarding pass in PDF was refused as a type not allowed four times,
 * because the vendor's generic word went before the message's. The confirmation of the file still checks the
 * bytes' own type against the purpose, so what is reserved here never lets in a type the purpose does not list.
 */
export function mediaType(detected: string | null, fetched: string | null, declared: string | null): string {
  return specific(detected) ?? specific(fetched) ?? specific(declared) ?? "application/octet-stream";
}
