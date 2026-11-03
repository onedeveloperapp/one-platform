/**
 * A file made where the person is (a model of the library in Word) handed to
 * their browser to save: nothing goes to the server for it.
 */

/** What a file system refuses in a name, Windows' being the strictest. */
const REFUSED = /[\\/:*?"<>|]+/g;

/**
 * The name a file is saved under: the name it has on the screen, accents kept, without what a file system refuses,
 * never ending in a dot or a space, within 100 characters; `fallback` when nothing of it is left.
 */
export function savedFileName(name: string, extension: string, fallback: string): string {
  const base =
    Array.from(name.replace(REFUSED, " ").replace(/\s+/g, " ").trim())
      .slice(0, 100)
      .join("")
      .replace(/[.\s]+$/u, "") || fallback;
  return `${base}.${extension}`;
}

/** Hands the bytes to the browser as a file to save under `fileName`. */
export function saveFile(bytes: Uint8Array, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The browser reads the address when the click is taken: it is let go a moment after.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
