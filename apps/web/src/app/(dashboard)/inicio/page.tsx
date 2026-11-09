import { loadPersonSetupState } from "../configurar/person-setup-state";
import PersonSetupView, { type PersonSetupState } from "../configurar/person-setup-view";
import { loadSetupState } from "../configurar/setup-state";
import SetupView, { type SetupState } from "../configurar/setup-view";
import HomeView, { type HomeState } from "./home-view";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { readWaitingDecisions } from "@/lib/ai/decisions-read";
import { cloudSigningOffered } from "@/lib/cases/filing-facts";
import { readCaseList, readCaseStock } from "@/lib/cases/list-read";
import { firmPulseOf } from "@/lib/cases/pulse";
import { readFilingAttention } from "@/lib/firm/filing-attention";
import { attentionGroups, pendingGroups, readFirmPending } from "@/lib/firm/pending";
import { personFlowKey, personSetupOwed, signsAtTheBar } from "@/lib/firm/person-setup";
import { readPublicationAcks } from "@/lib/firm/publication-acks";
import { isManager } from "@/lib/firm/roles";
import { readFirmToday, todayViewerOf } from "@/lib/firm/today";
import { getMemberContext } from "@/lib/member/context";
import { readModuleSetups } from "@/lib/modules/module-setups-read";
import { readModuleOffer } from "@/lib/modules/offer-read";
import { getActivationFacts, isSetupAnswered, onboardingFlowKey, waitsFirstCase } from "@/lib/onboarding";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";
import { getOnboardingState } from "@flyee/onboarding";

/** How many of the latest cases in progress the home shows; the list of them all is one click further. */
const RECENT_CASES = 5;

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
 * After what needs somebody today, where the firm's cases are along their
 * way, by the rule of the top of the case (`firm_case_stock`, 0111), as the
 * controladoria's board reads them: how many at each step, each opening the
 * list of those cases (0116), so the list has the size the step says.
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

  const [
    today,
    pending,
    facts,
    checklist,
    modules,
    personFlow,
    ownRegistration,
    assurance,
    cookieStore,
    moduleSetups,
    stock,
    recent,
    pulse,
    decisions,
    filing,
    cloudSigning,
    acks,
  ] = await Promise.all([
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
    // Where the firm's cases are along their way, by the rule of the top of the case (0111): a read that fails hides
    // the card, and the home stands.
    readCaseStock(context.supabase, firm.id, { module: null }).catch(() => null),
    // The latest cases in progress, each in a line with its way in small (the owner, 2026-11-03): the list's own
    // read (`firm_cases`, the latest moved first), whose failure leaves the card with its counts alone.
    readCaseList(context.supabase, firm.id, {
      filter: null,
      search: "",
      module: null,
      page: 0,
      pageSize: RECENT_CASES,
    }).catch(() => null),
    // The mark of what the home shows (0096), for it to follow the firm while open; unreadable, it is read again by
    // the person, as before.
    context.supabase
      .rpc("firm_pulse", { target_org: firm.id })
      .then(({ data, error }) => (error ? null : firmPulseOf(data))),
    // Each decision that waits for this person, placed where it is decided (its case, its conversation); unread,
    // the home counts them as before.
    readWaitingDecisions(context.supabase, firm.id, firm.firmFunction).catch(() => null),
    // What ONE's filing waits on a person for (0102), as the center says it; unread, the rest stands.
    context.supabase
      .rpc("firm_filing_attention", { target_org: firm.id })
      .then(({ data, error }) => (error ? null : readFilingAttention(data))),
    cloudSigningOffered(context.supabase).catch(() => false),
    // The awareness of ONE's triage of the publications owed (0104), as the center says it.
    context.supabase
      .rpc("firm_publication_acks", { target_org: firm.id })
      .then(({ data, error }) => (error ? null : readPublicationAcks(data))),
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
    attention: waiting
      ? attentionGroups(
          pendingGroups(
            read,
            waiting,
            viewer,
            new Date(),
            decisions,
            filing
              ? {
                  attention: filing,
                  viewer: {
                    userId: context.userId,
                    firmFunction: firm.firmFunction,
                    managesFirm: viewer.managesFirm,
                    cloudSigning,
                    timeZone: context.profile.timezone,
                  },
                }
              : null,
            acks ? { acks, viewer: { userId: context.userId, firmFunction: firm.firmFunction } } : null,
          ),
        )
      : null,
    decisions,
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
    progress: stock ? { stock, ended: recent ? recent.counts.ended : null, recent: recent ? recent.rows : [] } : null,
    pulse,
  };
}

export default async function HomePage() {
  const home = await loadHome();
  if (home.kind === "setup") return <SetupView state={home.setup} />;
  if (home.kind === "person-setup") return <PersonSetupView state={home.setup} />;
  return <HomeView state={home} />;
}
