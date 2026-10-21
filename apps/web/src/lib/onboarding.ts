import { DEFAULTS } from "@/config";
import { type FlowKey, type OnboardingStep } from "@flyee/onboarding";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The firm's setup checklist. A step is done when the thing exists in the
 * database, never because somebody clicked it: the facts come from
 * `firm_setup_facts` (migration 0020), computed on every read, so the
 * checklist is right even when the work happened somewhere else (a colleague
 * registered at the bar, the number was connected from another session).
 *
 * The setup belongs to the firm: every person of it reads the same facts.
 * What each person keeps for themselves is only whether they dismissed the
 * card (`onboarding_state`, one row per person and firm).
 *
 * The steps of M1 are what M1 built. The signature provider and the document
 * templates enter with the screens that connect them (M2); a step is never
 * declared before its screen exists.
 */
export const ONBOARDING_FLOW = "firm-setup";

/** The setup is the firm's, not each person's. */
export const ONBOARDING_ORG_SCOPED = true;

/** The facts the steps are derived from, by name. */
export type ActivationFacts = Record<string, boolean>;

/**
 * The steps in order. Titles are `product` message keys, `fact` names the
 * fact of `firm_setup_facts` that closes the step, and `href` is where the
 * person does it.
 */
const STEP_DEFINITIONS: (Omit<OnboardingStep, "done"> & { fact: string })[] = [
  { key: "firm-document", title: "setup-step-firm-document", href: "/settings/billing", fact: "firm_document" },
  { key: "oab", title: "setup-step-oab", href: "/settings/team", fact: "oab" },
  { key: "team", title: "setup-step-team", href: "/settings/team", fact: "team" },
  { key: "whatsapp", title: "setup-step-whatsapp", href: "/settings/connections", fact: "whatsapp" },
];

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

/** Every declared step is done. */
export function isActivated(facts: ActivationFacts): boolean {
  return buildOnboardingSteps(facts).every((step) => step.done);
}

/** The steps the checklist renders, each done or not by its fact. */
export function buildOnboardingSteps(facts?: ActivationFacts): OnboardingStep[] {
  return STEP_DEFINITIONS.map(({ fact, ...step }) => ({ ...step, done: facts ? facts[fact] === true : undefined }));
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
