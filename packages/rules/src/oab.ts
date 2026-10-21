/**
 * A lawyer's registration at the bar (OAB): the state of the section and the
 * number as that section writes it, digits and sometimes a letter
 * (`OAB/GO 12.345`, `OAB/SP 123.456-A`). The database holds the same rule
 * (`oab_registrations`, migration 0003).
 */

export const OAB_STATES = [
  "AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA",
  "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO",
] as const;

export type OabState = (typeof OAB_STATES)[number];

export const isOabState = (value: unknown): value is OabState => (OAB_STATES as readonly unknown[]).includes(value);

export type OabRegistration = { uf: OabState; number: string };

/**
 * A registration from what a person typed: `OAB/GO 12.345`, `go 12345`,
 * `12345/GO`, `SP 123.456-A`. The number keeps its digits (without the
 * zeros before them) and its letter. Null when there is no state of the bar
 * or the number is not one to seven digits with an optional letter.
 */
export function parseOab(input: string | null | undefined): OabRegistration | null {
  const text = String(input ?? "")
    .toUpperCase()
    .replace(/OAB/g, " ");
  const state = OAB_STATES.find((uf) => new RegExp(`(^|[^A-Z])${uf}([^A-Z]|$)`).test(text));
  if (!state) return null;
  const rest = text.replace(new RegExp(`(^|[^A-Z])${state}([^A-Z]|$)`), " ");
  const match = /^(\d{1,7})([A-Z]?)$/.exec(rest.replace(/[\s./-]/g, ""));
  if (!match || Number(match[1]) === 0) return null;
  return { uf: state, number: `${Number(match[1])}${match[2]}` };
}

/** A registration as the bar writes it: `OAB/GO 12.345`, `OAB/SP 123.456-A`. */
export function formatOab(registration: OabRegistration): string {
  const match = /^(\d+)([A-Z]?)$/.exec(registration.number);
  const digits = match ? match[1] : registration.number;
  const letter = match ? match[2] : "";
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `OAB/${registration.uf} ${grouped}${letter ? `-${letter}` : ""}`;
}
