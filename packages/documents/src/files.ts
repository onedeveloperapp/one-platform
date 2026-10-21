import type { FileStore } from "@flyee/documents/types";

/**
 * Takes back a file a work wrote that did not come to be anything: its
 * record is forgotten and, only then, its bytes are removed.
 *
 * The order is the point. A worker takes a file back when it believes
 * nothing names it, and it may be wrong: the answer of the store that made
 * the file somebody's document can get lost on the way. The store is the one
 * that knows (`discard` rejects when something names the file), so the bytes
 * of a file that is still on record are never removed. Bytes left with no
 * record are the upkeep's to remove; a record left with no bytes would be a
 * document nobody can open.
 *
 * True when the file was taken back. Never throws.
 */
export async function takeBackFile(files: FileStore, fileId: string, storagePath: string): Promise<boolean> {
  try {
    await files.discard(fileId);
  } catch {
    return false;
  }
  await files.remove([storagePath]).catch(() => undefined);
  return true;
}
