/**
 * The steps of the firm's setup (`/configurar`), in order, by the name the
 * address gives each (`?passo=`): the list on the home leads to the very step
 * something is missing in, so whoever left the setup comes back to it, never
 * to another screen. The last, the partner agency, is shown only to a firm
 * whose module has a partner (the passenger module's travel agency), and is
 * never missing: a firm with no agency lacks nothing.
 */
export const SETUP_STEPS = ["oab", "valores", "equipe", "papeis", "canal", "agencia"] as const;

export type SetupStepKey = (typeof SETUP_STEPS)[number];

export const isSetupStep = (value: unknown): value is SetupStepKey =>
  (SETUP_STEPS as readonly unknown[]).includes(value);

/** Where a step of the setup opens. */
export const setupHref = (step: SetupStepKey): string => `/configurar?passo=${step}`;
