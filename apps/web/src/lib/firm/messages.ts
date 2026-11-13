/**
 * The firm's own words in ONE's messages (migration 0191, phase 6 of the case journey plan). Pure: the same checks the
 * database makes (`firm_message_problem`), said while the person writes; the suggestion ONE gives where something does
 * not pass ("Aceitar sugestão"); what the bar's rules on advertising weigh, for the firm to weigh; and the text filled
 * with its values when it goes.
 */

export type OneMessage = {
  key: string;
  name: string;
  whereSaid: string;
  required: string[];
  optional: string[];
  example: string;
};

export type MessageProblem =
  | { code: "size" }
  | { code: "missing_value"; value: string }
  | { code: "unknown_value"; value: string }
  | { code: "copy_rules" }
  | { code: "promise" };

const plain = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase();

const PROMISE =
  /(garant|com certeza|certeza de ganhar|vai ganhar|vai receber|indenizacao certa|sem risco|100 ?%|causa ganha)/;
const PRICE = /\b(gratis|gratuit[oa]s?|sem custo|nao cobramos|desconto|promocao|honorarios?)\b/;

/** What keeps a text from counting, as the database says it; null when it passes. */
export function messageProblem(
  message: Pick<OneMessage, "required" | "optional">,
  text: string,
): MessageProblem | null {
  const body = text.trim();
  if (body.length < 10 || body.length > 1000) return { code: "size" };
  for (const value of message.required) {
    if (!body.includes(`{${value}}`)) return { code: "missing_value", value };
  }
  for (const match of body.matchAll(/\{([^}]*)\}/g)) {
    if (!message.required.includes(match[1]) && !message.optional.includes(match[1])) {
      return { code: "unknown_value", value: match[1] };
    }
  }
  if (/[—–!]/.test(body)) return { code: "copy_rules" };
  if (PROMISE.test(plain(body))) return { code: "promise" };
  return null;
}

/** What the bar's rules on advertising weigh in a text, for the firm to weigh: a price or a fee spoken of. */
export const speaksOfPrice = (text: string): boolean => PRICE.test(plain(text));

/** The words a value missing is put back with, at the end of the text. */
const MISSING_LINE: Record<string, string> = {
  link: "Abra o seu link: {link}",
  nome: "{nome}",
  caso: "Caso {caso}.",
};

/**
 * ONE's rewrite of a text that does not pass: the dashes and exclamation marks made plain, every sentence that
 * promises a result taken out, a value it does not know taken out, and each value it must carry put back at its end.
 */
export function suggestMessage(message: Pick<OneMessage, "required" | "optional">, text: string): string {
  let body = text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/!+/g, ".")
    .replace(/\{([^}]*)\}/g, (whole, value: string) =>
      message.required.includes(value) || message.optional.includes(value) ? whole : "",
    );
  body = body
    .split(/(?<=[.?])\s+/)
    .filter((sentence) => !PROMISE.test(plain(sentence)))
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
  for (const value of message.required) {
    if (!body.includes(`{${value}}`)) body = `${body}${body ? "\n" : ""}${MISSING_LINE[value] ?? `{${value}}`}`;
  }
  return body.slice(0, 1000);
}

/** The text as it goes, its values written in: a value not given stays for whoever fills it later (the case's number). */
export function fillMessage(text: string, values: Record<string, string | null | undefined>): string {
  // A value given blank takes the comma or the space before it along ("Pronto, {nome}." with no name is "Pronto."):
  // ONE asks no name before the person says "Quero seguir" (0239).
  return text.replace(/(,\s*|\s)?\{([a-z]+)\}/g, (whole, lead: string | undefined, value: string) => {
    const given = values[value];
    if (typeof given !== "string") return whole;
    return given.trim() ? `${lead ?? ""}${given}` : "";
  });
}
