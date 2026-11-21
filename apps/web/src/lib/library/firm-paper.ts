import { UFS } from "@/lib/cases/cases";
import { type FirmRecord, identifiersIn } from "@/lib/library/imports";
import { isValidCnpj } from "@flyee/fields";

/**
 * What a document of the firm says of the firm itself, as the fifth marking reads it (`dados_do_escritorio`,
 * migration 0271), checked against the document's own words before it goes into the firm's record
 * (`fill_firm_office_from_paper`). Pure: no I/O.
 *
 * The model only reads; this decides. Nothing is taken unless the document is the firm's: it names as the firm's a
 * society with the firm's name or a lawyer of its record, or the firm answered that its data are its own. Each value
 * must be written in the paragraphs the marking says hold the firm's data: a CNPJ whose digits are there and check,
 * a registration at the bar whose number is there, a name and a street whose words are there. The CEP, the e-mail and
 * the telephone, which the model never sees, are read from those paragraphs by rule.
 */

export type FirmPaperData = {
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  society: { uf: string; number: string } | null;
  address: {
    postal_code: string | null;
    street: string;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string;
    uf: string;
  } | null;
  lawyers: { name: string; uf: string; number: string }[];
};

/** What the marking said the document is, as the record names where its data came from. */
const SOURCES: Record<string, string> = {
  peca: "piece",
  peca_do_processo: "peca_processo",
  procuracao: "procuracao",
  contrato: "contrato",
  declaracao_residencia: "declaracao_residencia",
  declaracao_hipossuficiencia: "declaracao_hipossuficiencia",
};

/** Where the firm's data came from, for `fill_firm_office_from_paper`; null for a document that is not a model. */
export const firmPaperSource = (documento: unknown): string | null =>
  typeof documento === "string" ? (SOURCES[documento] ?? null) : null;

const text = (value: unknown): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");

/** A text as words are compared: no accent, no capital, letters and digits apart by one space. */
const plain = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Words that say what kind of firm or street a name is, never which. */
const FILLER = new Set([
  "sociedade",
  "advogados",
  "advogadas",
  "advocacia",
  "associados",
  "associadas",
  "escritorio",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "e",
  "ltda",
  "ss",
  "s",
  "eireli",
  "rua",
  "r",
  "avenida",
  "av",
  "alameda",
  "al",
  "travessa",
  "tv",
  "praca",
  "rodovia",
  "estrada",
]);

const wordsOf = (value: string): string[] =>
  plain(value)
    .split(" ")
    .filter((word) => word.length >= 2 && !FILLER.has(word));

/** Whether every word that names something in `value` is written in `within`. */
function writtenIn(value: string, within: string): boolean {
  const words = wordsOf(value);
  if (words.length === 0) return false;
  const there = new Set(plain(within).split(" "));
  return words.every((word) => there.has(word));
}

/** Whether two names are the same firm's: the words of the shorter all in the longer ("Lima & Prado" and "Lima & Prado Sociedade de Advogados"). */
export function sameFirmName(a: string, b: string): boolean {
  const left = wordsOf(a);
  const right = wordsOf(b);
  if (left.length === 0 || right.length === 0) return false;
  const [short, long] = left.length <= right.length ? [left, new Set(right)] : [right, new Set(left)];
  return short.every((word) => long.has(word));
}

/** A registration at the bar as written ("OAB/GO 12.345", "OAB/GO sob o nº 054321"): its state and its number. */
export function oabOf(value: string): { uf: string; number: string } | null {
  const found = /OAB\s*[/-]?\s*([A-Z]{2})\b\D{0,20}?(\d[\d.]*)/i.exec(value);
  if (!found) return null;
  const uf = found[1].toUpperCase();
  const number = found[2].replace(/\D/g, "").replace(/^0+/, "");
  return (UFS as readonly string[]).includes(uf) && /^\d{1,10}$/.test(number) ? { uf, number } : null;
}

/** Every number written in a text, without its dots and the zeros before it. */
const numbersIn = (value: string): Set<string> =>
  new Set((value.match(/\d[\d.]*/g) ?? []).map((run) => run.replace(/\D/g, "").replace(/^0+/, "")));

const ints = (value: unknown): number[] =>
  (Array.isArray(value) ? value : []).filter((item): item is number => Number.isInteger(item) && item > 0);

/**
 * What goes into the firm's record from a marking's answer, or null when nothing does: the document is not the
 * firm's by its own words (and the firm did not say so), or it writes nothing of the firm that checks.
 */
