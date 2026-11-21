"use server";

import { revalidatePath } from "next/cache";
import { createHash, randomInt } from "node:crypto";

import { getVault } from "@/lib/connections/vault";
import { downloadUrl } from "@/lib/files/uploads";
import { loginHint } from "@/lib/filing-ways/hint";
import { getMemberContext } from "@/lib/member/context";
import { connectionRefusal } from "@/lib/whatsapp/session";

/**
 * What the firm and each lawyer do with the ways to file on a court's screen (the owner, 2026-11-20; migrations 0263
 * and 0264): the firm's way, the lawyer's way at a system, the lawyer's court login handed to ONE (sealed in the vault
 * in this very request: it never waits in the clear, never goes to a log or an error), the extension linked by a
 * code, a batch approved, a filing confirmed while ONE learns the system, the code a court asked, and a batch stopped.
 * The database decides who may; nothing here trusts an id it is handed beyond asking the database about it, and each
 * function of the database records its own audit event.
 */

export type WayActionResult = { ok: true; code: string; value?: string } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYSTEM = /^[a-z][a-z0-9-]{2,39}$/;
const WAYS = ["browser", "extension", "hand"] as const;
type Way = (typeof WAYS)[number];

/** The codes a function of the database raises, by the name the screen has words for. */
const raisedCode = (message: string | undefined): string =>
  ["second_factor_required", "impersonated", "not_allowed_in_support_session", "not_authorized", "not_a_lawyer"].find(
    (code) => (message ?? "").includes(code),
  ) ?? "failed";

const answerOf = (data: unknown): { ok?: boolean; code?: string } & Record<string, unknown> =>
  (data ?? {}) as { ok?: boolean; code?: string } & Record<string, unknown>;

function revalidate(): void {
  revalidatePath("/configurar");
  revalidatePath("/settings/connections");
  revalidatePath("/protocolo");
}

