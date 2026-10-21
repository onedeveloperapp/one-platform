/**
 * The two things a membership says (migration 0000):
 *   * the role: what the person may do to the FIRM ACCOUNT (the team, the
 *     plan, the billing profile);
 *   * the function: what the person does IN the firm, which decides what the
 *     product shows them and what they may approve.
 *
 * The values are the database's; the words people read are in the `product`
 * message catalog, by the keys below. No rule lives here: who may change what
 * is decided by the functions of migration 0003, and this file only names
 * things for the screens.
 */

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const FIRM_FUNCTIONS = ["socio", "advogado", "controladoria", "atendimento"] as const;
export type FirmFunction = (typeof FIRM_FUNCTIONS)[number];

/** A role an invitation may carry: ownership is transferred, never assigned. */
export const INVITABLE_ROLES = ["member", "admin"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const ROLE_LABEL_KEY: Record<OrgRole, string> = {
  owner: "team-role-owner",
  admin: "team-role-admin",
  member: "team-role-member",
};

export const FUNCTION_LABEL_KEY: Record<FirmFunction, string> = {
  socio: "team-function-socio",
  advogado: "team-function-advogado",
  controladoria: "team-function-controladoria",
  atendimento: "team-function-atendimento",
};

export const FUNCTION_HINT_KEY: Record<FirmFunction, string> = {
  socio: "team-function-socio-hint",
  advogado: "team-function-advogado-hint",
  controladoria: "team-function-controladoria-hint",
  atendimento: "team-function-atendimento-hint",
};

export const isOrgRole = (value: unknown): value is OrgRole => ORG_ROLES.includes(value as OrgRole);

export const isFirmFunction = (value: unknown): value is FirmFunction => FIRM_FUNCTIONS.includes(value as FirmFunction);

export const isInvitableRole = (value: unknown): value is InvitableRole =>
  INVITABLE_ROLES.includes(value as InvitableRole);

/** Who manages the firm account: the owner and the admins. */
export const isManager = (role: OrgRole | null | undefined): boolean => role === "owner" || role === "admin";

/** The 27 states of the bar, as `oab_registrations.uf` accepts them. */
export const OAB_STATES = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
] as const;
export type OabState = (typeof OAB_STATES)[number];

export type OabRegistration = { id: string; uf: OabState; number: string; kind: "principal" | "suplementar" };

/** A registration as the bar writes it: `OAB/GO 12.345`. */
export function formatOab(registration: Pick<OabRegistration, "uf" | "number">): string {
  const match = /^([0-9]+)([A-Z]?)$/.exec(registration.number);
  const digits = match ? match[1] : registration.number;
  const suffix = match ? match[2] : "";
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `OAB/${registration.uf} ${grouped}${suffix ? `-${suffix}` : ""}`;
}
