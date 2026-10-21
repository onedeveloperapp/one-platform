/**
 * A registration number at the bar as the DJEN writes and matches it: the
 * digits, and the letter after them when the registration has one, with no
 * mask and no zeros in front ("012.345-A" is "12345A").
 *
 * The letter is part of the number. In several states a supplementary
 * registration is the number of another lawyer with a letter after it, so
 * "12345" and "12345A" are two people; and the public API (verified against
 * it on 2026-10-09) answers a search for the digits alone with nothing of
 * the registration that has the letter, and the other way round.
 */
export function oabNumberKey(value: unknown): string {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^0+/, "");
}

/** A state of a registration, as two capital letters. */
export const oabStateKey = (value: unknown): string => String(value ?? "").trim().toUpperCase();
