"use server";

import { revalidatePath } from "next/cache";

import { isManager } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { isNoticeKind } from "@/lib/notices/notices";
import { settleNotices } from "@/lib/notices/work";
import { readWhatsAppSettings } from "@/lib/whatsapp/config";
import { syncAccountTemplates } from "@/lib/whatsapp/connect";
import { providerFor } from "@/lib/whatsapp/provider";
import { connectionRefusal } from "@/lib/whatsapp/session";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a person of the firm does with the notices to clients (migration
 * 0038): who manages the firm submits a kind's text to the vendor (the
 * database checks it and names the template, the vendor reviews it, ONE
 * keeps what it answered) and switches a kind on or off; anybody of the firm
 * records that somebody of a case agreed to be told, or that they asked to
 * stop. Never a support visit.
 */

export type NoticeActionResult = { ok: true; code: string } | { ok: false; code: string; field?: string | null };

const KNOWN_ERRORS = ["second_factor_required", "not_allowed_in_support_session", "not_authorized"] as const;
const raised = (message: string | null | undefined): string =>
  KNOWN_ERRORS.find((code) => (message ?? "").includes(code)) ?? "failed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AccountNumber = { provider: string; connection_id: string; phone_number_id: string; waba_id: string };

type Begun = {
  ok?: boolean;
  code?: string;
  field?: string | null;
  name?: string;
  language?: string;
  body?: string;
  footer?: string | null;
  examples?: unknown;
  number?: AccountNumber;
};

/** Every screen the notices show on, read again after a write. */
function revalidateNotices(caseId?: string) {
  revalidatePath("/settings/connections");
  revalidatePath("/inicio");
  revalidatePath("/agenda");
  if (caseId) revalidatePath(`/casos/${caseId}`);
}

const plain = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * The vendor refused the text, or did not answer: it may have the template
 * all the same (an earlier try it took and ONE never recorded, or a reply
 * that got lost). The account's templates are read again; one under this name
 * with this very text is the one submitted, with what the vendor decided of
 * it. One under this name with another text means the name is taken: the next
 * try takes a new number, now that ONE knows the name.
 */
async function templateAtVendor(
  service: SupabaseClient,
  firmId: string,
  number: AccountNumber,
  name: string,
  body: string,
): Promise<{ found: "same"; status: string; category: string } | { found: "other" } | null> {
  const synced = await syncAccountTemplates(service, await readWhatsAppSettings(service), {
    provider: number.provider,
    orgId: firmId,
    connectionId: number.connection_id,
    phoneNumberId: number.phone_number_id,
    wabaId: number.waba_id,
  });
  if (!synced.ok) return null;
  const { data } = await service
    .from("wa_templates")
    .select("body, status, category")
    .eq("org_id", firmId)
    .eq("waba_id", number.waba_id)
    .eq("name", name)
    .eq("language", "pt_BR")
    .maybeSingle();
  const row = data as { body: string | null; status: string; category: string } | null;
  if (!row) return null;
  return plain(row.body ?? "") === plain(body)
    ? { found: "same", status: row.status, category: row.category }
    : { found: "other" };
}

/**
 * Who manages the firm submits the text of a kind of notice to the firm's
 * account at the vendor. A kind that is off takes it, still off until the
 * vendor approves it and a person switches it on; a kind that is on keeps its
 * text in use until the vendor approves the new one, which then takes its
 * place by itself.
 */
export async function submitNoticeTemplate(kind: string, body: string): Promise<NoticeActionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  if (!isNoticeKind(kind) || typeof body !== "string") return { ok: false, code: "failed" };
  const refusal = await connectionRefusal(context);
  if (refusal) return { ok: false, code: refusal };

  const { data, error } = await context.supabase.rpc("begin_notice_template", {
    target_org: context.firm.id,
    target_kind: kind,
    target_body: body.slice(0, 2000),
  });
  if (error) return { ok: false, code: raised(error.message) };
  const begun = (data ?? {}) as Begun;
  if (!begun.ok || !begun.name || !begun.number || !begun.body) {
    return { ok: false, code: String(begun.code ?? "failed"), field: begun.field ?? null };
  }

  const service = createServiceClient();
  const access = await providerFor(
    {
      provider: begun.number.provider,
      orgId: context.firm.id,
      connectionId: begun.number.connection_id,
      phoneNumberId: begun.number.phone_number_id,
      wabaId: begun.number.waba_id,
    },
    await readWhatsAppSettings(service),
    "whatsapp.templates",
  );
  if (!access.ok) return { ok: false, code: access.code };
  const created = await access.provider.createTemplate({
    name: begun.name,
    language: begun.language ?? "pt_BR",
    category: "utility",
    body: begun.body,
    footer: begun.footer ?? null,
    examples: Array.isArray(begun.examples) ? begun.examples.map(String) : [],
  });
  let decided: { status: string; category: string };
  if (created.ok) {
    decided = { status: created.status, category: created.category };
  } else {
    const found = await templateAtVendor(service, context.firm.id, begun.number, begun.name, begun.body);
    if (found?.found === "other") return { ok: false, code: "name_taken" };
    if (!found) return { ok: false, code: created.code };
    decided = { status: found.status, category: found.category };
  }

  const { data: recorded, error: notRecorded } = await service.rpc("record_notice_template", {
    target_org: context.firm.id,
    target_kind: kind,
    target_waba: begun.number.waba_id,
    target_name: begun.name,
    target_status: decided.status,
    target_category: decided.category,
    target_body: begun.body,
    target_footer: begun.footer ?? null,
    target_by: context.userId,
  });
  const answer = (recorded ?? {}) as { ok?: boolean; waiting?: boolean };
  // The vendor has the template: sent again from here, it is found and recorded (`templateAtVendor`).
  if (notRecorded || !answer.ok) return { ok: false, code: "failed" };
  revalidateNotices();
  return { ok: true, code: answer.waiting ? "waiting" : "submitted" };
}

/** Who manages the firm switches a kind of notice on (its template approved) or off. */
export async function setNoticeKind(kind: string, enabled: boolean): Promise<NoticeActionResult> {
  const context = await getMemberContext();
  if (!context?.firm || !isManager(context.firm.role)) return { ok: false, code: "not_authorized" };
  if (!isNoticeKind(kind) || typeof enabled !== "boolean") return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("set_notice_kind", {
    target_org: context.firm.id,
    target_kind: kind,
    target_enabled: enabled,
  });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  if (answer.code === "on") await settleNotices();
  revalidateNotices();
  return { ok: true, code: String(answer.code ?? "on") };
}

/** Anybody of the firm records that somebody of a case agreed to be told on WhatsApp, saying how; or that they asked to stop. */
export async function recordNoticeOptin(input: {
  caseId: string;
  personId: string;
  agreed: boolean;
  note: string;
}): Promise<NoticeActionResult> {
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "not_authorized" };
  if (!UUID.test(String(input?.caseId)) || !UUID.test(String(input?.personId)))
    return { ok: false, code: "person_not_found" };
  if (typeof input.agreed !== "boolean" || typeof input.note !== "string") return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("record_notice_optin", {
    target_case: input.caseId,
    target_person: input.personId,
    target_agreed: input.agreed,
    target_note: input.note.slice(0, 500),
  });
  if (error) return { ok: false, code: raised(error.message) };
  const answer = (data ?? {}) as { ok?: boolean; code?: string; field?: string | null };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed"), field: answer.field ?? null };
  if (answer.code === "recorded") await settleNotices();
  revalidateNotices(input.caseId);
  return { ok: true, code: String(answer.code ?? "recorded") };
}
