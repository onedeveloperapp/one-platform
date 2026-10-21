import { randomUUID } from "node:crypto";

import { generateVerifyCode } from "@flyee/documents/code-generator";
import { verifyUrlFor } from "@flyee/documents/codes";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import type { DocumentStore, FileStore } from "@flyee/documents/types";

/**
 * Issuing a document, the one way every document goes.
 *
 * A document ONE issues (a power of attorney, a contract, a filing package)
 * is a version with a public code. This function reserves the version, takes
 * the claim that lets one renderer at a time work on it, asks the caller to
 * render the PDF with the code that will be printed on it, stores the bytes
 * as a file of the firm, and publishes the version with the hash of those
 * bytes. The same request made twice (the same idempotency key) is the same
 * version: nothing is rendered or stored a second time.
 *
 * It decides nothing about the content: the renderer is the caller's.
 */

export interface IssueInput {
  orgId: string;
  /** What the document is, as a slug: `procuracao`, `contrato`. */
  kind: string;
  /** For the firm's own lists; never shown by the public verification. */
  title: string;
  /** One per request of a person or a job: a retry reuses it, a new issue takes a new one. */
  idempotencyKey: string;
  /** The issued version this one replaces, when it is a reissue. */
  previousId?: string | null;
  /** The person who asked, when a person did. */
  requestedBy?: string | null;
  /** The public address of the site, for the verification link printed on the document. */
  verifyBaseUrl: string;
  /** The name the stored file shows with. Defaults to the kind and the version. */
  fileName?: string;
}

/** What the renderer is given: what must be printed on the document for it to be checked. */
export interface RenderContext {
  documentId: string;
  version: number;
  verifyCode: string;
  verifyUrl: string;
}

export type IssueResult =
  | {
      kind: "issued";
      documentId: string;
      version: number;
      verifyCode: string;
      verifyUrl: string;
      /** True when the version already existed: nothing was rendered now. */
      replayed: boolean;
    }
  /** The store would not reserve it (a previous version that is not issued, a requester of another firm). */
  | { kind: "refused"; code: string }
  /** It was reserved and did not get published. A retry with the same key resumes the same version. */
  | { kind: "failed"; documentId: string; code: string };

export interface IssueDeps {
  documents: DocumentStore;
  files: FileStore;
  /** Injected in tests; a random UUID otherwise. */
  newClaimToken?: () => string;
  /** Injected in tests; a random code otherwise. */
  newVerifyCode?: () => string;
}

/** A failure the flow names itself, so the record carries a code and never an exception's text. */
class IssueFailure extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function issueDocument(
  deps: IssueDeps,
  input: IssueInput,
  render: (context: RenderContext) => Promise<Uint8Array>,
): Promise<IssueResult> {
  const reserved = await deps.documents.reserve({
    orgId: input.orgId,
    kind: input.kind,
    title: input.title,
    idempotencyKey: input.idempotencyKey,
    verifyCode: (deps.newVerifyCode ?? generateVerifyCode)(),
    previousId: input.previousId ?? null,
    requestedBy: input.requestedBy ?? null,
  });
  if (!reserved.ok) return { kind: "refused", code: reserved.code };

  const { documentId, version, verifyCode } = reserved;
  const verifyUrl = verifyUrlFor(input.verifyBaseUrl, verifyCode);
  const issued = (replayed: boolean): IssueResult => ({
    kind: "issued",
    documentId,
    version,
    verifyCode,
    verifyUrl,
    replayed,
  });

  if (reserved.status === "issued") return issued(true);
  // The version exists and the firm withdrew it: another one is another request.
  if (reserved.status === "revoked") return { kind: "refused", code: "revoked" };

  const claimToken = (deps.newClaimToken ?? randomUUID)();
  const claim = await deps.documents.claim(documentId, claimToken);
  if (claim === "issued") return issued(true);
  if (claim !== "claimed") return { kind: "failed", documentId, code: claim };

  let stored: { fileId: string; storagePath: string } | null = null;
  try {
    const bytes = await render({ documentId, version, verifyCode, verifyUrl });
    const measure = await measureFile(bytes);
    if (measure.detectedMime !== "application/pdf") throw new IssueFailure("not_a_pdf");

    const file = await deps.files.reserve({
      orgId: input.orgId,
      purpose: "issued",
      name: input.fileName ?? `${input.kind}-v${version}.pdf`,
      mime: "application/pdf",
      bytes: measure.bytes,
      requestedBy: input.requestedBy ?? null,
    });
    if (!file.ok) throw new IssueFailure(file.code);
    stored = { fileId: file.fileId, storagePath: file.storagePath };

    await deps.files.put(file.storagePath, bytes, "application/pdf");
    const confirmed = await deps.files.confirm(file.fileId, measure);
    if (!confirmed.ok) throw new IssueFailure(confirmed.reason ?? confirmed.code);

    const published = await deps.documents.publish(documentId, claimToken, file.fileId);
    if (published.ok) return issued(false);
    // Another renderer published this version while this one worked (its
    // claim ran out): the version stands as that one issued it.
    if (published.code === "already_issued") {
      await takeBackFile(deps.files, file.fileId, file.storagePath);
      return issued(true);
    }
    throw new IssueFailure(published.code);
  } catch (error) {
    // The file of a render that did not get published is nobody's: forget it
    // and remove its bytes. The draft stays, so a retry resumes this version.
    // When the store's answer to the publish is what got lost, the file may be
    // the version's after all: the store then refuses to forget it, and its
    // bytes stay where they are (`takeBackFile`).
    if (stored) await takeBackFile(deps.files, stored.fileId, stored.storagePath);
    await deps.documents.release(documentId, claimToken).catch(() => undefined);
    return { kind: "failed", documentId, code: error instanceof IssueFailure ? error.code : "render_failed" };
  }
}
