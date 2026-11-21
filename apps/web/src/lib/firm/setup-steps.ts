/**
 * The steps of the firm's setup (`/configurar`), in order, by the name the
 * address gives each (`?passo=`): the list on the home leads to the very step
 * something is missing in, so whoever left the setup comes back to it, never
 * to another screen. The first is the second factor, which the database asks
 * for in every step after it (who signs, the claims, an invitation, a
 * connection): what a later step cannot do without is done before it, never
 * found half way (the owner, 2026-11-03). These are the core's, what every
 * firm needs: what one module needs (the passenger module's Valor da Causa
 * Pedido and its partner agency) is the module's own setup, opened after this
 * one for each module the firm contracted (0081). How the firm files on the
 * courts' screens comes right after the bar (the owner's three ways,
 * 2026-11-20): the registrations say which courts its lawyers file in, and who
 * answers and signs gives their own court login in the same step (0263). How
 * the firm works and the areas it works in come before the channel, the last
 * step: ONE answers
 * nobody new on the WhatsApp before it knows the firm (0256, the owner,
 * 2026-11-20); the firm's logo and colour (0258) come before them, and the
 * firm's profile (0272), which ONE writes and the firm approves, then the
 * script of each area of the firm that no module serves (0273), which ONE
 * writes with the profile and the firm publishes, right before the channel.
 */
export const SETUP_STEPS = [
  "seguranca",
  "oab",
  "protocolo",
  "escritorio",
  "operacao",
  "equipe",
  "papeis",
  "personalidade",
  "areas",
  "canal",
] as const;

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
