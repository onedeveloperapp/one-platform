"use server";

import { revalidatePath } from "next/cache";

import { cnjDigits } from "@/lib/cases/filing";
import { queueFilingPackage } from "@/lib/cases/filing-work";
import { queuePackageSignature } from "@/lib/cases/package-signature-work";
import { discardUpload, downloadUrl, finishUpload } from "@/lib/files/uploads";
import { getMemberContext } from "@/lib/member/context";
import { isSupportVisit } from "@/lib/whatsapp/session";

/**
 * What a person of the firm does with the filing package of a lawsuit
 * (migration 0027): ask for it, give it up, download its files in their
 * order and attach the receipt the court's system gave. Every write is a
 * function of the database; these actions carry the request and turn the
 * answer into a code the screen has words for. ONE files nothing: the lawyer
 * files in the court's own system.
 */

export type FilingResult<T extends object = object> =
  | ({ ok: true; code: string } & T)
  | { ok: false; code: string; field?: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isId = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const KNOWN_ERRORS = ["not_allowed_in_support_session", "not_authorized", "case_not_found"] as const;
const raised = (message: string | null | undefined): string =>
  KNOWN_ERRORS.find((code) => (message ?? "").includes(code)) ?? "failed";

type RpcAnswer = { ok?: boolean; code?: string; field?: string | null } & Record<string, unknown>;

function fold<T extends object>(
  data: unknown,
  error: { message: string } | null,
  pick: (answer: RpcAnswer) => T,
): FilingResult<T> {
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as RpcAnswer;
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
  return { ok: true, code: String(answer.code ?? "saved"), ...pick(answer) };
}

const refresh = (caseId: string) => {
  revalidatePath(`/casos/${caseId}`);
  revalidatePath("/protocolo");
  revalidatePath("/inicio");
};

/** A person asks for the package of a lawsuit: the petition and the documents that go with it. */
export async function requestFilingPackage(input: {
  caseId: string;
  proceedingId: string;
  petitionId: string;
  documentIds: string[];
}): Promise<FilingResult<{ packageId: string }>> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.proceedingId))
    return { ok: false, code: "case_not_found" };
  if (!isId(input.petitionId)) return { ok: false, code: "petition_not_found", field: "petition" };
  const { data, error } = await context.supabase.rpc("request_filing_package", {
    target_proceeding: input.proceedingId,
    target_petition: input.petitionId,
    target_documents: (Array.isArray(input.documentIds) ? input.documentIds : []).filter(isId).slice(0, 200),
  });
  const result = fold(data, error, (answer) => ({ packageId: String(answer.package_id ?? "") }));
  if (result.ok) {
    refresh(input.caseId);
    if (isId(result.packageId)) await queueFilingPackage(result.packageId);
  }
  return result;
}

/** A person gives up the package in course of a lawsuit. */
export async function cancelFilingPackage(caseId: string, packageId: string): Promise<FilingResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(packageId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("cancel_filing_package", { target_package: packageId });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh(caseId);
  return result;
}

/**
 * A link of a minute to one file of a package, under the name the package
 * gave it: what the lawyer attaches in the court's system, in order. The
 * item is read under the person's own session (a package of another firm is
 * not found). The `.p7s` ONE signed of a file (0042) goes only to the lawyer
 * whose certificate signed it, as the database says (`filing_signed_file`),
 * under the name a court's signer gives one: the PDF's, then `.p7s`.
 */
export async function openFilingFile(
  itemId: string,
  signed = false,
): Promise<{ ok: true; url: string } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(itemId)) return { ok: false, code: "not_found" };
  if (signed) {
    const { data, error } = await context.supabase.rpc("filing_signed_file", { target_item: itemId });
    if (error) return { ok: false, code: "unavailable" };
    const answer = (data ?? {}) as { ok?: boolean; code?: string; file_id?: string; name?: string };
    if (!answer.ok || !isId(answer.file_id)) return { ok: false, code: String(answer.code ?? "not_found") };
    const link = await downloadUrl(context, answer.file_id, `${String(answer.name ?? "arquivo")}.p7s`, {
      signedCopy: true,
    });
    return link.ok ? { ok: true, url: link.url } : { ok: false, code: link.code };
  }
  const { data: item } = await context.supabase
    .from("filing_package_items")
    .select("id, name, file_id")
    .eq("id", itemId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!item) return { ok: false, code: "not_found" };
  const link = await downloadUrl(context, item.file_id as string, item.name as string);
  return link.ok ? { ok: true, url: link.url } : { ok: false, code: link.code };
}

/**
 * A lawyer of the lawsuit asks ONE to sign the package's files with their own
 * authorization in the cloud, and nobody else's (migration 0042): where the
 * firm keeps it to a person, after ONE waited or gave up, or to file it
 * themself when another lawyer signed the files. The jobs sign it at once.
 */
export async function requestPackageSignature(caseId: string, packageId: string): Promise<FilingResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(caseId) || !isId(packageId)) return { ok: false, code: "not_found" };
  const { data, error } = await context.supabase.rpc("request_package_signature", { target_package: packageId });
  if (error && (error.message ?? "").includes("second_factor_required"))
    return { ok: false, code: "second_factor_required" };
  const result = fold(data, error, () => ({}));
  if (result.ok) {
    refresh(caseId);
    if (result.code === "requested") await queuePackageSignature(packageId);
  }
  return result;
}

/**
 * A lawyer attaches the receipt the court's system gave (a file they just
 * uploaded with `startCaseUpload`), with the case number and the day: the
 * backend measures the file, and the database marks the lawsuit as filed.
 */
export async function attachFilingReceipt(input: {
  caseId: string;
  packageId: string;
  fileId: string;
  cnj: string;
  filedOn: string;
}): Promise<FilingResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(input?.caseId) || !isId(input?.packageId)) return { ok: false, code: "not_found" };
  if (!isId(input.fileId)) return { ok: false, code: "file_not_found", field: "file" };
  const cnj = cnjDigits(String(input.cnj ?? ""));
  if (!cnj) return { ok: false, code: "invalid_cnj", field: "cnj" };
  if (!DAY.test(String(input.filedOn ?? ""))) return { ok: false, code: "invalid_date", field: "filed_on" };

  const finished = await finishUpload(context, input.fileId);
  if (!finished.ok) return { ok: false, code: finished.code };
  const { data, error } = await context.supabase.rpc("attach_filing_receipt", {
    target_package: input.packageId,
    target_file: input.fileId,
    target_cnj: cnj,
    target_filed_on: input.filedOn,
  });
  const result = fold(data, error, () => ({}));
  if (result.ok) refresh(input.caseId);
  // A receipt this request has just measured and that found no place is taken back.
  else if (finished.measured && !(await isSupportVisit())) await discardUpload(context, input.fileId);
  return result;
}

/** A link of a minute to the receipt of a filed package. */
export async function openFilingReceipt(
  receiptId: string,
): Promise<{ ok: true; url: string } | { ok: false; code: string }> {
  const context = await getMemberContext();
  if (!context?.firm || !isId(receiptId)) return { ok: false, code: "not_found" };
  const { data: receipt } = await context.supabase
    .from("filing_receipts")
    .select("id, file_id")
    .eq("id", receiptId)
    .eq("org_id", context.firm.id)
    .maybeSingle();
  if (!receipt) return { ok: false, code: "not_found" };
  const link = await downloadUrl(context, receipt.file_id as string);
  return link.ok ? { ok: true, url: link.url } : { ok: false, code: link.code };
}
