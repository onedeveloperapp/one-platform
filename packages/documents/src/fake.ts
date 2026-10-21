import type {
  DocumentStatus,
  DocumentStore,
  FileMeasure,
  FileStore,
  ReservedDocument,
  ReservedFile,
} from "@flyee/documents/types";

type FakeFile = {
  id: string;
  orgId: string;
  purpose: string;
  name: string;
  storagePath: string;
  status: "reserved" | "stored" | "rejected";
  measure: FileMeasure | null;
};

/**
 * The firm's files in memory, with the rules of the real store (migration
 * 0018) the issue flow depends on: a file is reserved under the firm's
 * folder, kept only when its bytes are of a type its purpose allows, and a
 * file is confirmed once.
 */
export class FakeFileStore implements FileStore {
  readonly files = new Map<string, FakeFile>();
  /** What is in the bucket, by path. */
  readonly objects = new Map<string, Uint8Array>();
  private sequence = 0;
  private readonly allowed: Record<string, string[]>;

  constructor(allowed: Record<string, string[]> = { issued: ["application/pdf"] }) {
    this.allowed = allowed;
  }

  async reserve(input: {
    orgId: string;
    purpose: string;
    name: string;
    mime: string;
    bytes: number;
  }): Promise<ReservedFile> {
    const mimes = this.allowed[input.purpose];
    if (!mimes) return { ok: false, code: "unknown_purpose" };
    if (!mimes.includes(input.mime)) return { ok: false, code: "type_not_allowed" };
    this.sequence += 1;
    const id = `file-${this.sequence}`;
    const storagePath = `org/${input.orgId}/${input.purpose}/${id}`;
    this.files.set(id, {
      id,
      orgId: input.orgId,
      purpose: input.purpose,
      name: input.name,
      storagePath,
      status: "reserved",
      measure: null,
    });
    return { ok: true, fileId: id, storagePath };
  }

  async put(storagePath: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(storagePath, bytes);
  }

  async get(storagePath: string): Promise<Uint8Array | null> {
    return this.objects.get(storagePath) ?? null;
  }

  async confirm(fileId: string, measure: FileMeasure): Promise<{ ok: boolean; code: string; reason?: string | null }> {
    const file = this.files.get(fileId);
    if (!file) return { ok: false, code: "not_found" };
    if (file.status !== "reserved") {
      const same = file.status === "stored" && file.measure?.sha256 === measure.sha256;
      return { ok: same, code: same ? "stored" : `already_${file.status}` };
    }
    const allowed = measure.detectedMime !== null && (this.allowed[file.purpose] ?? []).includes(measure.detectedMime);
    file.status = allowed ? "stored" : "rejected";
    file.measure = allowed ? measure : null;
    return allowed ? { ok: true, code: "stored" } : { ok: false, code: "rejected", reason: "type_not_allowed" };
  }

  /** The files something names (an issued document): the real store never forgets one of these. */
  readonly named = new Set<string>();

  async discard(fileId: string): Promise<void> {
    if (this.named.has(fileId)) throw new Error("discard refused: in_use");
    this.files.delete(fileId);
  }

  async remove(storagePaths: string[]): Promise<void> {
    for (const path of storagePaths) this.objects.delete(path);
  }
}

type FakeDocument = {
  id: string;
  orgId: string;
  kind: string;
  title: string;
  version: number;
  previousId: string | null;
  status: DocumentStatus;
  verifyCode: string;
  idempotencyKey: string;
  claimToken: string | null;
  fileId: string | null;
};

/**
 * The issued documents in memory, with the rules of the real store: the same
 * idempotency key is one version, a version follows one issued version of the
 * same firm and kind, one renderer holds the claim, and what is published is
 * a stored file of the same firm.
 */
export class FakeDocumentStore implements DocumentStore {
  readonly documents = new Map<string, FakeDocument>();
  private sequence = 0;
  private readonly files: FakeFileStore;

  constructor(files: FakeFileStore) {
    this.files = files;
  }

  async reserve(input: {
    orgId: string;
    kind: string;
    title: string;
    idempotencyKey: string;
    verifyCode: string;
    previousId?: string | null;
  }): Promise<ReservedDocument> {
    for (const existing of this.documents.values()) {
      if (existing.orgId === input.orgId && existing.idempotencyKey === input.idempotencyKey) {
        return {
          ok: true,
          documentId: existing.id,
          version: existing.version,
          verifyCode: existing.verifyCode,
          status: existing.status,
        };
      }
    }
    let version = 1;
    if (input.previousId) {
      const previous = this.documents.get(input.previousId);
      if (!previous || previous.orgId !== input.orgId || previous.kind !== input.kind) {
        return { ok: false, code: "previous_not_found" };
      }
      if (previous.status === "draft") return { ok: false, code: "previous_not_issued" };
      if ([...this.documents.values()].some((other) => other.previousId === previous.id)) {
        return { ok: false, code: "previous_already_followed" };
      }
      version = previous.version + 1;
    }
    this.sequence += 1;
    const id = `document-${this.sequence}`;
    this.documents.set(id, {
      id,
      orgId: input.orgId,
      kind: input.kind,
      title: input.title,
      version,
      previousId: input.previousId ?? null,
      status: "draft",
      verifyCode: input.verifyCode,
      idempotencyKey: input.idempotencyKey,
      claimToken: null,
      fileId: null,
    });
    return { ok: true, documentId: id, version, verifyCode: input.verifyCode, status: "draft" };
  }

  async claim(documentId: string, claimToken: string): Promise<"claimed" | "issued" | "revoked" | "busy" | "not_found"> {
    const document = this.documents.get(documentId);
    if (!document) return "not_found";
    if (document.status !== "draft") return document.status;
    if (document.claimToken && document.claimToken !== claimToken) return "busy";
    document.claimToken = claimToken;
    return "claimed";
  }

  async publish(documentId: string, claimToken: string, fileId: string): Promise<{ ok: boolean; code: string }> {
    const document = this.documents.get(documentId);
    if (!document) return { ok: false, code: "not_found" };
    if (document.status !== "draft") return { ok: document.fileId === fileId, code: `already_${document.status}` };
    if (document.claimToken !== claimToken) return { ok: false, code: "claim_lost" };
    const file = this.files.files.get(fileId);
    if (!file || file.orgId !== document.orgId || file.purpose !== "issued" || file.status !== "stored") {
      return { ok: false, code: "invalid_file" };
    }
    document.status = "issued";
    document.fileId = fileId;
    document.claimToken = null;
    this.files.named.add(fileId);
    return { ok: true, code: "issued" };
  }

  async release(documentId: string, claimToken: string): Promise<void> {
    const document = this.documents.get(documentId);
    if (document && document.status === "draft" && document.claimToken === claimToken) document.claimToken = null;
  }

  /** What `revoke_document` does for a lawyer of the firm. */
  revoke(documentId: string): void {
    const document = this.documents.get(documentId);
    if (document && document.status === "issued") document.status = "revoked";
  }
}
