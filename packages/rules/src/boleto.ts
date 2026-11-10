/**
 * The typed line of a Brazilian bill (a "linha digitável"), read and checked by rule (phase 5 of the plan of the
 * controladoria and the finance). Two forms:
 *
 * - a bank's collection bill (boleto de cobrança), 47 digits: three fields each closed by a module-10 digit, the
 *   general module-11 digit of the barcode, the due factor and the value. The due factor counts days from 1997-10-07 and,
 *   having reached 9999 on 2025-02-21, started again at 1000 on 2025-02-22 (FEBRABAN); a factor is read in the cycle
 *   nearest to the day it is read on. Factor 0000 says no due day.
 * - a collection of a utility, a tax or a fee (arrecadação), 48 digits starting with 8: four blocks of eleven digits,
 *   each closed by a digit of module 10 or 11 as its third digit says, and the value when the third digit says it is
 *   one (6 or 8). Its due day is not in a standard place: it stays as read from the document.
 *
 * Pure. Nothing here pays anything: ONE reads what the firm has to pay or receive, and the person pays at the bank.
 */

export type BoletoKind = "cobranca" | "arrecadacao";

export type Boleto = {
  kind: BoletoKind;
  /** The 47 or 48 digits as typed, digits only. */
  line: string;
  /** The 44 digits of the barcode. */
  barcode: string;
  /** The value in cents, when the line says one; null for a bill whose value is the payer's to say. */
  cents: number | null;
  /** The due day as YYYY-MM-DD, when the line says one. */
  dueOn: string | null;
  /** The bank's code (cobrança) or the segment (arrecadação: 1 a city hall, 2 sanitation, 3 power and gas, ...). */
  bank: string | null;
  segment: string | null;
};

export type BoletoRead =
  | { ok: true; boleto: Boleto }
  | { ok: false; code: "length" | "field_digit" | "general_digit" | "not_arrecadacao" };

const onlyDigits = (text: string) => String(text ?? "").replace(/\D/g, "");

/** The module-10 digit of a string of digits (weights 2 and 1 from the right, products' digits added). */
export function mod10(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const product = Number(digits[index]) * weight;
    sum += Math.floor(product / 10) + (product % 10);
    weight = weight === 2 ? 1 : 2;
  }
  return (10 - (sum % 10)) % 10;
}

