import { type SendError, SERVICE_WINDOW_MS } from "@flyee/whatsapp/types";

/**
 * The pure rules of WhatsApp that a screen needs before the database is
 * asked: whether the 24-hour window is open, what a template says once its
 * values are in place, and whether a template is fit to be submitted.
 *
 * The database decides every send (`reserve_wa_send`, migration 0019); what
 * is here lets a screen say the same thing before the person clicks.
 */

/** True while free text may be sent: within the window after the person's last message. */
export function isWindowOpen(
  lastInboundAt: Date | string | null | undefined,
  now: number = Date.now(),
  windowMs: number = SERVICE_WINDOW_MS,
): boolean {
  if (!lastInboundAt) return false;
  const opened = new Date(lastInboundAt).getTime();
  return Number.isFinite(opened) && now - opened < windowMs;
}

/**
 * The one code recorded for a message that did not go out (`wa_messages.error_code`):
 * the reason when it has a name of its own, and the vendor's code when all
 * that is known is that it was refused.
 */
export const failureCodeOf = (error: SendError, detail?: string): string =>
  error === "rejected" && detail ? detail : error;

const PLACEHOLDER = /\{\{\s*(\d{1,2})\s*\}\}/g;

/** The numbers of the placeholders a text carries, in the order they appear: `{{1}}`, `{{2}}`. */
export const placeholdersOf = (body: string): number[] =>
  [...body.matchAll(PLACEHOLDER)].map((match) => Number(match[1]));

/** How many values a text asks for: its distinct placeholders. */
export const paramCountOf = (body: string): number => new Set(placeholdersOf(body)).size;

/** The text as the person will read it, with each value in its place. A missing value leaves its placeholder. */
export const renderTemplate = (body: string, params: readonly string[]): string =>
  body.replace(PLACEHOLDER, (whole, number: string) => params[Number(number) - 1] ?? whole);

export interface TemplateDraft {
  name: string;
  /** `marketing`, `utility` or `authentication`. */
  category: string;
  body: string;
  headerText?: string | null;
  footerText?: string | null;
}

/**
 * What a check found in a template. An `error` is a limit of the vendor: the
 * template would be refused. A `warning` is for the lawyer to weigh: ONE
 * points at it and decides nothing.
 */
export type TemplateFinding = { code: string; severity: "error" | "warning" };

const CATEGORIES = ["marketing", "utility", "authentication"];

/** The text of a template without accents, lower case, for looking words up. */
const plain = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * Words that promise a result. The rules of the bar on advertising (CFOAB,
 * Provimento 205/2021) forbid promising one; whether a given sentence does is
 * for the lawyer to say, so this is a warning and never a refusal.
 */
const PROMISES_RESULT =
  /\b(garantid[oa]s?|garantimos|garantia de|causa ganha|ganho certo|vitoria certa|com certeza (voce )?(recebe|ganha))\b|\b100\s?%/;

/**
 * Fees, gratuity or discounts used to attract a client, which the same rules
 * restrict. Again a warning: a message to somebody who is already a client
 * may well speak of fees.
 */
const SPEAKS_OF_PRICE = /\b(gratis|gratuit[oa]s?|sem custo|nao cobramos|desconto|promocao|honorarios?)\b/;

/** Words that press the person to decide now, which the same rules count as soliciting. */
const PRESSES =
  /\b(so hoje|somente hoje|ultima chance|ultimas vagas|vagas limitadas|por tempo limitado|corra|nao perca|aproveite)\b/;

export type MessageFinding = "promises_result" | "speaks_of_price" | "presses";

/**
 * What a message to a person says that the bar's rules on advertising weigh (CFOAB, Provimento 205/2021): a promise
 * of a result, a price, a fee, a gratuity or a discount, and pressure to decide now (`publicidade-v1`). A rule of
 * words: it says what to look at, and decides nothing by itself; ONE never sends an answer of its own that it flags,
 * and a person is shown what it flags before sending.
 */
export function checkMessage(body: string): MessageFinding[] {
  const words = plain(body);
  const findings: MessageFinding[] = [];
  if (PROMISES_RESULT.test(words)) findings.push("promises_result");
  if (SPEAKS_OF_PRICE.test(words)) findings.push("speaks_of_price");
  if (PRESSES.test(words)) findings.push("presses");
  return findings;
}

/**
 * Checks a template before it is submitted to the vendor.
 *
 * The limits are the vendor's (the template reference, read on 2026-10-09):
 * a name of lower-case letters, digits and underscores, up to 512 characters;
 * a body of up to 1024; a header and a footer of up to 60; one value at most
 * in the header and none in the footer. That the placeholders run from 1
 * with no gap is ONE's own rule: the values are given in order.
 */
export function checkTemplate(draft: TemplateDraft): TemplateFinding[] {
  const findings: TemplateFinding[] = [];
  const error = (code: string) => findings.push({ code, severity: "error" });
  const warning = (code: string) => findings.push({ code, severity: "warning" });

  if (!/^[a-z0-9_]+$/.test(draft.name) || draft.name.length > 512) error("invalid_name");
  if (!CATEGORIES.includes(draft.category)) error("invalid_category");

  const body = draft.body.trim();
  if (!body) error("empty_body");
  if (body.length > 1024) error("body_too_long");

  const numbers = [...new Set(placeholdersOf(body))].sort((a, b) => a - b);
  if (numbers.some((number, index) => number !== index + 1)) error("placeholders_not_in_sequence");

  const header = (draft.headerText ?? "").trim();
  if (header.length > 60) error("header_too_long");
  if (paramCountOf(header) > 1) error("header_too_many_values");

  const footer = (draft.footerText ?? "").trim();
  if (footer.length > 60) error("footer_too_long");
  if (paramCountOf(footer) > 0) error("footer_with_value");

  const words = plain(`${header} ${body} ${footer}`);
  if (PROMISES_RESULT.test(words)) warning("promises_result");
  if (SPEAKS_OF_PRICE.test(words)) warning("speaks_of_price");
  if (draft.category === "marketing") warning("marketing_category");

  return findings;
}
