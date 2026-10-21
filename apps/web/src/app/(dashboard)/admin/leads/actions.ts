"use server";

import { revalidatePath } from "next/cache";

import { LEAD_SOURCE_LABEL } from "@/lib/admin/labels";
import { loadLeads, resendCsv } from "@/lib/admin/leads";
import type { Localized } from "@/lib/admin/localized";
import {
  draftLanguages,
  draftPayload,
  NEWSLETTER_BODY_MAX,
  NEWSLETTER_LANGUAGE_LABEL,
  NEWSLETTER_LANGUAGES,
  NEWSLETTER_SUBJECT_MAX,
  type NewsletterLanguage,
} from "@/lib/admin/newsletter";
import { requireSuperadmin } from "@/lib/admin/session";
import { recordAudit } from "@/lib/audit";
import { startNewsletterDelivery } from "@/lib/newsletter-jobs";
import { createServiceClient } from "@flyee/auth/service";
import { isEmailConfigured } from "@flyee/email";

/**
 * What the leads console does to a contact (migration 0013): record an opt-out,
 * erase a contact (`purge_lead`, which removes the row AND its change history
 * and audits itself), and export the contacts the consent allows mailing. And
 * what it does to the list as a whole (migration 0023): write to everyone who
 * confirmed, each in their language.
 */

export type LeadActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stops every mailing to this address. Lifted only by the person confirming again from their inbox. */
export async function optOutLead(id: string): Promise<LeadActionResult> {
  if (!UUID.test(id)) return { ok: false, error: "Contato inválido." };
  const session = await requireSuperadmin();
  if (!session) return { ok: false, error: "Só quem tem o papel de superadmin muda os leads." };
  const { data, error } = await session.supabase
    .from("leads")
    .update({ opted_out_at: new Date().toISOString() })
    .eq("id", id)
    .is("opted_out_at", null)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Este contato já está descadastrado ou não existe mais." };
  // The id only: the address is personal data and the trail outlives an erasure.
  await recordAudit(session.supabase, "admin.leads.opted_out", { entityType: "lead", entityId: id });
  revalidatePath("/admin/leads");
  return { ok: true, data: null };
}

const PURGE_REFUSAL: Record<string, string> = {
  not_authorized: "Só quem tem o papel de superadmin apaga contatos, e nunca de dentro de uma sessão de suporte.",
  not_found: "Este contato não existe mais.",
};

/** Erases the contact and every version of it. Irreversible. */
export async function purgeLead(id: string, reason: string): Promise<LeadActionResult> {
  if (!UUID.test(id)) return { ok: false, error: "Contato inválido." };
  const session = await requireSuperadmin();
  if (!session) return { ok: false, error: PURGE_REFUSAL.not_authorized };
  const { data, error } = await session.supabase.rpc("purge_lead", { target_lead: id, target_reason: reason.trim() });
  if (error) return { ok: false, error: error.message };
  const result = (data ?? {}) as { ok?: boolean; code?: string };
  if (!result.ok) return { ok: false, error: PURGE_REFUSAL[result.code ?? ""] ?? "Não foi possível apagar." };
  revalidatePath("/admin/leads");
  return { ok: true, data: null };
}

/**
 * The CSV of contacts that may be mailed, read fresh from the database and
 * audited with its size: an export of personal data leaves a trace of who took
 * it and when.
 */
export async function exportSubscribedLeads(): Promise<LeadActionResult<{ csv: string; count: number }>> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, error: "Só quem tem o papel de superadmin exporta contatos." };
  let leads;
  try {
    leads = await loadLeads(session.supabase);
  } catch {
    return { ok: false, error: "Não foi possível ler os contatos agora." };
  }
  const exported = resendCsv(leads);
  await recordAudit(session.supabase, "admin.leads.exported", {
    entityType: "lead",
    metadata: { count: exported.count, format: "resend_csv" },
  });
  return { ok: true, data: exported };
}

const NOT_OPERATOR = "Só quem tem o papel de superadmin escreve para a lista.";
const NO_PROVIDER = "O envio de e-mails não está configurado neste ambiente (RESEND_API_KEY).";

const isSource = (value: string | null): boolean => value === null || Object.hasOwn(LEAD_SOURCE_LABEL, value);

/** A draft the database would refuse, said before it is sent; null when it is fine. */
function draftProblem(subject: Localized, body: Localized): string | null {
  const { ready, incomplete } = draftLanguages(subject, body);
  if (incomplete.length > 0) {
    return `Em ${NEWSLETTER_LANGUAGE_LABEL[incomplete[0]]} falta o assunto ou o texto. Escreva os dois, ou deixe os dois vazios para não enviar nesse idioma.`;
  }
  if (ready.length === 0) return "Escreva o assunto e o texto em pelo menos um idioma.";
  for (const language of ready) {
    if ((subject[language] ?? "").trim().length > NEWSLETTER_SUBJECT_MAX) {
      return `O assunto em ${NEWSLETTER_LANGUAGE_LABEL[language]} passa de ${NEWSLETTER_SUBJECT_MAX} caracteres.`;
    }
    if ((body[language] ?? "").trim().length > NEWSLETTER_BODY_MAX) {
      return `O texto em ${NEWSLETTER_LANGUAGE_LABEL[language]} passa de ${NEWSLETTER_BODY_MAX} caracteres.`;
    }
  }
  return null;
}