export function firmPaperOf(
  output: unknown,
  paragraphs: readonly string[],
  record: FirmRecord | null,
  answered: boolean,
): FirmPaperData | null {
  if (!record || typeof output !== "object" || output === null) return null;
  const answer = output as Record<string, unknown>;
  const said = (
    typeof answer.dados_do_escritorio === "object" && answer.dados_do_escritorio !== null
      ? answer.dados_do_escritorio
      : {}
  ) as Record<string, unknown>;
  const at = [...new Set(ints(answer.paragrafos_do_escritorio))]
    .filter((n) => n <= paragraphs.length)
    .sort((a, b) => a - b);
  const firmParagraphs = at.map((n) => paragraphs[n - 1]);
  const firmText = firmParagraphs.join("\n");
  if (!firmText.trim()) return null;
  const numbers = numbersIn(firmText);

  const lawyers = (Array.isArray(said.advogados) ? said.advogados : []).flatMap((item) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const name = text(row.nome);
    const oab = oabOf(text(row.oab));
    if (!oab || !numbers.has(oab.number) || name.length < 3 || name.length > 120 || !writtenIn(name, firmText))
      return [];
    return [{ name, uf: oab.uf, number: oab.number }];
  });
  const society = (() => {
    const oab = oabOf(text(said.registro_da_sociedade));
    if (!oab || !numbers.has(oab.number)) return null;
    // A registration that is a lawyer's is never the society's.
    return lawyers.some((lawyer) => lawyer.uf === oab.uf && lawyer.number === oab.number) ? null : oab;
  })();

  // The document is the firm's by its own words: the firm's society by name, or a lawyer of its record.
  const recordOabs = new Set(
    record.lawyers.map((lawyer) => oabOf(lawyer.oab)).flatMap((oab) => (oab ? [`${oab.uf}${oab.number}`] : [])),
  );
  const societyName = text(said.sociedade);
  const firms =
    answered ||
    (societyName !== "" && writtenIn(societyName, firmText) && sameFirmName(societyName, record.name)) ||
    lawyers.some((lawyer) => recordOabs.has(`${lawyer.uf}${lawyer.number}`));
  if (!firms) return null;

  const found = identifiersIn(firmText);
  const first = (kind: string) => found.find((item) => item.identifier === kind)?.match ?? null;

  const saidCnpj = text(said.cnpj).replace(/\D/g, "");
  const writtenCnpj = (first("cnpj") ?? "").replace(/\D/g, "");
  const cnpj =
    saidCnpj.length === 14 && isValidCnpj(saidCnpj) && firmText.replace(/\D/g, "").includes(saidCnpj)
      ? saidCnpj
      : writtenCnpj.length === 14 && isValidCnpj(writtenCnpj)
        ? writtenCnpj
        : null;

  const place = (typeof said.endereco === "object" && said.endereco !== null ? said.endereco : {}) as Record<
    string,
    unknown
  >;
  const street = text(place.logradouro);
  const city = text(place.cidade);
  const uf = text(place.uf).toUpperCase();
  const address =
    street.length >= 2 &&
    street.length <= 160 &&
    writtenIn(street, firmText) &&
    city.length >= 2 &&
    city.length <= 80 &&
    writtenIn(city, firmText) &&
    (UFS as readonly string[]).includes(uf)
      ? (() => {
          // The CEP of the paragraph that writes the street, or else the first of the firm's paragraphs.
          const home = firmParagraphs.find((paragraph) => writtenIn(street, paragraph)) ?? firmText;
          const cep =
            (identifiersIn(home).find((item) => item.identifier === "cep")?.match ?? first("cep") ?? "").replace(
              /\D/g,
              "",
            ) || null;
          const optional = (value: unknown, longest: number) => {
            const given = text(value);
            return given && given.length <= longest && writtenIn(given, firmText) ? given : null;
          };
          const number = text(place.numero);
          return {
            postal_code: cep && cep.length === 8 ? cep : null,
            street,
            number:
              number &&
              number.length <= 20 &&
              (numbersIn(number).size === 0 || [...numbersIn(number)].every((n) => numbers.has(n)))
                ? number
                : null,
            complement: optional(place.complemento, 80),
            district: optional(place.bairro, 80),
            city,
            uf,
          };
        })()
      : null;

  const email = first("email")?.toLowerCase() ?? null;
  const phoneDigits = (first("telefone") ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const phone = phoneDigits.length === 10 || phoneDigits.length === 11 ? phoneDigits : null;

  const data: FirmPaperData = { cnpj, phone, email, society, address, lawyers };
  const anything = cnpj || phone || email || society || address || lawyers.length > 0;
  return anything ? data : null;
}
