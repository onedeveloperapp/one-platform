import type { FirmFunction } from "@/lib/firm/roles";
import type { FlowKey } from "@flyee/onboarding";

/**
 * A person's own setup in a firm (2026-11-03), as pure rules. Who joins a firm was dropped on the home with nothing
 * said: a lawyer met the second factor half way (approving a piece, deciding the queue of the AI, sending a text
 * back, importing the portfolio and authorizing a signature in the cloud ask for it), and one who never registered
 * at the bar had their publications unread, since ONE reads the DJEN by the registrations of the firm's people.
 *
 * So each person leaves their own work ready: the second factor first, then their own WhatsApp, which everybody
 * gives (the owner, 2026-11-14: by it a person is linked to a hearing, gets its guide and reports it; the firm's main
 * number is the only one connected), then, for who signs at the bar (a partner or a lawyer), their registration, and
 * how they file at the courts of their states where the firm's way offers them more than by hand (the owner's three
 * ways, 2026-11-20: the firm's way marked, their court login and their own acknowledgment asked there). It
 * opens on the home while something is owed and the person never answered it, and while their WhatsApp is missing
 * whatever they answered; and at `/configurar` for anybody who does not manage the firm; who manages it answers the
 * rest in the firm's setup, whose finish answers this one too. Only the person's own state is kept
 * (`onboarding_state`, flow below).
 */

export const PERSON_SETUP_FLOW = "person-setup";

export const PERSON_SETUP_STEPS = ["seguranca", "whatsapp", "oab", "protocolo"] as const;
export type PersonSetupStep = (typeof PERSON_SETUP_STEPS)[number];

export const isPersonSetupStep = (value: unknown): value is PersonSetupStep =>
  typeof value === "string" && (PERSON_SETUP_STEPS as readonly string[]).includes(value);

/** Who signs at the bar: a partner or a lawyer. */
export const signsAtTheBar = (firmFunction: FirmFunction | null | undefined): boolean =>
  firmFunction === "socio" || firmFunction === "advogado";

/**
 * The steps a person walks: the factor, their WhatsApp, and, for who signs at the bar, the registration and, when
 * they have a way to choose (`files`, `personFilingStep` of `lib/filing-ways/ways.ts`), how they file.
 */
export const personSetupSteps = (firmFunction: FirmFunction | null | undefined, files = false): PersonSetupStep[] =>
  signsAtTheBar(firmFunction)
    ? files
      ? ["seguranca", "whatsapp", "oab", "protocolo"]
      : ["seguranca", "whatsapp", "oab"]
    : ["seguranca", "whatsapp"];

/**
 * Something of the person's own work is still owed: the account has no factor, the person no WhatsApp, or a lawyer
 * no registration, or no way chosen where they have one to choose (`filingOwed`).
 */
export function personSetupOwed(input: {
  hasFactor: boolean;
  firmFunction: FirmFunction | null | undefined;
  registered: boolean;
  hasWhatsapp: boolean;
  filingOwed?: boolean;
}): boolean {
  return (
    !input.hasFactor ||
    !input.hasWhatsapp ||
    (signsAtTheBar(input.firmFunction) && (!input.registered || input.filingOwed === true))
  );
}

/**
 * Whether the person's setup opens on the home: while something is owed and they never answered it, and while their
 * WhatsApp is missing whatever they answered, since it is required (the owner, 2026-11-14).
 */
export const personSetupShown = (input: { owed: boolean; answered: boolean; hasWhatsapp: boolean }): boolean =>
  (input.owed && !input.answered) || !input.hasWhatsapp;

/**
 * Where the person's setup opens: the step asked for when the person has it, else the first one; a session without
 * the factor opens on it whatever was asked, and goes on to where it was going once it is confirmed.
 */
export function personSetupOpening(input: {
  factorOk: boolean;
  asked: PersonSetupStep | null;
  firmFunction: FirmFunction | null | undefined;
  files?: boolean;
}): { open: PersonSetupStep; afterFactor: PersonSetupStep | null } {
  const steps = personSetupSteps(input.firmFunction, input.files);
  const asked = input.asked && steps.includes(input.asked) && input.asked !== "seguranca" ? input.asked : null;
  const afterFactor = asked ?? steps[1] ?? null;
  if (!input.factorOk) return { open: "seguranca", afterFactor };
  return { open: asked ?? (input.asked === "seguranca" ? "seguranca" : (afterFactor ?? "seguranca")), afterFactor };
}

/** The row that keeps whether the person answered their own setup, per person and firm. */
export const personFlowKey = (userId: string, orgId: string): FlowKey => ({ userId, orgId, flow: PERSON_SETUP_FLOW });
