import { type LocaleOption, LOCALES } from "@/constants";
import type { Localized } from "@/lib/admin/localized";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the leads console reads and checks about messages to the confirmed
 * list (`newsletter_sends`, migration 0023). A send is written per language;
 * a language left empty is simply not sent.
 */

export const NEWSLETTER_LANGUAGES = LOCALES;
export type NewsletterLanguage = LocaleOption;

export const NEWSLETTER_LANGUAGE_LABEL: Record<NewsletterLanguage, string> = {
  "pt-BR": "português",
};

export type NewsletterStatus = "queued" | "sending" | "sent" | "failed";

export const NEWSLETTER_STATUS_LABEL: Record<NewsletterStatus, string> = {
  queued: "na fila",
  sending: "enviando",
  sent: "enviado",
  failed: "interrompido",
};

export type NewsletterSend = {
  id: string;
  subject: Localized;
  source: string | null;
  status: NewsletterStatus;
  delivered: number;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
};

/** The limits `create_newsletter_send` enforces, so the form can say it first. */
export const NEWSLETTER_SUBJECT_MAX = 150;
export const NEWSLETTER_BODY_MAX = 20_000;

/**
 * Which languages of a draft are ready to send (subject and text written) and
 * which are half written (one without the other): a half-written language is
 * a mistake to point out, an empty one is a choice.
 */
export function draftLanguages(
  subject: Localized,
  body: Localized,
): { ready: NewsletterLanguage[]; incomplete: NewsletterLanguage[] } {
  const ready: NewsletterLanguage[] = [];
  const incomplete: NewsletterLanguage[] = [];
  for (const language of NEWSLETTER_LANGUAGES) {
    const hasSubject = Boolean(subject[language]?.trim());
    const hasBody = Boolean(body[language]?.trim());
    if (hasSubject && hasBody) ready.push(language);
    else if (hasSubject || hasBody) incomplete.push(language);
  }
  return { ready, incomplete };
}

/** The draft as the database stores it: only the complete languages, trimmed. */
export function draftPayload(subject: Localized, body: Localized): { subject: Localized; body: Localized } {
  const { ready } = draftLanguages(subject, body);
  return {
    subject: Object.fromEntries(ready.map((language) => [language, (subject[language] ?? "").trim()])),
    body: Object.fromEntries(ready.map((language) => [language, (body[language] ?? "").trim()])),
  };
}

/** The latest sends, newest first. */
export async function loadNewsletterSends(supabase: SupabaseClient): Promise<NewsletterSend[]> {
  const { data, error } = await supabase
    .from("newsletter_sends")
    .select("id, subject, source, status, delivered, last_error, created_at, finished_at")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error("newsletter_sends_failed");
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id as string,
    subject: (row.subject as Localized) ?? {},
    source: (row.source as string | null) ?? null,
    status: row.status as NewsletterStatus,
    delivered: Number(row.delivered ?? 0),
    lastError: (row.last_error as string | null) ?? null,
    createdAt: row.created_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
  }));
}
