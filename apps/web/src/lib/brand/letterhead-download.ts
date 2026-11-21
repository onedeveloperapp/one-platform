import { letterheadDocxForDownload } from "@/lib/brand/letterhead-actions";

/**
 * The firm's own Word document on its letterhead (0260), read once per page and kept for every download of it: a text
 * of the firm's downloaded in Word is written into it (`downloadWord`). Null where the firm has none, or it could not
 * be read now (asked again on the next download).
 */
let letterheadOnce: Promise<Uint8Array | null> | null = null;

export function firmLetterheadBytes(): Promise<Uint8Array | null> {
  letterheadOnce ??= letterheadDocxForDownload()
    .then((encoded) => (encoded ? Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)) : null))
    .catch(() => {
      letterheadOnce = null;
      return null;
    });
  return letterheadOnce;
}
