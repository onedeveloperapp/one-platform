import { DEFAULTS } from "@/config";
import { setupHref } from "@/lib/firm/setup-steps";
import { type FlowKey, type OnboardingStep } from "@flyee/onboarding";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The firm's setup checklist. A step is done when the thing exists in the
 * database, never because somebody clicked it: the facts come from
 * `firm_setup_facts` (migrations 0020 and 0044), computed on every read, so the
 * checklist is right even when the work happened somewhere else (a colleague
 * registered at the bar, the number was connected from another session).
 *
 * The setup belongs to the firm: every person of it reads the same facts.
 * What each person keeps for themselves is only whether they dismissed the
 * card (`onboarding_state`, one row per person and firm).
 *
 * The list holds only what the firm gives ONE for it to work: a lawyer at
 * the bar chosen to sign what ONE prepares, the team where there is one and
 * a way to the clients. Nothing ONE does by itself is on it: the first case
 * arrives through a module the firm contracted and ONE opens it (a
 * passenger's yes to ONE's word about a flight, an agency's passenger), so
 * a step "open the first case" would tell the firm the work is manual (the
 * owner, 2026-11-03); the home says ONE waits for it instead (`first_case`
 * of the same facts). The Valor da Causa Pedido is the
 * firm's to give or not (0064: with none, a lawsuit goes with no value and
 * the judge defines it), so it is chosen in the setup and never listed as
 * missing. The CNPJ is asked when the firm subscribes, and a firm that said
 * it works alone has no team to invite (0044). Each step of the setup leads
 * back to its own step of `/configurar`, where it is done without leaving
 * for another screen.
 */
export const ONBOARDING_FLOW = "firm-setup";

/** The setup is the firm's, not each person's. */
export const ONBOARDING_ORG_SCOPED = true;

/** The facts the steps are derived from, by name. */
export type ActivationFacts = Record<string, boolean>;

/**
 * The steps in order. Titles are `product` message keys, `fact` names the
 * fact of `firm_setup_facts` that closes the step, `href` is where the
 * person does it, and `hiddenWhen` names a fact that takes the step out of
 * the list (a firm that works alone has no team to invite).
 */
const STEP_DEFINITIONS: (Omit<OnboardingStep, "done"> & { fact: string; hiddenWhen?: string })[] = [
  { key: "oab", title: "setup-step-oab", href: setupHref("oab"), fact: "oab_signer" },
  { key: "office", title: "setup-step-office", href: setupHref("escritorio"), fact: "brand" },
  { key: "operation", title: "setup-step-operation", href: setupHref("operacao"), fact: "operation" },
  { key: "team", title: "setup-step-team", href: setupHref("equipe"), fact: "team", hiddenWhen: "works_alone" },
  { key: "personality", title: "setup-step-personality", href: setupHref("personalidade"), fact: "personality" },
  { key: "channel", title: "setup-step-channel", href: setupHref("canal"), fact: "channel" },
];

/** No case ever reached the firm: ONE waits for the first, which a module brings and ONE opens (never a step). */
export function waitsFirstCase(facts: ActivationFacts | null): boolean {
  return facts?.first_case === false;
}

/**
 * Reads what the firm has in place, under the person's own session. Any
 * failure reads as "nothing known": the caller then shows no checklist at
 * all, never one that says a finished step is missing.
 */
export async function getActivationFacts(supabase: SupabaseClient, orgId: string): Promise<ActivationFacts | null> {
  const { data, error } = await supabase.rpc("firm_setup_facts", { target_org: orgId });
  if (error || typeof data !== "object" || data === null || Array.isArray(data)) return null;
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>).map(([key, value]) => [key, value === true]),
  );
}

/** Every step of the firm's list is done. */
export function isActivated(facts: ActivationFacts): boolean {
  return buildOnboardingSteps(facts).every((step) => step.done);
}

/** The first questions of the setup were answered or set aside (0044). */
export function isSetupAnswered(facts: ActivationFacts): boolean {
  return facts.setup_answered === true;
}

/**
 * The steps the checklist renders, each done or not by its fact. With no
 * facts (the shape only), every step is listed.
 */
export function buildOnboardingSteps(facts?: ActivationFacts): OnboardingStep[] {
  return STEP_DEFINITIONS.filter((step) => !(facts && step.hiddenWhen && facts[step.hiddenWhen] === true)).map(
    (step) => ({
      key: step.key,
      title: step.title,
      href: step.href,
      done: facts ? facts[step.fact] === true : undefined,
    }),
  );
}

/** Step definitions without live state, used where only the shape matters. */
export const ONBOARDING_STEPS: OnboardingStep[] = buildOnboardingSteps();

export const isOnboardingEnabled = ONBOARDING_STEPS.length > 0;

/** The key of the row that keeps what one person did with the firm's checklist (dismissed it or not). */
export const onboardingFlowKey = (userId: string, orgId: string): FlowKey => ({ userId, orgId, flow: ONBOARDING_FLOW });

/**
 * Where a user goes right after signing up / signing in: the one place that
 * decides it, called from the auth entry points (never the middleware, which
 * runs on every request and must stay query-free). It is always the app root:
 * the home is where the setup checklist waits for who manages a new firm, so
 * nobody is held on a setup screen before seeing the product. Auth must never
 * dead-end, so this decides without reading anything.
 */
export async function resolvePostAuthDestination(): Promise<string> {
  return DEFAULTS.appRoot;
}
