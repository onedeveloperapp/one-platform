/**
 * The stores the documents package works through. In production they are the
 * functions of migration 0018 (the service role) and the private bucket
 * `firm-files`; in tests, fakes with the same rules. The package itself never
 * holds a database or a storage client.
 */

/** What the backend found when it measured the bytes of a file. */
export interface FileMeasure {
  /** SHA-256 of the bytes, in hex. */
  sha256: string;
  bytes: number;
  /** The type the bytes say they are (their first bytes), never the declared one. Null when unknown. */
  detectedMime: string | null;
  /** The pages of a PDF that could be read; null for anything else. */
  pages: number | null;
}

export type ReservedFile = { ok: true; fileId: string; storagePath: string } | { ok: false; code: string };

export interface FileStore {
  /** Reserves a file the backend makes itself (an issued document), for a firm. */
  reserve(input: {
    orgId: string;
    purpose: string;
    name: string;
    mime: string;
    bytes: number;
    requestedBy?: string | null;
  }): Promise<ReservedFile>;
  /** Writes the bytes at a reserved path. */
  put(storagePath: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** The bytes at a path, or null when nothing is there. */
  get(storagePath: string): Promise<Uint8Array | null>;
  /** Hands the measure to the store, which keeps the file or rejects it. */
  confirm(fileId: string, measure: FileMeasure): Promise<{ ok: boolean; code: string; reason?: string | null }>;
  /**
   * Forgets a file nothing refers to (a render that lost its claim). Rejects when the file was not
   * forgotten: the store did not answer, or something names the file after all.
   */
  discard(fileId: string): Promise<void>;
  /** Removes objects from the bucket. Of a file taken back, only after its record was forgotten (`takeBackFile`). */
  remove(storagePaths: string[]): Promise<void>;
}

export type DocumentStatus = "draft" | "issued" | "revoked";

export type ReservedDocument =
  | { ok: true; documentId: string; version: number; verifyCode: string; status: DocumentStatus }
  | { ok: false; code: string };

export interface DocumentStore {
  /** Reserves the next version; the same idempotency key returns the version it already reserved. */
  reserve(input: {
    orgId: string;
    kind: string;
    title: string;
    idempotencyKey: string;
    verifyCode: string;
    previousId?: string | null;
    requestedBy?: string | null;
  }): Promise<ReservedDocument>;
  /** Takes the draft for rendering: one renderer at a time. */
  claim(documentId: string, claimToken: string): Promise<"claimed" | "issued" | "revoked" | "busy" | "not_found">;
  /** Publishes the rendered version with its stored file. */
  publish(documentId: string, claimToken: string, fileId: string): Promise<{ ok: boolean; code: string }>;
  /** Lets go of a claim that failed, so a retry resumes the same version. */
  release(documentId: string, claimToken: string): Promise<void>;
}
