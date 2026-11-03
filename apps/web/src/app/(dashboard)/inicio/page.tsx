import { loadSetupState } from "../configurar/setup-state";
import SetupView, { type SetupState } from "../configurar/setup-view";
import HomeView, { type HomeState } from "./home-view";

import { attentionGroups, pendingGroups, readFirmPending } from "@/lib/firm/pending";
import { isManager } from "@/lib/firm/roles";
import { readFirmToday, todayViewerOf } from "@/lib/firm/today";
import { getMemberContext } from "@/lib/member/context";
import { readModuleOffer } from "@/lib/modules/offer-read";
import { getActivationFacts, isSetupAnswered, onboardingFlowKey, waitsFirstCase } from "@/lib/onboarding";
import { getOnboardingState } from "@flyee/onboarding";

/**
 * /inicio: what needs somebody of the firm today. One question, answered by
 * the database for the person who asks (`firm_today`, migration 0020):
 * conversations nobody answered and the ones about to lose their 24 hours,
 * the answers of the AI this person decides, the messages that did not go
 * out. Who manages a firm that is still being set up also sees what is
 * missing, from facts (`firm_setup_facts`). Deadlines, hearings and cases
 * join the same answer as their milestones arrive.
 *
 * First of all, every item that holds a case until somebody of the firm acts
 * (`firm_pending`, the same lines as the center of the header), each with
 * its kind named and its colour: what passed its time in red, what waits on
 * the firm in the accent of "look at this".
 *
 * Who manages a firm whose first questions were never answered is asked them
 * here, before the home (the screen of `/configurar`, migration 0044):
 * answered or set aside once, they are never asked again. They are shown in
 * place, never by a redirect: a page of the logged area streams inside the
 * shell, so a redirect would be the client router's, a path that broke the
 * screen in the production build.
 *
 * While no case ever reached the firm, the home says ONE waits for the
 * first one, which a module brings and ONE opens: never a step of the
 * firm's list, which would say the work is manual (the owner, 2026-11-03).
 *
 * Under the title, the quick access to ONE's modules (`product_modules`,
 * migrations 0075 and 0078): each module the firm contracted opens its own
 * area, where everything only that module has lives (its partner agencies,
 * its test chat, its portfolio); the ones to come say so.
 */
async function loadHome(): Promise<HomeState | { kind: "setup"; setup: SetupState }> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };

  const firm = context.firm;
  const manager = isManager(firm.role);
  const viewer = todayViewerOf(firm);
  const flowKey = onboardingFlowKey(context.userId, firm.id);

  const [today, pending, facts, checklist, modules] = await Promise.all([
    context.supabase.rpc("firm_today", { target_org: firm.id }),
    context.supabase.rpc("firm_pending", { target_org: firm.id }),
    // The firm's facts: its setup, for who can do something about it (who manages the firm), and, for everybody,
    // whether a case ever reached it.
    getActivationFacts(context.supabase, firm.id),
    manager ? getOnboardingState(context.supabase, flowKey) : Promise.resolve(null),
    // What the firm contracted: a read that fails hides the quick access, and the home stands.
    readModuleOffer(context).catch(() => null),
  ]);
  if (manager && facts && !isSetupAnswered(facts)) return { kind: "setup", setup: await loadSetupState(context) };
  const read = today.error ? null : readFirmToday(today.data);
  if (!read) return { kind: "error" };
  const waiting = pending.error ? null : readFirmPending(pending.data);

  return {
    kind: "ready",
    firstName: context.profile.displayName.trim().split(/\s+/)[0] ?? "",
    firm: { name: firm.name },
    manager,
    today: read,
    // What holds a case until somebody of the firm acts, as the center of the header says it (0044, 0053); null
    // when it could not be read, which the home says, never as nothing waiting.
    attention: waiting ? attentionGroups(pendingGroups(read, waiting, viewer)) : null,
    triagesPublications: viewer.triagesPublications,
    worksDeadlines: viewer.worksDeadlines,
    confirmsDeadlines: viewer.confirmsDeadlines,
    // Facts that could not be read show no checklist, never one that calls a finished step missing.
    setup: manager && facts && checklist ? { flowKey, state: checklist, facts } : null,
    waitsFirstCase: waitsFirstCase(facts),
    modules,
  };
}

export default async function HomePage() {
  const home = await loadHome();
  return home.kind === "setup" ? <SetupView state={home.setup} /> : <HomeView state={home} />;
}
