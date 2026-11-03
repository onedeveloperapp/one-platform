/**
 * The steps of the firm's setup (`/configurar`), in order, by the name the
 * address gives each (`?passo=`): the list on the home leads to the very step
 * something is missing in, so whoever left the setup comes back to it, never
 * to another screen. The first is the second factor, which the database asks
 * for in every step after it (who signs, the claims, an invitation, a
 * connection): what a later step cannot do without is done before it, never
 * found half way (the owner, 2026-11-03). The last, the partner agency, is
 * shown only to a firm whose module has a partner (the passenger module's
 * travel agency), and is never missing: a firm with no agency lacks nothing.
 */
export const SETUP_STEPS = ["seguranca", "oab", "valores", "equipe", "papeis", "canal", "agencia"] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number];

export const isSetupStep = (value: unknown): value is SetupStepKey =>
  (SETUP_STEPS as readonly unknown[]).includes(value);

/** Where a step of the setup opens. */
export const setupHref = (step: SetupStepKey): string => `/configurar?passo=${step}`;

/**
 * Where the setup opens, and where it goes once the second factor is
 * confirmed in its step. A session without the factor opens on it whatever the
 * address asked, since every step after it needs it; past it, the step the
 * address names, else, for a setup answered before, its first step past the
 * factor, else the first one something is missing in.
 */
export function setupOpening(input: {
  factorOk: boolean;
  asked: SetupStepKey | null;
  answered: boolean;
  firstMissing: SetupStepKey | null;
}): { open: SetupStepKey; afterFactor: SetupStepKey } {
  const asked = input.asked === "seguranca" ? null : input.asked;
  const afterFactor = asked ?? (input.answered ? "oab" : (input.firstMissing ?? "oab"));
  return { open: !input.factorOk || input.asked === "seguranca" ? "seguranca" : afterFactor, afterFactor };
}
