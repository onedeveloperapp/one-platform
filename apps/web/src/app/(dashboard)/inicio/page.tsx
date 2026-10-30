import { loadSetupState } from "../configurar/setup-state";
import SetupView, { type SetupState } from "../configurar/setup-view";
import HomeView, { type HomeState } from "./home-view";

import { attentionGroups, pendingGroups, readFirmPending } from "@/lib/firm/pending";
import { isManager } from "@/lib/firm/roles";
import { readFirmToday, todayViewerOf } from "@/lib/firm/today";
import { getMemberContext } from "@/lib/member/context";
import { readModuleOffer } from "@/lib/modules/offer-read";
import { getActivationFacts, isSetupAnswered, onboardingFlowKey } from "@/lib/onboarding";
import { readFirmPartners } from "@/lib/partners/facts";
import { testChatCardOf } from "@/lib/test-chat/test-chat";
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
 * Under the title, the modules the firm contracted and the ones to come
 * (`product_modules`, migration 0075); after what needs somebody, the quick
 * ways into each module the firm uses: its partner agencies with what the firm
 * has of them (`firm_partnership_facts`), the cases that came from them, and,
 * to who manages the firm while it is on, the test chat.
 */
async function loadHome(): Promise<HomeState | { kind: "setup"; setup: SetupState }> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };

  const firm = context.firm;
  const manager = isManager(firm.role);
  const viewer = todayViewerOf(firm);
  const flowKey = onboardingFlowKey(context.userId, firm.id);

  const [today, pending, facts, checklist, modules, partners, testChat] = await Promise.all([
    context.supabase.rpc("firm_today", { target_org: firm.id }),
    context.supabase.rpc("firm_pending", { target_org: firm.id }),
    // The setup is for who can do something about it: who manages the firm.
    manager ? getActivationFacts(context.supabase, firm.id) : Promise.resolve(null),
    manager ? getOnboardingState(context.supabase, flowKey) : Promise.resolve(null),
    // What the firm contracted, and its partners: each read that fails hides its part, and the home stands.
    readModuleOffer(context).catch(() => null),
    readFirmPartners(context).catch(() => null),
    manager
      ? context.supabase.rpc("test_chat_link", { target_org: firm.id }).then(
          ({ data, error }) => (error ? null : testChatCardOf(data)),
          () => null,
        )
      : Promise.resolve(null),
  ]);
  if (facts && !isSetupAnswered(facts)) return { kind: "setup", setup: await loadSetupState(context) };
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
    setup: facts && checklist ? { flowKey, state: checklist, facts } : null,
    modules,
    partners: partners?.kind === "ready" ? partners : null,
    testChat: testChat?.on && testChat.token ? `/t/${testChat.token}` : null,
  };
}

export default async function HomePage() {
  const home = await loadHome();
  return home.kind === "setup" ? <SetupView state={home.setup} /> : <HomeView state={home} />;
}