export type NewsletterDraft = { subject: Localized; body: Localized; source: string | null };

/**
 * Who a draft would reach right now: confirmed contacts who did not leave, in
 * the languages the draft is written in (`newsletter_audience`). The count is
 * read again by the database when the send starts; this is what the operator
 * sees before pressing the button.
 */
export async function previewNewsletter(
  draft: NewsletterDraft,
): Promise<LeadActionResult<{ readers: Record<NewsletterLanguage, number>; total: number }>> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, error: NOT_OPERATOR };
  if (!isSource(draft.source)) return { ok: false, error: "Origem inválida." };
  const problem = draftProblem(draft.subject, draft.body);
  if (problem) return { ok: false, error: problem };

  const { ready } = draftLanguages(draft.subject, draft.body);
  const { data, error } = await session.supabase.rpc("newsletter_audience", {
    target_languages: ready,
    target_source: draft.source,
  });
  if (error) return { ok: false, error: "Não foi possível contar quem recebe agora." };
  const readers = Object.fromEntries(NEWSLETTER_LANGUAGES.map((language) => [language, 0])) as Record<
    NewsletterLanguage,
    number
  >;
  for (const row of (data ?? []) as { locale: string; readers: number }[]) {
    const language = NEWSLETTER_LANGUAGES.find((candidate) => candidate === row.locale);
    if (language) readers[language] = Number(row.readers ?? 0);
  }
  return { ok: true, data: { readers, total: Object.values(readers).reduce((sum, count) => sum + count, 0) } };
}

const CREATE_REFUSAL: Record<string, string> = {
  incomplete_language: "Um dos idiomas está pela metade: escreva o assunto e o texto, ou deixe os dois vazios.",
  too_long: "O assunto ou o texto passou do tamanho permitido.",
  not_allowed_in_support_session: "Uma sessão de suporte não escreve para a lista.",
  not_authorized: NOT_OPERATOR,
};

/**
 * Writes to the confirmed list. The send is recorded first
 * (`create_newsletter_send`, which audits itself) and delivered after the
 * answer: in batches, each reader once, in their language, with their own
 * unsubscribe address (lib/newsletter.ts).
 */
export async function sendNewsletter(draft: NewsletterDraft): Promise<LeadActionResult<{ queued: boolean }>> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, error: NOT_OPERATOR };
  if (!isEmailConfigured) return { ok: false, error: NO_PROVIDER };
  if (!isSource(draft.source)) return { ok: false, error: "Origem inválida." };
  const problem = draftProblem(draft.subject, draft.body);
  if (problem) return { ok: false, error: problem };

  const payload = draftPayload(draft.subject, draft.body);
  const { data, error } = await session.supabase.rpc("create_newsletter_send", {
    target_subject: payload.subject,
    target_body_md: payload.body,
    target_source: draft.source,
  });
  if (error || !data) {
    const code = Object.keys(CREATE_REFUSAL).find((key) => error?.message.includes(key));
    return { ok: false, error: (code && CREATE_REFUSAL[code]) || "Não foi possível registrar o envio." };
  }

  const started = await startNewsletterDelivery(data as string);
  revalidatePath("/admin/leads");
  return { ok: true, data: started };
}

/**
 * Continues a send that stopped: the provider refused a batch, or the delivery
 * ran out of time. Only readers who have not been written to are left, so
 * resuming never repeats a message.
 */
export async function resumeNewsletter(id: string): Promise<LeadActionResult<{ queued: boolean }>> {
  if (!UUID.test(id)) return { ok: false, error: "Envio inválido." };
  const session = await requireSuperadmin();
  if (!session) return { ok: false, error: NOT_OPERATOR };
  if (!isEmailConfigured) return { ok: false, error: NO_PROVIDER };

  const { data: send, error } = await session.supabase
    .from("newsletter_sends")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: "Não foi possível ler o envio agora." };
  if (!send) return { ok: false, error: "Este envio não existe mais." };
  if (send.status === "sent") return { ok: false, error: "Este envio já terminou." };

  if (send.status === "failed") {
    // The table is written by the delivery only (no session can change it):
    // reopening a stopped send is the one edit the console makes, as the backend.
    const { error: reopenError } = await createServiceClient()
      .from("newsletter_sends")
      .update({ status: "sending", last_error: null, finished_at: null })
      .eq("id", id)
      .eq("status", "failed");
    if (reopenError) return { ok: false, error: "Não foi possível reabrir o envio." };
  }
  await recordAudit(session.supabase, "admin.newsletter.resumed", { entityType: "newsletter_send", entityId: id });

  const started = await startNewsletterDelivery(id);
  revalidatePath("/admin/leads");
  return { ok: true, data: started };
}
