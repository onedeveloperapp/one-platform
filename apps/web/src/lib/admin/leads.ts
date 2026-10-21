import { fetchAllPages } from "@/lib/fetch-all-pages";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the leads console reads (migration 0010): people without an account,
 * from the waitlist and the newsletter. The confirmation token hash and the
 * unsubscribe token are never selected: the console has no use for either.
 */

export type AdminLead = {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  source: string;
  origem: string | null;
  onda: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  consentVersion: number | null;
  consentAcceptedAt: string | null;
  confirmSentAt: string | null;
  confirmedAt: string | null;
  optedOutAt: string | null;
  createdAt: string;
};

export type LeadStatus = "subscribed" | "pending" | "opted_out";

/** Opted out wins over everything; an address that never confirmed receives nothing but the confirmation. */
export const leadStatus = (lead: Pick<AdminLead, "confirmedAt" | "optedOutAt">): LeadStatus =>
  lead.optedOutAt ? "opted_out" : lead.confirmedAt ? "subscribed" : "pending";

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  subscribed: "confirmado",
  pending: "aguardando confirmação",
  opted_out: "descadastrado",
};

const COLUMNS =
  "id, email, name, locale, source, origem, onda, utm_source, utm_campaign, consent_term_version, consent_accepted_at, confirm_sent_at, confirmed_at, opted_out_at, created_at";

type LeadRow = {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  source: string;
  origem: string | null;
  onda: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  consent_term_version: number | null;
  consent_accepted_at: string | null;
  confirm_sent_at: string | null;
  confirmed_at: string | null;
  opted_out_at: string | null;
  created_at: string;
};

const toLead = (row: LeadRow): AdminLead => ({
  id: row.id,
  email: row.email,
  name: row.name,
  locale: row.locale,
  source: row.source,
  origem: row.origem,
  onda: row.onda,
  utmSource: row.utm_source,
  utmCampaign: row.utm_campaign,
  consentVersion: row.consent_term_version,
  consentAcceptedAt: row.consent_accepted_at,
  confirmSentAt: row.confirm_sent_at,
  confirmedAt: row.confirmed_at,
  optedOutAt: row.opted_out_at,
  createdAt: row.created_at,
});

/** Every lead, newest first, paged past PostgREST's row cap. */
export async function loadLeads(supabase: SupabaseClient): Promise<AdminLead[]> {
  const { data, error } = await fetchAllPages<LeadRow>((from, to) =>
    supabase.from("leads").select(COLUMNS).order("created_at", { ascending: false }).order("id").range(from, to),
  );
  if (error) throw new Error("leads_failed");
  return data.map(toLead);
}

/**
 * One CSV field, quoted when it has to be. Free text that a spreadsheet would
 * run as a formula is neutralised; an e-mail address is left exactly as it is,
 * because the importer has to read it back.
 */
export function csvField(value: string | null | undefined, freeText = true): string {
  let text = value ?? "";
  if (freeText && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The contacts the newsletter consent allows mailing: confirmed and not opted
 * out, in the column names Resend's contact import reads (`email`,
 * `first_name`) plus the language and where the address came from.
 */
export function resendCsv(leads: AdminLead[]): { csv: string; count: number } {
  const rows = leads.filter((lead) => leadStatus(lead) === "subscribed");
  const header = ["email", "first_name", "language", "source", "confirmed_at"];
  const lines = rows.map((lead) =>
    [lead.email, lead.name?.trim().split(/\s+/)[0] ?? "", lead.locale, lead.source, lead.confirmedAt ?? ""]
      .map((field, index) => csvField(field, index !== 0))
      .join(","),
  );
  return { csv: `${[header.join(","), ...lines].join("\n")}\n`, count: rows.length };
}
