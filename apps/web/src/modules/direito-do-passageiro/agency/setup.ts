/**
 * The travel agency's setup (migration 0080), as pure rules: its steps, where it opens and where it leads when it
 * ends. The page is `/parceiro/configurar` (the module's route group), which the gate opens for somebody of the
 * agency who owes the second factor and in place of the agency's home while who manages it never answered it.
 *
 * The order is the order of what each step needs (apps/web/CLAUDE.md, "Nothing in a flow is met half way"): the
 * second factor first, since every write of the agency asks for it (`pax_partnership_for_writer`,
 * `pax_save_consent_term`, `rename_partner`, the invitations); then the agency's name, which the passenger reads
 * in the words they agree to; the clause of the agency's contract, without which no passenger's link is issued
 * (`no_consent_term`); the team; and how the passengers reach ONE, which is where the setup ends. Who does not
 * manage the agency has nothing of it to answer: their setup is the factor and the way to the passengers.
 */

export const AGENCY_SETUP_STEPS = ["seguranca", "nome", "clausula", "equipe", "passageiros"] as const;
export type AgencySetupStep = (typeof AGENCY_SETUP_STEPS)[number];

export const isAgencySetupStep = (value: unknown): value is AgencySetupStep =>
  typeof value === "string" && (AGENCY_SETUP_STEPS as readonly string[]).includes(value);

/** The address of a step of the setup, for whatever leads back to it. */
export const agencySetupHref = (step: AgencySetupStep) => `/parceiro/configurar?passo=${step}`;

/** The steps a person of the agency walks: who manages it, every one; anybody else, the factor and the way in. */
export function agencySetupSteps(manager: boolean): AgencySetupStep[] {
  return manager ? [...AGENCY_SETUP_STEPS] : ["seguranca", "passageiros"];
}

/**
 * Where the setup opens, and where it goes once the factor is confirmed: the step the address asked for when the
 * person has it, else the first one past the factor. A session without the factor opens on it, whatever was asked.
 */
export function agencySetupOpening(input: { factorOk: boolean; asked: AgencySetupStep | null; manager: boolean }): {
  open: AgencySetupStep;
  afterFactor: AgencySetupStep;
} {
  const steps = agencySetupSteps(input.manager);
  const asked = input.asked && input.asked !== "seguranca" && steps.includes(input.asked) ? input.asked : null;
  const afterFactor = asked ?? steps[1];
  return { open: !input.factorOk || input.asked === "seguranca" ? "seguranca" : afterFactor, afterFactor };
}

/** How the agency's passengers reach ONE: one by one, from a spreadsheet of its system, or by its system itself. */
export const PASSENGER_WAYS = ["um-a-um", "planilha", "api"] as const;
export type PassengerWay = (typeof PASSENGER_WAYS)[number];

/** The ways a person may choose: the system's key is created by who manages the agency alone (0073). */
export const passengerWays = (manager: boolean): PassengerWay[] =>
  manager ? [...PASSENGER_WAYS] : ["um-a-um", "planilha"];

/** Where the setup leads when it ends, by the way chosen: the first passenger is the agency's first result. */
export const PASSENGER_WAY_HREF: Record<PassengerWay, string> = {
  "um-a-um": "/parceiro/passageiros",
  planilha: "/parceiro/passageiros/importar",
  api: "/parceiro/passageiros/integracao",
};

/** The fewest and the most characters of a clause the database takes (0070). */
export const CLAUSE_LEAST = 40;
export const CLAUSE_MOST = 1200;

/** The words of a clause as the database will keep them: spaces of a line folded, the ends trimmed. */
export const clauseText = (body: string) =>
  body
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();

/**
 * What the clause step does with what is in the field: registers it when it differs from the clause in force (a
 * first clause or a new version), and nothing when it is the clause in force; a text out of the bounds stays.
 */
export function clauseChange(
  body: string,
  inForce: string | null,
): { kind: "register"; text: string } | { kind: "same" } | { kind: "invalid" } {
  const text = clauseText(body);
  if (inForce !== null && text === clauseText(inForce)) return { kind: "same" };
  if (text.length < CLAUSE_LEAST || text.length > CLAUSE_MOST) return { kind: "invalid" };
  return { kind: "register", text };
}
