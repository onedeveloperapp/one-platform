import { isValidCep, isValidCnpj, isValidPhoneBr, onlyDigits } from "@flyee/fields";

/**
 * What the firm's letterhead says of the firm (the plan "o escritório preparado antes do primeiro atendimento", phase
 * 2; the owner, 2026-11-20: the firm's data read from the documents it sends, the form only for what is missing):
 * its CNPJ, phone, e-mail and address, read from the lines of the header and the footer by rules, each value checked
 * (a CNPJ by its digits, a CEP, a phone of Brazil). An address is said only whole (a CEP, a street with its number,
 * a city and its state); what is not read is left out, never guessed. Pure.
 */

export type LetterheadOffice = {
  cnpj?: string;
  phone?: string;
  email?: string;
  address?: {
    postal_code: string;
    street: string;
    number: string;
    complement?: string;
    district?: string;
    city: string;
    uf: string;
  };
};

const UFS = new Set([
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
]);

const STREET = /\b(rua|r\.|avenida|av\.?|alameda|al\.|pra[cç]a|rodovia|travessa|tv\.|estrada|quadra|qd\.?)\s+/i;

/** The pieces of a line, split where a letterhead separates them. */
const pieces = (line: string): string[] =>
  line
    .split(/\s*[|·•]\s*|\s{2,}/)
    .map((piece) => piece.trim())
    .filter(Boolean);

function addressOf(line: string): LetterheadOffice["address"] | undefined {
  // A letterhead separates the parts of an address with bars or dots as often as with commas.
  const text = line.replace(/\s*[|·•]\s*/g, ", ");
  const cep = /\b(\d{5})-?(\d{3})\b/.exec(text);
  if (!cep || !isValidCep(`${cep[1]}${cep[2]}`)) return undefined;
  const street = STREET.exec(text);
  if (!street) return undefined;
  // From the street's word on: "Rua das Flores, 100, Sala 2, Setor Oeste, Goiânia - GO, CEP 74000-000".
  const rest = text
    .slice(street.index)
    .replace(/\bCEP:?\s*\d{5}-?\d{3}\b/i, "")
    .replace(/\b\d{5}-?\d{3}\b/, "");
  const parts = rest
    .split(/\s*,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const first = parts.shift() ?? "";
  // The number follows the street in its part, or is the next part.
  let streetName = first;
  let number: string | undefined;
  const inline = /^(.*?)(?:,|\s)\s*(?:n[ºo°.]*\s*)?(\d+[A-Za-z]?|s\/n)$/i.exec(first);
  if (inline) {
    streetName = inline[1]!.trim();
    number = inline[2];
  } else if (parts[0] && /^(?:n[ºo°.]*\s*)?(\d+[A-Za-z]?|s\/n)$/i.test(parts[0])) {
    number = parts.shift()!.replace(/^n[ºo°.]*\s*/i, "");
  }
  // The city and its state: "Goiânia - GO", "Goiânia/GO", "Goiânia, GO".
  let city: string | undefined;
  let uf: string | undefined;
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]!;
    const joined = /^(.+?)\s*[-/–]\s*([A-Za-z]{2})$/.exec(part);
    if (joined && UFS.has(joined[2]!.toUpperCase())) {
      city = joined[1]!.trim();
      uf = joined[2]!.toUpperCase();
      parts.splice(index, 1);
      break;
    }
    if (UFS.has(part.toUpperCase()) && index > 0) {
      uf = part.toUpperCase();
      city = parts[index - 1]!.trim();
      parts.splice(index - 1, 2);
      break;
    }
  }
  if (!streetName || !number || !city || !uf) return undefined;
  const complement = parts.filter((part) => /^(sala|sl\.?|andar|bloco|conj|apto|apartamento|loja|edif)/i.test(part));
  const district = parts.filter((part) => !complement.includes(part)).at(-1);
  return {
    postal_code: `${cep[1]}${cep[2]}`,
    street: streetName.replace(/\s+/g, " "),
    number,
    ...(complement.length > 0 ? { complement: complement.join(", ") } : {}),
    ...(district ? { district } : {}),
    city,
    uf,
  };
}

/** What the lines of the letterhead's header and footer say of the firm. */
export function officeOfLetterhead(lines: readonly string[]): LetterheadOffice {
  const text = lines.join("  ");
  const found: LetterheadOffice = {};
  for (const match of text.matchAll(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g)) {
    const digits = onlyDigits(match[0]);
    if (digits.length === 14 && isValidCnpj(digits)) {
      found.cnpj = digits;
      break;
    }
  }
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(text);
  if (email) found.email = email[0].toLowerCase();
  for (const match of text.matchAll(/(?:\+?55\s*)?\(?\b\d{2}\)?\s*9?\s?\d{4}[-.\s]?\d{4}\b/g)) {
    let digits = onlyDigits(match[0]);
    if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
    // A CNPJ's or a CEP's digits are no phone.
    if (found.cnpj && found.cnpj.includes(digits)) continue;
    if (isValidPhoneBr(digits)) {
      found.phone = digits;
      break;
    }
  }
  for (const line of lines) {
    for (const piece of [line, ...pieces(line)]) {
      const address = addressOf(piece);
      if (address) {
        found.address = address;
        return found;
      }
    }
  }
  const whole = addressOf(lines.join(", "));
  if (whole) found.address = whole;
  return found;
}
