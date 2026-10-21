/**
 * The public code of an issued document: what is printed on it and typed at
 * /verificar. Twelve characters of an alphabet with nothing that reads as
 * something else on paper (no 0 or O, no 1, I or L), which leaves about
 * 7.9e17 codes: one cannot be guessed, and one typed wrong finds nothing.
 *
 * This file depends on nothing, so the page where a person types a code can
 * use it in the browser. Drawing a new code needs randomness and lives in
 * `code-generator.ts`.
 */

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 12;

const CODE = /^[A-HJ-KMNP-Z2-9]{12}$/;

/** What a person typed, as a code: letters and digits only, upper case. Null when it cannot be one. */
export function normalizeVerifyCode(input: string | null | undefined): string | null {
  const code = (input ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return CODE.test(code) ? code : null;
}

/** The code as it is printed: `ABCD-EFGH-JKMN`. */
export const formatVerifyCode = (code: string): string => (code.match(/.{1,4}/g) ?? [code]).join("-");

/** Where a code is checked. */
export const verifyUrlFor = (baseUrl: string, code: string): string =>
  `${baseUrl.replace(/\/+$/, "")}/verificar/${code}`;
