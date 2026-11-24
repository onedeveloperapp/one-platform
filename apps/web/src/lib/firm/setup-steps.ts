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
 * one for each module the firm contracted (0081). The order is the owner's of
 * 2026-11-24 (the canvas "Configuração do escritório, antes e depois"): who
 * answers, then the firm's documents (its letterhead, the power of attorney
 * and the fee contract its clients sign, its logo, and the data ONE reads from
 * them: the papers were a step of their own, which asked the power of attorney
 * and the address a second time), how the firm works and its areas, its team,
 * then how it files on the courts' screens (the owner's three ways,
 * 2026-11-20, 0263), which needs the states, the areas and whether ONE
 * prepares the filing packages at all. ONE answers nobody new on the WhatsApp
 * before it knows the firm (0256): its profile (0272), which ONE writes and the
 * firm approves, then the script of each area no module serves (0273), come
 * right before the channel, the last step, which also says how the client
 * signs.
 */
export const SETUP_STEPS = [
  "seguranca",
  "oab",
  "escritorio",
  "operacao",
  "equipe",
  "protocolo",
  "personalidade",
  "areas",
  "canal",
] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number];

export const isSetupStep = (value: unknown): value is SetupStepKey =>
  (SETUP_STEPS as readonly unknown[]).includes(value);

/** Addresses of steps that were merged into another: a link kept from before still opens where the thing is now. */
const MOVED_STEPS: Record<string, SetupStepKey> = { papeis: "escritorio" };

/** The step an address names (`?passo=`), a moved one included; null for anything else. */
export const setupStepOf = (value: unknown): SetupStepKey | null =>
  isSetupStep(value) ? value : typeof value === "string" ? (MOVED_STEPS[value] ?? null) : null;

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