/** Who decides for the firm sets its way, with the firm's acknowledgment for an automated one. */
export async function setFirmFilingWay(way: Way, termId: string | null): Promise<WayActionResult> {
  if (!WAYS.includes(way) || (termId !== null && !UUID.test(termId))) return { ok: false, code: "invalid_data" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("set_firm_filing_way", {
    target_org: context.firm.id,
    target_way: way,
    target_term: termId,
  });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = answerOf(data);
  revalidate();
  return answer.ok ? { ok: true, code: String(answer.code) } : { ok: false, code: String(answer.code ?? "failed") };
}

/** The lawyer's own way at a system, with their own acknowledgment for an automated one. */
export async function setLawyerFilingWay(system: string, way: Way, termId: string | null): Promise<WayActionResult> {
  if (!SYSTEM.test(system) || !WAYS.includes(way) || (termId !== null && !UUID.test(termId))) {
    return { ok: false, code: "invalid_data" };
  }
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("set_lawyer_filing_way", {
    target_org: context.firm.id,
    target_system: system,
    target_way: way,
    target_term: termId,
  });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = answerOf(data);
  revalidate();
  return answer.ok ? { ok: true, code: String(answer.code) } : { ok: false, code: String(answer.code ?? "failed") };
}

/**
 * The lawyer hands ONE their login at a system, for ONE's own browser: the connection begun in the database, the
 * login and the password sealed in the vault in the same request.
 */
export async function giveCourtLogin(system: string, login: string, senha: string): Promise<WayActionResult> {
  if (!SYSTEM.test(system) || typeof login !== "string" || typeof senha !== "string") {
    return { ok: false, code: "invalid_data" };
  }
  if (login.trim().length === 0 || senha.length === 0) return { ok: false, code: "empty" };
  const access = getVault();
  if (!access.ok) return { ok: false, code: "vault_not_configured" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };

  const { data, error } = await context.supabase.rpc("begin_court_login", {
    target_org: context.firm.id,
    target_system: system,
    target_hint: loginHint(login),
  });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const begun = answerOf(data);
  const connectionId = typeof begun.connection_id === "string" ? begun.connection_id : null;
  if (!begun.ok || !connectionId) return { ok: false, code: String(begun.code ?? "failed") };

  const sealed = await access.vault.sealLawyerCourtLogin({ orgId: context.firm.id, connectionId }, { login, senha });
  revalidate();
  return sealed.kind === "sealed" ? { ok: true, code: "sealed" } : { ok: false, code: sealed.code };
}

/** The lawyer, a partner or who manages the firm takes a court login out of ONE. */
export async function endCourtLogin(connectionId: string): Promise<WayActionResult> {
  if (!UUID.test(connectionId)) return { ok: false, code: "invalid_data" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("end_court_login", { target_connection: connectionId });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = answerOf(data);
  revalidate();
  return answer.ok ? { ok: true, code: String(answer.code) } : { ok: false, code: String(answer.code ?? "failed") };
}

/** The letters of a link code: no 0, O, 1, I or L, which a person misreads. */
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** The lawyer asks to link their extension: the code to type in it, valid ten minutes; its hash alone is kept. */
export async function beginExtensionLink(): Promise<WayActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };
  const code = Array.from({ length: 7 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
  const { data, error } = await context.supabase.rpc("begin_extension_link", {
    target_org: context.firm.id,
    target_code_hash: createHash("sha256").update(code, "utf8").digest("hex"),
  });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = answerOf(data);
  revalidate();
  return answer.ok ? { ok: true, code: "begun", value: code } : { ok: false, code: String(answer.code ?? "failed") };
}

/** Ends an extension's link: the lawyer's own, or, for a partner or who manages the firm, a colleague's. */
export async function endExtensionLink(linkId: string): Promise<WayActionResult> {
  if (!UUID.test(linkId)) return { ok: false, code: "invalid_data" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("end_extension_link", { target_link: linkId });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = answerOf(data);
  revalidate();
  return answer.ok ? { ok: true, code: String(answer.code) } : { ok: false, code: String(answer.code ?? "failed") };
}

/** The lawyer approves a batch: packages of lawsuits they sign, at one system, by their way there. */
export async function approveFilingBatch(
  system: string,
  packageIds: string[],
): Promise<WayActionResult & { skipped?: { package: string; code: string }[]; learning?: boolean }> {
  if (!SYSTEM.test(system) || !Array.isArray(packageIds) || packageIds.length === 0 || packageIds.length > 50) {
    return { ok: false, code: "invalid_data" };
  }
  if (!packageIds.every((id) => typeof id === "string" && UUID.test(id))) return { ok: false, code: "invalid_data" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("approve_filing_batch", {
    target_org: context.firm.id,
    target_system: system,
    target_packages: packageIds,
  });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = answerOf(data);
  const skipped = Array.isArray(answer.skipped) ? (answer.skipped as { package: string; code: string }[]) : [];
  revalidate();
  return answer.ok
    ? {
        ok: true,
        code: String(answer.code),
        value: String(answer.batch_id ?? ""),
        skipped,
        learning: answer.learning === true,
      }
    : { ok: false, code: String(answer.code ?? "failed"), skipped };
}

/** The lawyer of a batch confirms, in ONE, a filing ONE files while it learns the system. */
export async function confirmFilingSubmission(submissionId: string): Promise<WayActionResult> {
  if (!UUID.test(submissionId)) return { ok: false, code: "invalid_data" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("confirm_filing_submission", { target_submission: submissionId });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = answerOf(data);
  revalidate();
  return answer.ok ? { ok: true, code: String(answer.code) } : { ok: false, code: String(answer.code ?? "failed") };
}

/** The lawyer of a batch gives the code the court asked: sealed here to that batch, never kept in the clear. */
export async function giveBatchCode(batchId: string, code: string): Promise<WayActionResult> {
  if (!UUID.test(batchId) || typeof code !== "string") return { ok: false, code: "invalid_data" };
  const access = getVault();
  if (!access.ok) return { ok: false, code: "vault_not_configured" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const sealed = access.vault.sealBatchCode(context.firm.id, batchId, code);
  if (sealed.kind !== "sealed") return { ok: false, code: sealed.code };
  const { data, error } = await context.supabase.rpc("give_filing_batch_code", {
    target_batch: batchId,
    target_key_version: sealed.envelope.keyVersion,
    target_iv: sealed.envelope.iv,
    target_ciphertext: sealed.envelope.ciphertext,
    target_tag: sealed.envelope.tag,
  });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = answerOf(data);
  return answer.ok ? { ok: true, code: String(answer.code) } : { ok: false, code: String(answer.code ?? "failed") };
}

/** The lawyer, a partner or who manages the firm stops a batch: what never went is let go. */
export async function stopFilingBatch(batchId: string): Promise<WayActionResult> {
  if (!UUID.test(batchId)) return { ok: false, code: "invalid_data" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase.rpc("stop_filing_batch", {
    target_batch: batchId,
    target_error: null,
  });
  if (error) return { ok: false, code: raisedCode(error.message) };
  const answer = answerOf(data);
  revalidate();
  return answer.ok ? { ok: true, code: String(answer.code) } : { ok: false, code: String(answer.code ?? "failed") };
}

/**
 * The screen of the court ONE kept when it stopped before the first filing in a system (0264, `summary_file_id`), as
 * a short link: read with the person's own session, so another firm's is not found.
 */
export async function openBatchSummary(submissionId: string): Promise<WayActionResult> {
  if (!UUID.test(submissionId)) return { ok: false, code: "invalid_data" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  const { data, error } = await context.supabase
    .from("filing_submissions")
    .select("summary_file_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (error || !data?.summary_file_id) return { ok: false, code: "not_found" };
  const link = await downloadUrl(context, data.summary_file_id as string);
  return link.ok ? { ok: true, code: "link", value: link.url } : { ok: false, code: link.code };
}
