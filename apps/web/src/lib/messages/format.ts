import { formatPrice } from "@flyee/billing/currency";
import { BRAND } from "@flyee/content";

/**
 * How a message says a date, an amount and an address. Pure: every e-mail and
 * bell notice takes these already formatted (packages/email/src/copy/pt-BR.ts),
 * so the reader's language and clock are decided here, once.
 */

export type MessageLocale = "pt-BR";

const MESSAGE_LOCALES: readonly MessageLocale[] = ["pt-BR"];

/** The language a profile or a list contact carries when messages are written in it, else Portuguese. */
export const toMessageLocale = (value: string | null | undefined): MessageLocale =>
  MESSAGE_LOCALES.find((locale) => locale === value) ?? "pt-BR";

/** The clock of a reader who never chose one: the platform's home time zone. */
export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/** A stored time zone that the runtime refuses falls back instead of throwing mid-job. */
function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** "2 de outubro de 2026", on the reader's own calendar day. */
export function dateLabel(value: string | Date, locale: MessageLocale, timeZone?: string | null): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: safeTimeZone(timeZone),
  }).format(new Date(value));
}

/**
 * "sexta-feira, 9 de outubro, 19:00 BRT": a moment on the reader's clock, with
 * the zone written out so the hour cannot be misread by someone who travels.
 */
export function dateTimeLabel(value: string | Date, locale: MessageLocale, timeZone?: string | null): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: safeTimeZone(timeZone),
    timeZoneName: "short",
  }).format(new Date(value));
}

/** "R$ 97": what was paid, without decimals when there are none. */
export function moneyLabel(amountCents: number, currency: string, locale: MessageLocale): string {
  return formatPrice(amountCents, currency, locale);
}

/**
 * A text stored per language (`{ "pt-BR": … }`) in the reader's language, then
 * in any language it was written in, then the fallback (a slug): a title
 * still names the thing when it was written in another language.
 */
export function localizedText(value: unknown, fallback: string, locale: MessageLocale): string {
  const texts = (value ?? {}) as Record<string, unknown>;
  for (const candidate of [texts[locale], ...Object.values(texts)]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

/** Whole days until a moment, rounded up and never below 1 ("1" reads as "within 24 hours"). */
export function wholeDaysLeft(until: string | Date, now: number = Date.now()): number {
  return Math.max(1, Math.ceil((new Date(until).getTime() - now) / 86_400_000));
}

/** The ISO week a moment falls in ("2026-W40"): the key of the things that happen once a week. */
export function isoWeekKey(now: number = Date.now()): string {
  const day = new Date(now);
  const date = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  // The ISO year of a week is the year of its Thursday.
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** An absolute address of the logged area for a link inside a message. */
export const memberUrl = (path: string): string => new URL(path, BRAND.siteUrl).toString();

/** Whose preference an unsubscribe link changes: a member's news, or a contact of the list. */
export type UnsubscribeKind = "member" | "lead";

/** The route behind every unsubscribe link and List-Unsubscribe header. */
export const UNSUBSCRIBE_PATH = "/api/public/email/unsubscribe";

/**
 * The one-click address that stops a kind of message for one reader. The same
 * address goes in the body and in the List-Unsubscribe header: a mail client
 * POSTs to it, a person follows it to a page that asks before acting.
 */
export function unsubscribeUrl(kind: UnsubscribeKind, token: string): string {
  const url = new URL(UNSUBSCRIBE_PATH, BRAND.siteUrl);
  url.searchParams.set("k", kind === "member" ? "m" : "l");
  url.searchParams.set("t", token);
  return url.toString();
}
