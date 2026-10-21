import HomeView, { type HomeState } from "./home-view";

import { isManager } from "@/lib/firm/roles";
import { readFirmToday } from "@/lib/firm/today";
import { getMemberContext } from "@/lib/member/context";
import { getActivationFacts, onboardingFlowKey } from "@/lib/onboarding";
import { getOnboardingState } from "@flyee/onboarding";

/**
 * /inicio: what needs somebody of the firm today. One question, answered by
 * the database for the person who asks (`firm_today`, migration 0020):
 * conversations nobody answered and the ones about to lose their 24 hours,
 * the answers of the AI this person decides, the messages that did not go
 * out. Who manages a firm that is still being set up also sees what is
 * missing, from facts (`firm_setup_facts`). Deadlines, hearings and cases
 * join the same answer as their milestones arrive.
 */
async function loadHome(): Promise<HomeState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };

  const firm = context.firm;
  const manager = isManager(firm.role);
  const flowKey = onboardingFlowKey(context.userId, firm.id);

  const [today, facts, checklist] = await Promise.all([
    context.supabase.rpc("firm_today", { target_org: firm.id }),
    // The setup is for who can do something about it: who manages the firm.
    manager ? getActivationFacts(context.supabase, firm.id) : Promise.resolve(null),
    manager ? getOnboardingState(context.supabase, flowKey) : Promise.resolve(null),
  ]);
  const read = today.error ? null : readFirmToday(today.data);
  if (!read) return { kind: "error" };

  return {
    kind: "ready",
    firstName: context.profile.displayName.trim().split(/\s+/)[0] ?? "",
    firm: { name: firm.name },
    manager,
    today: read,
    triagesPublications:
      firm.firmFunction === "socio" || firm.firmFunction === "advogado" || firm.firmFunction === "controladoria",
    worksDeadlines:
      firm.firmFunction === "socio" || firm.firmFunction === "advogado" || firm.firmFunction === "controladoria",
    confirmsDeadlines: firm.firmFunction === "socio" || firm.firmFunction === "controladoria",
    // Facts that could not be read show no checklist, never one that calls a finished step missing.
    setup: facts && checklist ? { flowKey, state: checklist, facts } : null,
  };
}

export default async function HomePage() {
  return <HomeView state={await loadHome()} />;
}
