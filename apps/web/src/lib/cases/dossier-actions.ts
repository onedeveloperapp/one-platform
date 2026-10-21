"use server";

import { revalidatePath } from "next/cache";

import { buildDossier } from "@/lib/cases/dossier";
import { loadDossierFacts } from "@/lib/cases/dossier-work";
import { issueFirmDocument } from "@/lib/documents/issue";
import { downloadUrl } from "@/lib/files/uploads";
import { getMemberContext } from "@/lib/member/context";
import { createServiceClient } from "@flyee/auth/service";
import { stampVerification } from "@flyee/documents/stamp";
import { renderTextPdf } from "@flyee/documents/text-pdf";

/**
 * The dossier of a case (migration 0029): what the firm has on record that
 * shows the case is of a real person who knows of it, issued as a document
 * of the firm with a public verification code. A person of the firm asks
 * for it; it is written from what is on record at that moment, read under
 * that person's own session, and what is not on record is said as such.
 */

export type DossierResult<T extends object = object> = ({ ok: true; code: string } & T) | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const RAISED = ["not_allowed_in_support_session", "case_not_found", "not_authorized"] as const;
const raised = (message: string | null | undefined): string =>
  RAISED.find((code) => (message ?? "").includes(code)) ?? "failed";

/** A person asks for the dossier of a case: it is written and issued at once. */
export async function requestCaseDossier(caseId: string): Promise<DossierResult<{ dossierId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId)) return { ok: false, code: "case_not_found" };

  // Before anything is asked for: a machine with no backend writes no request it could never finish.
  let service: ReturnType<typeof createServiceClient>;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, code: "backend_not_configured" };
  }

  const { data, error } = await context.supabase.rpc("request_dossier", { target_case: caseId });
  if (error) return { ok: false, code: raised(error.message) };
  const asked = (data ?? {}) as { ok?: boolean; code?: string; dossier_id?: string };
  if (!asked.ok || !isId(asked.dossier_id)) return { ok: false, code: String(asked.code ?? "failed") };
  // One is being written right now (asked a moment ago): this request writes no other.
  if (asked.code === "in_course") return { ok: false, code: "in_course" };
  const dossierId = asked.dossier_id;

  const settle = async (documentId: string | null, summary: Record<string, number>, code: string | null) => {
    const { data: recorded, error: recordError } = await service.rpc("record_dossier", {
      target_dossier: dossierId,
      target_document: documentId,
      target_summary: summary,
      target_code: code,
    });
    return !recordError && Boolean((recorded as { ok?: boolean } | null)?.ok);
  };
  const failed = async (code: string): Promise<DossierResult<{ dossierId: string }>> => {
    await settle(null, {}, code).catch(() => false);
    revalidatePath(`/casos/${caseId}`);
    return { ok: false, code };
  };

  const firm = { id: context.firm.id, name: context.firm.name };
  let facts: Awaited<ReturnType<typeof loadDossierFacts>>;
  try {
    facts = await loadDossierFacts(context.supabase, firm, caseId);
  } catch {
    return failed("facts_unreadable");
  }
  if (!facts) return failed("case_not_found");

  const built = buildDossier(facts);
  const issue = () =>
    issueFirmDocument(
      {
        orgId: firm.id,
        kind: "dossie",
        title: built.title,
        // One per request: asked again, a dossier is another document, written from what is on record then.
        idempotencyKey: `dossie:${dossierId}`,
        requestedBy: context.userId,
        fileName: `${built.title}.pdf`,
      },
      async (render) =>
        stampVerification(
          await renderTextPdf({
            blocks: built.blocks,
            header: firm.name,
            pageNumbers: true,
            title: built.title,
            author: firm.name,
          }),
          { firm: firm.name, verifyCode: render.verifyCode, verifyUrl: render.verifyUrl },
        ),
    );
  // The same key answers the same document, so a try that failed on the way (the storage, the network) is
  // made once more before the dossier is given up: a second try never issues a second document.
  let issued = await issue().catch(() => null);
  if (issued?.kind !== "issued") issued = await issue().catch(() => null);
  if (!issued) return failed("failed");
  if (issued.kind !== "issued") return failed(issued.code);
  // The document exists from here on: the dossier that names it is recorded, and tried once more, before
  // it is said to have failed (the database takes it even for a request given up meanwhile).
  const recorded =
    (await settle(issued.documentId, built.summary, null).catch(() => false)) ||
    (await settle(issued.documentId, built.summary, null).catch(() => false));
  if (!recorded) {
    revalidatePath(`/casos/${caseId}`);
    return { ok: false, code: "not_recorded" };
  }

  revalidatePath(`/casos/${caseId}`);
  return { ok: true, code: "issued", dossierId };
}

/** A link of a minute to an issued dossier, read under the person's own session. */
export async function openCaseDossier(
  dossierId: string,
): Promise<{ ok: true; url: string } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(dossierId)) return { ok: false, code: "not_found" };
  const { data: dossier } = await context.supabase
    .from("dossiers")
    .select("id, status, issued_documents(file_id, title)")
    .eq("id", dossierId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  const issued = Array.isArray(dossier?.issued_documents) ? dossier?.issued_documents[0] : dossier?.issued_documents;
  if (!dossier || dossier.status !== "issued" || !issued?.file_id) return { ok: false, code: "not_found" };
  const link = await downloadUrl(context, issued.file_id as string, `${String(issued.title ?? "Dossiê")}.pdf`);
  return link.ok ? { ok: true, url: link.url } : { ok: false, code: link.code };
}