/** The module-11 sum of a string of digits, weights 2 to 9 from the right. */
function mod11Rest(digits: string): number {
  let sum = 0;
  let weight = 2;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    sum += Number(digits[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  return sum % 11;
}

/** The general digit of a collection bill's barcode: 0, 10 and 11 become 1. */
export function mod11Cobranca(digits: string): number {
  const dv = 11 - mod11Rest(digits);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** A digit of module 11 of an arrecadação: a rest of 0 or 1 is 0. */
export function mod11Arrecadacao(digits: string): number {
  const rest = mod11Rest(digits);
  return rest === 0 || rest === 1 ? 0 : 11 - rest;
}

const DAY_MS = 86_400_000;
const OLD_BASE = Date.UTC(1997, 9, 7);
const NEW_BASE = Date.UTC(2025, 1, 22);

/** The due day a factor says, in the cycle nearest to `today` ("YYYY-MM-DD"); null for factor 0. */
export function dueFromFactor(factor: number, today: string): string | null {
  if (!Number.isInteger(factor) || factor <= 0 || factor > 9999) return null;
  const reference = Date.parse(`${today}T00:00:00Z`);
  const old = OLD_BASE + factor * DAY_MS;
  const fresh = factor >= 1000 ? NEW_BASE + (factor - 1000) * DAY_MS : null;
  const chosen =
    fresh !== null && Number.isFinite(reference) && Math.abs(fresh - reference) < Math.abs(old - reference) ? fresh : old;
  return new Date(chosen).toISOString().slice(0, 10);
}

/** The factor a due day takes in the current cycle (from 2025-02-22 on), for composing a line in tests and checks. */
export function factorOf(day: string): number {
  const at = Date.parse(`${day}T00:00:00Z`);
  return at >= NEW_BASE ? 1000 + Math.round((at - NEW_BASE) / DAY_MS) : Math.round((at - OLD_BASE) / DAY_MS);
}

/** A collection bill's 47 digits from its barcode. */
export function cobrancaLine(barcode: string): string {
  const free = barcode.slice(19);
  const one = barcode.slice(0, 4) + free.slice(0, 5);
  const two = free.slice(5, 15);
  const three = free.slice(15, 25);
  return `${one}${mod10(one)}${two}${mod10(two)}${three}${mod10(three)}${barcode[4]}${barcode.slice(5, 19)}`;
}

/** A collection bill's barcode from its 44 digits but the general one: the digit computed and put in. */
export function cobrancaBarcode(withoutDigit: string): string {
  const digit = mod11Cobranca(withoutDigit);
  return `${withoutDigit.slice(0, 4)}${digit}${withoutDigit.slice(4)}`;
}

/** An arrecadação's 48 digits from its barcode. */
export function arrecadacaoLine(barcode: string): string {
  const byMod10 = barcode[2] === "6" || barcode[2] === "7";
  return [0, 11, 22, 33]
    .map((start) => {
      const block = barcode.slice(start, start + 11);
      return block + (byMod10 ? mod10(block) : mod11Arrecadacao(block));
    })
    .join("");
}

/** An arrecadação's barcode from its 44 digits but the general one (the fourth): the digit computed and put in. */
export function arrecadacaoBarcode(withoutDigit: string): string {
  const byMod10 = withoutDigit[2] === "6" || withoutDigit[2] === "7";
  const digit = byMod10 ? mod10(withoutDigit) : mod11Arrecadacao(withoutDigit);
  return `${withoutDigit.slice(0, 3)}${digit}${withoutDigit.slice(3)}`;
}

/**
 * A typed line read and checked: every digit of every field, and the barcode's general digit. A line of 44 digits is
 * taken as the barcode itself. `today` is the day it is read on, for the cycle of the due factor.
 */
export function readBoleto(text: string, today: string): BoletoRead {
  const digits = onlyDigits(text);
  if (digits.length === 44) {
    return digits[0] === "8"
      ? readBoleto(arrecadacaoLine(digits), today)
      : readBoleto(cobrancaLine(digits), today);
  }
  if (digits.length === 47) {
    const fields = [digits.slice(0, 10), digits.slice(10, 21), digits.slice(21, 32)];
    if (fields.some((field) => mod10(field.slice(0, -1)) !== Number(field.at(-1)))) {
      return { ok: false, code: "field_digit" };
    }
    const barcode =
      digits.slice(0, 4) +
      digits[32] +
      digits.slice(33, 47) +
      digits.slice(4, 9) +
      digits.slice(10, 20) +
      digits.slice(21, 31);
    if (mod11Cobranca(barcode.slice(0, 4) + barcode.slice(5)) !== Number(barcode[4])) {
      return { ok: false, code: "general_digit" };
    }
    const factor = Number(barcode.slice(5, 9));
    const value = Number(barcode.slice(9, 19));
    return {
      ok: true,
      boleto: {
        kind: "cobranca",
        line: digits,
        barcode,
        cents: value > 0 ? value : null,
        dueOn: dueFromFactor(factor, today),
        bank: barcode.slice(0, 3),
        segment: null,
      },
    };
  }
  if (digits.length === 48) {
    if (digits[0] !== "8") return { ok: false, code: "not_arrecadacao" };
    const byMod10 = digits[2] === "6" || digits[2] === "7";
    const blocks = [0, 12, 24, 36].map((start) => digits.slice(start, start + 12));
    if (
      blocks.some((block) => {
        const body = block.slice(0, 11);
        return (byMod10 ? mod10(body) : mod11Arrecadacao(body)) !== Number(block[11]);
      })
    ) {
      return { ok: false, code: "field_digit" };
    }
    const barcode = blocks.map((block) => block.slice(0, 11)).join("");
    const general = byMod10 ? mod10(barcode.slice(0, 3) + barcode.slice(4)) : mod11Arrecadacao(barcode.slice(0, 3) + barcode.slice(4));
    if (general !== Number(barcode[3])) return { ok: false, code: "general_digit" };
    const carriesValue = barcode[2] === "6" || barcode[2] === "8";
    const value = Number(barcode.slice(4, 15));
    return {
      ok: true,
      boleto: {
        kind: "arrecadacao",
        line: digits,
        barcode,
        cents: carriesValue && value > 0 ? value : null,
        dueOn: null,
        bank: null,
        segment: barcode[1],
      },
    };
  }
  return { ok: false, code: "length" };
}
