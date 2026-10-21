import { isValidCpf, onlyDigits } from "@flyee/fields";

/**
 * Lookup of a CPF in the federal registry (docs/ONE-PLANO-DESENVOLVIMENTO.md,
 * 4.6 and 6). ONE asks one thing of it: is this the person the documents
 * name, and is the registration regular. The answer is personal data: it is
 * stored on the person under the firm, with the day it was read, and never
 * written to a log.
 *
 * Since version 3 of the Serpro API (2026), the registry answers only for a
 * CPF and the birth date that goes with it, and never for a person under 18:
 * the question is always the pair.
 */

/** What the registry holds for a CPF. */
export type CpfRecord = {
  /** The 11 digits, no mask. */
  cpf: string;
  /** The name as the registry holds it. */
  name: string;
  /** The social name, when the person registered one. */
  socialName: string | null;
  /** The birth date as YYYY-MM-DD. */
  birthDate: string | null;
  /** The registry's code of the situation: `0` is regular. */
  situationCode: string;
  /** The registry's own words for the situation ("Regular", "Suspensa"). */
  situation: string;
  /** Whether the registration is in good standing. */
  regular: boolean;
};

/**
 * What came of a lookup:
 * - `found`: the registry holds the pair. `partial` when it left out a field it
 *   usually gives (the date of registration);
 * - `not_found`: no CPF with that number;
 * - `birth_date_mismatch`: the CPF exists, with another birth date;
 * - `minor`: the registry does not answer for a person under 18;
 * - `unavailable`: it could not be asked now (no answer, a refused credential,
 *   a version taken down). `detail` is a code, never the registry's text.
 */
export type CpfLookupResult =
  | { kind: "found"; record: CpfRecord; partial: boolean }
  | { kind: "not_found" }
  | { kind: "birth_date_mismatch" }
  | { kind: "minor" }
  | { kind: "unavailable"; detail: string };

/** The number fails its check digits: no lookup is made for it. */
export class InvalidCpfError extends Error {
  constructor() {
    // The number itself stays out of the message: an error message ends up in logs.
    super("the CPF fails its check digits");
    this.name = "InvalidCpfError";
  }
}

/** The birth date is not a day: no lookup is made for it. */
export class InvalidBirthDateError extends Error {
  constructor() {
    super("the birth date is not a day");
    this.name = "InvalidBirthDateError";
  }
}

export interface CpfLookup {
  /**
   * What the registry holds for a CPF (with or without its mask) and the
   * birth date that goes with it (YYYY-MM-DD). Throws `InvalidCpfError` or
   * `InvalidBirthDateError`, before any call, when either is not one; any
   * other outcome is an answer, never an exception.
   */
  lookupCpf(cpf: string, birthDate: string): Promise<CpfLookupResult>;
}

/** The 11 digits of a CPF that passes its check digits, or `InvalidCpfError`. Every implementation starts here. */
export function normalizeCpf(cpf: string): string {
  const digits = onlyDigits(cpf);
  if (!isValidCpf(digits)) throw new InvalidCpfError();
  return digits;
}

/** A birth date that is a day (YYYY-MM-DD), or `InvalidBirthDateError`. */
export function normalizeBirthDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) throw new InvalidBirthDateError();
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new InvalidBirthDateError();
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}
