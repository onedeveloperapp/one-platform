import { loadPersonSetupState } from "../configurar/person-setup-state";
import PersonSetupView, { type PersonSetupState } from "../configurar/person-setup-view";
import { loadSetupState } from "../configurar/setup-state";
import SetupView, { type SetupState } from "../configurar/setup-view";
import HomeView, { type HomeState } from "./home-view";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { attentionGroups, pendingGroups, readFirmPending } from "@/lib/firm/pending";
import { personFlowKey, personSetupOwed, signsAtTheBar } from "@/lib/firm/person-setup";
import { isManager } from "@/lib/firm/roles";
import { readFirmToday, todayViewerOf } from "@/lib/firm/today";
import { getMemberContext } from "@/lib/member/context";
import { readModuleSetups } from "@/lib/modules/module-setups-read";
import { readModuleOffer } from "@/lib/modules/offer-read";
import { getActivationFacts, isSetupAnswered, onboardingFlowKey, waitsFirstCase } from "@/lib/onboarding";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";
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
 * Anybody else of the firm whose own work still owes something (the second
 * factor, or a lawyer's registration at the bar, by which ONE reads their
 * publications) is asked it here too, in place, until they answer it once
 * (2026-11-03); a lawyer who set the registration aside is reminded of it.
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
async function loadHome(): Promise<
  HomeState | { kind: "setup"; setup: SetupState } | { kind: "person-setup"; setup: PersonSetupState }
> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };

  const firm = context.firm;
  const manager = isManager(firm.role);
  const t = await getTranslations("product");
  const viewer = todayViewerOf(firm);
  const flowKey = onboardingFlowKey(context.userId, firm.id);

  const [today, pending, facts, checklist, modules, personFlow, ownRegistration, assurance, cookieStore, moduleSetups] =
    await Promise.all([
      context.supabase.rpc("firm_today", { target_org: firm.id }),
      context.supabase.rpc("firm_pending", { target_org: firm.id }),
      // The firm's facts: its setup, for who can do something about it (who manages the firm), and, for everybody,
      // whether a case ever reached it.
      getActivationFacts(context.supabase, firm.id),
      manager ? getOnboardingState(context.supabase, flowKey) : Promise.resolve(null),
      // What the firm contracted: a read that fails hides the quick access, and the home stands.
      readModuleOffer(context).catch(() => null),
      // The person's own setup: whether they answered it, their registration at the bar and their factor.
      getOnboardingState(context.supabase, personFlowKey(context.userId, firm.id)),
      context.supabase.from("oab_registrations").select("id").eq("user_id", context.userId).limit(1),
      context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      cookies(),
      // Each module the firm contracted that has a setup of its own (0081), for who manages the firm's list.
      manager ? readModuleSetups(context).catch(() => null) : Promise.resolve(null),
    ]);
  if (manager && facts && !isSetupAnswered(facts)) return { kind: "setup", setup: await loadSetupState(context) };
  // Read failures owe nothing: a registration that could not be read is never said to be missing.
  const registered = ownRegistration.error ? true : (ownRegistration.data ?? []).length > 0;
  const owed = personSetupOwed({
    hasFactor: assurance.error ? true : assurance.data?.nextLevel === "aal2",
    firmFunction: firm.firmFunction,
    registered,
  });
  if (owed && !personFlow.completedAt && !cookieStore.has(IMPERSONATION_MARKER_COOKIE)) {
    return { kind: "person-setup", setup: await loadPersonSetupState(context) };
  }
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
    setup:
      manager && facts && checklist
        ? {
            flowKey,
            state: checklist,
            facts,
            moduleSteps: (moduleSetups ?? []).map((setup) => ({
              key: `module:${setup.key}`,
              title: t("setup-step-module", { module: setup.name }),
              href: setup.href,
              done: setup.answered,
            })),
          }
        : null,
    waitsFirstCase: waitsFirstCase(facts),
    ownRegistrationMissing: signsAtTheBar(firm.firmFunction) && !registered,
    modules,
  };
}

export default async function HomePage() {
  const home = await loadHome();
  if (home.kind === "setup") return <SetupView state={home.setup} />;
  if (home.kind === "person-setup") return <PersonSetupView state={home.setup} />;
  return <HomeView state={home} />;
}
