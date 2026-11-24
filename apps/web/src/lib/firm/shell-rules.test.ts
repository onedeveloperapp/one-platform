import { describe, expect, it } from "vitest";

import { canAccess, type MenuViewer, visibleItems } from "@/lib/firm/menu";
import { isSetupStep, SETUP_STEPS, setupOpening, setupStepOf } from "@/lib/firm/setup-steps";
import { type FirmToday, readFirmToday, somethingForMe, todayNeeds } from "@/lib/firm/today";
import {
  buildOnboardingSteps,
  isActivated,
  isOnboardingEnabled,
  isSetupAnswered,
  ONBOARDING_ORG_SCOPED,
  waitsFirstCase,
} from "@/lib/onboarding";
import { leftMenuBottomItems, leftMenuItems } from "@/menu-items";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;
const dashboard = messages.dashboard as Record<string, string>;

const viewer = (changes: Partial<MenuViewer> = {}): MenuViewer => ({
  hasFirm: true,
  role: "member",
  firmFunction: "atendimento",
  modules: ["direito-do-passageiro"],
  moduleMenu: [
    { key: "direito-do-passageiro", name: "Direito do Passageiro", icon: "NiPlane", state: "contracted" },
    { key: "direito-previdenciario", name: "Direito Previdenciário", icon: "NiUmbrella", state: "soon" },
  ],
  partner: false,
  isSuperadmin: false,
  owesSecondFactor: false,
  ...changes,
});

const operator = viewer({ hasFirm: false, role: null, firmFunction: null, isSuperadmin: true });
const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("the menu by role", () => {
  it("shows an item that says nothing to anybody of a firm", () => {
    for (const firmFunction of ["socio", "advogado", "controladoria", "atendimento"] as const) {
      expect(canAccess(undefined, viewer({ firmFunction }))).toBe(true);
    }
  });

  it("keeps what is for who manages the firm from everybody else", () => {
    expect(canAccess({ manager: true }, viewer({ role: "owner" }))).toBe(true);
    expect(canAccess({ manager: true }, viewer({ role: "admin" }))).toBe(true);
    expect(canAccess({ manager: true }, viewer({ role: "member", firmFunction: "socio" }))).toBe(false);
  });

  it("shows what reads the firm as a whole to a partner, the controladoria and who manages the firm", () => {
    const oversees = { oversees: true };
    expect(canAccess(oversees, viewer({ role: "member", firmFunction: "socio" }))).toBe(true);
    expect(canAccess(oversees, viewer({ role: "member", firmFunction: "controladoria" }))).toBe(true);
    expect(canAccess(oversees, viewer({ role: "admin", firmFunction: "atendimento" }))).toBe(true);
    expect(canAccess(oversees, viewer({ role: "member", firmFunction: "advogado" }))).toBe(false);
    expect(canAccess(oversees, viewer({ role: "member", firmFunction: "atendimento" }))).toBe(false);
  });

  it("shows an item of some functions to those functions only", () => {
    const access = { functions: ["socio", "advogado"] as const };
    expect(canAccess(access, viewer({ firmFunction: "advogado" }))).toBe(true);
    expect(canAccess(access, viewer({ firmFunction: "atendimento" }))).toBe(false);
    // The role over the firm account does not stand in for the function.
    expect(canAccess(access, viewer({ role: "owner", firmFunction: "controladoria" }))).toBe(false);
  });

  it("shows the consoles to the platform operator only, and the firm's items to nobody without a firm", () => {
    expect(canAccess({ operator: true }, operator)).toBe(true);
    expect(canAccess({ operator: true }, viewer({ role: "owner" }))).toBe(false);
    expect(canAccess(undefined, operator)).toBe(false);
    expect(canAccess({ withoutFirm: true }, operator)).toBe(true);
    // An account that just signed up and founded no firm yet: nothing of a firm, its own settings.
    const newcomer = viewer({ hasFirm: false, role: null, firmFunction: null });
    expect(canAccess(undefined, newcomer)).toBe(false);
    expect(canAccess({ withoutFirm: true }, newcomer)).toBe(true);
  });

  it("with nobody to read (a clone without Supabase) shows the firm's items and never the operator's", () => {
    expect(canAccess(undefined, null)).toBe(true);
    expect(canAccess({ manager: true }, null)).toBe(true);
    expect(canAccess({ operator: true }, null)).toBe(false);
    expect(canAccess({ partner: true }, null)).toBe(false);
  });

  it("shows somebody of a partner its area, in the modules of its partnerships, and nothing of a firm", () => {
    const agency = viewer({ hasFirm: false, role: null, firmFunction: null, partner: true });
    expect(canAccess({ partner: true }, agency)).toBe(true);
    expect(canAccess({ partner: true, module: "direito-do-passageiro" }, agency)).toBe(true);
    expect(canAccess({ partner: true, module: "outro-modulo" }, agency)).toBe(false);
    expect(canAccess({ withoutFirm: true }, agency)).toBe(true);
    expect(canAccess(undefined, agency)).toBe(false);
    expect(canAccess({ manager: true }, agency)).toBe(false);
    // Nobody of a firm sees the partner's area.
    expect(canAccess({ partner: true }, viewer({ role: "owner" }))).toBe(false);
  });

  it("shows an item of a module to a firm that uses it only", () => {
    expect(canAccess({ module: "direito-do-passageiro" }, viewer())).toBe(true);
    expect(canAccess({ module: "outro-modulo" }, viewer())).toBe(false);
  });

  it("gives each person the menu that is theirs", () => {
    expect(ids(visibleItems(leftMenuItems, viewer()))).toEqual([
      "inicio",
      "casos",
      // The firm's people are anybody of the firm's to find (0133); the money is not in them.
      "pessoas",
      // What ONE did is the whole firm's to read (0120 to 0122); the money in it is who decides for the firm's.
      "trabalho-do-one",
      "atendimento",
      "protocolo",
      "publicacoes",
      "prazos",
      "agenda",
      "biblioteca",
    ]);
    expect(ids(visibleItems(leftMenuItems, viewer({ role: "owner", firmFunction: "socio" })))).toEqual([
      "inicio",
      "casos",
      "pessoas",
      "controladoria",
      // The firm's numbers are who oversees the firm's (0136).
      "numeros",
      "trabalho-do-one",
      "atendimento",
      "protocolo",
      "publicacoes",
      "prazos",
      "agenda",
      "biblioteca",
    ]);
    expect(ids(visibleItems(leftMenuItems, operator))).toEqual(["admin"]);
    expect(ids(visibleItems(leftMenuBottomItems, operator))).toEqual(["settings"]);
    expect(ids(visibleItems(leftMenuBottomItems, viewer()))).toEqual(["settings"]);
    // The children of a group are kept with it.
    expect(visibleItems(leftMenuItems, operator)[0].children?.length).toBeGreaterThan(5);
  });

  it("has no menu of the modules: a module's cases are the cases under it, and the overview is in the settings", () => {
    // The owner, 2026-11-14: the access is almost always through Casos, and the module's area repeated pages the
    // menu already has.
    expect(ids(visibleItems(leftMenuItems, viewer()))).not.toContain("modulos");
  });

  it("has a label for every item it can show", () => {
    for (const item of [...leftMenuItems, ...leftMenuBottomItems]) {
      expect(dashboard[item.label], item.label).toBeTruthy();
      for (const child of item.children ?? []) expect(dashboard[child.label], child.label).toBeTruthy();
      // The link to a group's own page beside its submenu's title: its own words, or "Todos".
      if (item.overviewLabel) expect(dashboard[item.overviewLabel], item.overviewLabel).toBeTruthy();
    }
    expect(dashboard["menu-all"]).toBeTruthy();
    expect(dashboard["menu-overview-aria"]).toBeTruthy();
  });
});

const quiet: FirmToday = {
  approvalsMine: 0,
  approvalsWaiting: 0,
  conversationsWaiting: 0,
  conversationsClosing: 0,
  sendsFailed: 0,
  whatsapp: "active",
  documentsToReview: 0,
  clientsFinished: 0,
  chronologiesContested: 0,
  complaintsOverdue: 0,
  filingsReady: 0,
  draftsWaiting: 0,
  publicationsNew: 0,
  publicationsCancelled: 0,
  publicationsToReview: 0,
  djenLate: 0,
  djenIncomplete: 0,
  djenStopped: 0,
  movementsNew: 0,
  trackingFailed: 0,
  deadlinesToConfirm: 0,
  deadlinesSoon: 0,
  deadlinesOverdue: 0,
  deadlinesReview: 0,
  publicationsWithoutDeadline: 0,
  publicationsWithoutHearing: 0,
  hearingsSoon: 0,
  hearingsUnresolved: 0,
  calendarLost: 0,
  hearingsUnwarned: 0,
  civilCourtDeclined: 0,
};

describe("what needs somebody today", () => {
  it("reads the database's answer, and refuses one that is not what was expected", () => {
    expect(
      readFirmToday({
        approvals_mine: 1,
        approvals_waiting: 2,
        conversations_waiting: 3,
        conversations_closing: 1,
        sends_failed: 0,
        whatsapp: "disconnected",
        documents_to_review: 4,
        clients_finished: 1,
        chronologies_contested: 2,
        complaints_overdue: 1,
        filings_ready: 3,
        drafts_waiting: 2,
        publications_new: 7,
        publications_cancelled: 1,
        publications_to_review: 4,
        djen_late: 2,
        djen_incomplete: 1,
        djen_stopped: 0,
        movements_new: 3,
        tracking_failed: 1,
        deadlines_to_confirm: 2,
        deadlines_soon: 1,
        deadlines_overdue: 0,
        deadlines_review: 1,
        publications_without_deadline: 2,
        publications_without_hearing: 1,
        hearings_soon: 3,
        hearings_unresolved: 1,
        calendar_lost: 0,
        hearings_unwarned: 2,
        civil_court_declined: 1,
      }),
    ).toEqual({
      approvalsMine: 1,
      approvalsWaiting: 2,
      conversationsWaiting: 3,
      conversationsClosing: 1,
      sendsFailed: 0,
      whatsapp: "disconnected",
      documentsToReview: 4,
      clientsFinished: 1,
      chronologiesContested: 2,
      complaintsOverdue: 1,
      filingsReady: 3,
      draftsWaiting: 2,
      publicationsNew: 7,
      publicationsCancelled: 1,
      publicationsToReview: 4,
      djenLate: 2,
      djenIncomplete: 1,
      djenStopped: 0,
      movementsNew: 3,
      trackingFailed: 1,
      deadlinesToConfirm: 2,
      deadlinesSoon: 1,
      deadlinesOverdue: 0,
      deadlinesReview: 1,
      publicationsWithoutDeadline: 2,
      publicationsWithoutHearing: 1,
      hearingsSoon: 3,
      hearingsUnresolved: 1,
      calendarLost: 0,
      hearingsUnwarned: 2,
      civilCourtDeclined: 1,
    });
    for (const wrong of [
      null,
      [],
      "texto",
      {},
      { approvals_mine: -1 },
      // An answer from before the deadlines (no count of the ones to confirm) is not this one.
      {
        approvals_mine: 0,
        approvals_waiting: 0,
        conversations_waiting: 0,
        conversations_closing: 0,
        sends_failed: 0,
        whatsapp: "none",
        documents_to_review: 0,
        clients_finished: 0,
        chronologies_contested: 0,
        complaints_overdue: 0,
        filings_ready: 0,
        drafts_waiting: 0,
        publications_new: 0,
        publications_cancelled: 0,
        djen_late: 0,
        djen_incomplete: 0,
        djen_stopped: 0,
        movements_new: 0,
        tracking_failed: 0,
      },
      {
        approvals_mine: 1,
        approvals_waiting: 1,
        conversations_waiting: 0,
        conversations_closing: 0,
        sends_failed: 0,
        whatsapp: "outro",
        documents_to_review: 0,
        clients_finished: 0,
        chronologies_contested: 0,
        complaints_overdue: 0,
        filings_ready: 0,
        drafts_waiting: 0,
        publications_new: 0,
        publications_cancelled: 0,
        djen_late: 0,
        djen_incomplete: 0,
        djen_stopped: 0,
      },
      // An answer from before the pieces (no count of the drafts that wait) is not this one.
      {
        approvals_mine: 0,
        approvals_waiting: 0,
        conversations_waiting: 0,
        conversations_closing: 0,
        sends_failed: 0,
        whatsapp: "none",
        documents_to_review: 0,
        clients_finished: 0,
        chronologies_contested: 0,
        complaints_overdue: 0,
        filings_ready: 0,
        publications_new: 0,
        publications_cancelled: 0,
        djen_late: 0,
        djen_incomplete: 0,
        djen_stopped: 0,
      },
      // An answer with no word of how the reading of the DJEN is doing is not this one.
      {
        approvals_mine: 0,
        approvals_waiting: 0,
        conversations_waiting: 0,
        conversations_closing: 0,
        sends_failed: 0,
        whatsapp: "none",
        documents_to_review: 0,
        clients_finished: 0,
        chronologies_contested: 0,
        complaints_overdue: 0,
        filings_ready: 0,
        publications_new: 0,
      },
      // An answer from before the publications (no count of the ones to triage) is not this one.
      {
        approvals_mine: 0,
        approvals_waiting: 0,
        conversations_waiting: 0,
        conversations_closing: 0,
        sends_failed: 0,
        whatsapp: "none",
        documents_to_review: 0,
        clients_finished: 0,
        chronologies_contested: 0,
        complaints_overdue: 0,
        filings_ready: 0,
      },
      // An answer from before the filing packages (no count of the ones ready) is not this one.
      {
        approvals_mine: 0,
        approvals_waiting: 0,
        conversations_waiting: 0,
        conversations_closing: 0,
        sends_failed: 0,
        whatsapp: "none",
        documents_to_review: 0,
        clients_finished: 0,
        chronologies_contested: 0,
        complaints_overdue: 0,
      },
      // An answer from before the accounts (no count of contested chronologies) is not this one.
      {
        approvals_mine: 0,
        approvals_waiting: 0,
        conversations_waiting: 0,
        conversations_closing: 0,
        sends_failed: 0,
        whatsapp: "none",
        documents_to_review: 0,
        clients_finished: 0,
      },
      // An answer from before the cases (no count of documents) is not this one.
      {
        approvals_mine: 0,
        approvals_waiting: 0,
        conversations_waiting: 0,
        conversations_closing: 0,
        sends_failed: 0,
        whatsapp: "none",
      },
    ]) {
      expect(readFirmToday(wrong)).toBeNull();
    }
  });

  it("shows nothing on a day with nothing waiting", () => {
    expect(todayNeeds(quiet)).toEqual([]);
    expect(somethingForMe(todayNeeds(quiet))).toBe(false);
  });

  it("puts the conversations about to lose their 24 hours first, and counts them once", () => {
    const needs = todayNeeds({
      ...quiet,
      conversationsWaiting: 5,
      conversationsClosing: 2,
      approvalsMine: 1,
      sendsFailed: 3,
      documentsToReview: 6,
      clientsFinished: 2,
      chronologiesContested: 1,
      complaintsOverdue: 4,
      filingsReady: 2,
      draftsWaiting: 5,
      publicationsNew: 9,
      publicationsCancelled: 1,
      publicationsToReview: 2,
      // Two registrations whose reading is late: ONE's own work, never a need of the firm (2026-11-05).
      djenLate: 2,
      // One reading left a communication out, and one stopped for a lawyer still on record.
      djenIncomplete: 1,
      djenStopped: 1,
      // Three lawsuits moved with nobody having seen it, and one reading of the court was given up.
      movementsNew: 3,
      trackingFailed: 1,
      // A claimant said no to the civil court.
      civilCourtDeclined: 1,
      // A deadline past its day, two due in the next days, three to confirm, one to look at again.
      deadlinesOverdue: 1,
      deadlinesSoon: 2,
      deadlinesToConfirm: 3,
      deadlinesReview: 1,
      // Two publications triaged as a deadline that no deadline came from.
      publicationsWithoutDeadline: 2,
    });
    expect(needs.map((need) => [need.key, need.count, need.href])).toEqual([
      ["overdue", 1, "/prazos?ver=vencidos"],
      ["closing", 2, "/atendimento?ver=fechando"],
      ["due", 2, "/prazos?ver=proximos"],
      ["confirm", 3, "/prazos"],
      ["untimed", 2, "/prazos#sem-prazo"],
      ["waiting", 3, "/atendimento?ver=esperando"],
      ["cancelled", 1, "/publicacoes?ver=canceladas"],
      ["publications", 9, "/publicacoes"],
      ["checks", 2, "/publicacoes?ver=conferir"],
      ["reading", 1, "/publicacoes#leitura"],
      ["skipped", 1, "/publicacoes"],
      ["recheck", 1, "/prazos?ver=rever"],
      ["approvals", 1, "/aprovacoes"],
      ["moved", 4, "/casos?ver=andamento"],
      ["drafts", 5, "/casos?ver=pecas"],
      ["filings", 2, "/protocolo?ver=prontos"],
      ["clients", 2, "/casos?ver=cliente-terminou"],
      ["civil", 1, "/casos?ver=vara-civel"],
      ["documents", 6, "/casos?ver=documentos"],
      ["contested", 1, "/casos?ver=cronologia"],
      ["complaints", 4, "/casos?ver=reclamacao"],
      ["failed", 3, "/atendimento?ver=falhou"],
    ]);
    expect(somethingForMe(needs)).toBe(true);
  });

  it("tells what waits for another function apart from what waits for this person", () => {
    const needs = todayNeeds({ ...quiet, approvalsMine: 0, approvalsWaiting: 4 });
    expect(needs).toEqual([{ key: "queue", count: 4, href: "/aprovacoes" }]);
    // Nothing here is for this person to do: the home still says the day is clear for them.
    expect(somethingForMe(needs)).toBe(false);
    expect(todayNeeds({ ...quiet, approvalsMine: 4, approvalsWaiting: 4 }).map((need) => need.key)).toEqual([
      "approvals",
    ]);
  });

  it("never counts a late reading of the DJEN as the firm's: it is ONE's own work (2026-11-05)", () => {
    // Where the DJEN is not read at all, every registration is late for good, and the firm has nothing to do.
    expect(todayNeeds({ ...quiet, djenLate: 3 })).toEqual([]);
    // What a person puts right stays: a reading that stopped for a lawyer on record, a communication left out.
    expect(todayNeeds({ ...quiet, djenLate: 3, djenStopped: 1, djenIncomplete: 2 })).toEqual([
      { key: "reading", count: 1, href: "/publicacoes#leitura" },
      { key: "skipped", count: 2, href: "/publicacoes" },
    ]);
  });

  it("shows what the courts published to who works on it, and to nobody else as theirs to do", () => {
    const today = { ...quiet, publicationsNew: 9, publicationsCancelled: 1, djenStopped: 2, conversationsWaiting: 1 };
    const everything = { triagesPublications: true, worksDeadlines: true, confirmsDeadlines: true, managesFirm: true };
    const answers = { triagesPublications: false, worksDeadlines: false, confirmsDeadlines: false, managesFirm: false };
    expect(todayNeeds(today, everything).map((need) => need.key)).toEqual([
      "waiting",
      "cancelled",
      "publications",
      "reading",
    ]);
    // Somebody who answers clients may not say what a publication is: it is not a count on their home.
    const theirs = todayNeeds(today, answers);
    expect(theirs.map((need) => need.key)).toEqual(["waiting"]);
    expect(somethingForMe(todayNeeds({ ...quiet, publicationsNew: 9 }, answers))).toBe(false);
  });

  it("shows the deadlines to who works on them, and the ones to confirm to who confirms", () => {
    const today = {
      ...quiet,
      deadlinesOverdue: 1,
      deadlinesSoon: 2,
      deadlinesToConfirm: 3,
      deadlinesReview: 4,
      publicationsWithoutDeadline: 5,
      publicationsWithoutHearing: 6,
    };
    const keys = (viewer: { triagesPublications: boolean; worksDeadlines: boolean; confirmsDeadlines: boolean }) =>
      todayNeeds(today, { ...viewer, managesFirm: false }).map((need) => need.key);
    expect(keys({ triagesPublications: true, worksDeadlines: true, confirmsDeadlines: true })).toEqual([
      "overdue",
      "due",
      "confirm",
      "untimed",
      "unwritten",
      "recheck",
    ]);
    // A lawyer works on deadlines and confirms none.
    expect(keys({ triagesPublications: true, worksDeadlines: true, confirmsDeadlines: false })).toEqual([
      "overdue",
      "due",
      "untimed",
      "unwritten",
      "recheck",
    ]);
    // Who answers clients does neither.
    expect(keys({ triagesPublications: false, worksDeadlines: false, confirmsDeadlines: false })).toEqual([]);
  });

  it("shows a calendar of hearings that stopped to who manages the firm, whatever their function", () => {
    const today = { ...quiet, calendarLost: 1 };
    const lawyer = { triagesPublications: true, worksDeadlines: true, confirmsDeadlines: false, managesFirm: false };
    expect(todayNeeds(today, lawyer)).toEqual([]);
    // A manager who answers clients brings it back: it is a connection of the firm.
    const manager = { triagesPublications: false, worksDeadlines: false, confirmsDeadlines: false, managesFirm: true };
    expect(todayNeeds(today, manager)).toEqual([{ key: "calendar", count: 1, href: "/settings/connections" }]);
  });

  it("shows the hearings whose client will not be told to anybody of the firm: anybody records the agreement", () => {
    const today = { ...quiet, hearingsUnwarned: 2 };
    const attendant = {
      triagesPublications: false,
      worksDeadlines: false,
      confirmsDeadlines: false,
      managesFirm: false,
    };
    expect(todayNeeds(today, attendant)).toEqual([{ key: "unwarned", count: 2, href: "/agenda" }]);
  });

  it("has words for every need", () => {
    for (const key of [
      "overdue",
      "due",
      "confirm",
      "untimed",
      "unwritten",
      "recheck",
      "hearings",
      "unwarned",
      "unresolved",
      "calendar",
      "closing",
      "waiting",
      "approvals",
      "clients",
      "documents",
      "contested",
      "complaints",
      "drafts",
      "filings",
      "publications",
      "checks",
      "cancelled",
      "reading",
      "skipped",
      "failed",
      "queue",
    ]) {
      expect(product[`today-need-${key}`], key).toBeTruthy();
      expect(product[`today-need-${key}-hint`], key).toBeTruthy();
    }
  });
});

describe("the firm's setup, from facts", () => {
  it("is the firm's, and lists only what the firm gives ONE, never ONE's own work", () => {
    expect(isOnboardingEnabled).toBe(true);
    expect(ONBOARDING_ORG_SCOPED).toBe(true);
    // Each step of the setup leads back to its own step of /configurar, never to another screen. The first case is
    // not one: a module brings it and ONE opens it (the owner, 2026-11-03).
    expect(buildOnboardingSteps().map((step) => [step.key, step.href])).toEqual([
      ["oab", "/configurar?passo=oab"],
      // The firm's documents and logo (0258), with the papers its clients sign (the owner, 2026-11-24).
      ["office", "/configurar?passo=escritorio"],
      // How the firm works and its areas (0256): ONE answers nobody new before the firm said them.
      ["operation", "/configurar?passo=operacao"],
      ["team", "/configurar?passo=equipe"],
      // How the firm files on the courts' screens (the owner's three ways, 2026-11-20), after its states, areas and
      // team are said (the owner, 2026-11-24).
      ["filing", "/configurar?passo=protocolo"],
      // The firm's profile, which ONE writes and the firm approves (0272).
      ["personality", "/configurar?passo=personalidade"],
      // The script of each area of the firm that no module serves, which ONE writes and the firm publishes (0273).
      ["areas", "/configurar?passo=areas"],
      ["channel", "/configurar?passo=canal"],
    ]);
    for (const step of buildOnboardingSteps()) expect(product[step.title], step.title).toBeTruthy();
  });

  it("opens on the second factor while the session has none, whatever was asked", () => {
    // Every step after it writes what the database asks the factor for: nothing past it can be met half way.
    expect(SETUP_STEPS[0]).toBe("seguranca");
    const fresh = { factorOk: false, asked: null, answered: false, firstMissing: "oab" as const };
    expect(setupOpening(fresh)).toEqual({ open: "seguranca", afterFactor: "oab" });
    expect(setupOpening({ ...fresh, asked: "canal" })).toEqual({ open: "seguranca", afterFactor: "canal" });
    expect(setupOpening({ ...fresh, asked: "seguranca" })).toEqual({ open: "seguranca", afterFactor: "oab" });
    expect(setupOpening({ ...fresh, firstMissing: "equipe" })).toEqual({ open: "seguranca", afterFactor: "equipe" });
    // With the factor, the step asked, else the first one past it for a setup answered before, else what is missing.
    const confirmed = { ...fresh, factorOk: true };
    expect(setupOpening({ ...confirmed, asked: "canal" }).open).toBe("canal");
    expect(setupOpening({ ...confirmed, answered: true, firstMissing: "canal" }).open).toBe("oab");
    expect(setupOpening({ ...confirmed, firstMissing: "canal" }).open).toBe("canal");
    expect(setupOpening({ ...confirmed, firstMissing: null }).open).toBe("oab");
    expect(setupOpening({ ...confirmed, asked: "seguranca" }).open).toBe("seguranca");
  });

  it("names steps of the setup the setup has", () => {
    for (const step of buildOnboardingSteps()) {
      const asked = new URL(step.href ?? "/", "https://one.invalid").searchParams.get("passo");
      if (asked !== null) expect(isSetupStep(asked), step.key).toBe(true);
    }
  });

  it("marks a step done when the thing exists, and never by a click", () => {
    const facts = {
      oab_signer: true,
      filing_way: true,
      brand: true,
      operation: true,
      team: false,
      personality: true,
      area_scripts: true,
      channel: true,
      first_case: false,
    };
    // oab, office, operation, team, filing, personality, areas, channel.
    expect(buildOnboardingSteps(facts).map((step) => step.done)).toEqual([
      true,
      true,
      true,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(isActivated(facts)).toBe(false);
    // A firm with no case yet is ready: the first case is ONE's to receive.
    expect(
      isActivated({
        oab_signer: true,
        filing_way: true,
        brand: true,
        operation: true,
        team: true,
        personality: true,
        area_scripts: true,
        channel: true,
        first_case: false,
      }),
    ).toBe(true);
    // A firm that never chose how it files on the courts' screens is not ready: the setup asks it (0263).
    expect(
      isActivated({
        oab_signer: true,
        filing_way: false,
        brand: true,
        operation: true,
        team: true,
        personality: true,
        area_scripts: true,
        channel: true,
        first_case: true,
      }),
    ).toBe(false);
    // A firm that never said how it works is not ready (the pilot finds it on its home, with nothing blocked).
    expect(isActivated({ oab_signer: true, operation: false, team: true, channel: true, first_case: true })).toBe(
      false,
    );
    // The Valor da Causa Pedido is the firm's to give or not (0064): a firm that gives none lacks nothing.
    expect(
      isActivated({
        oab_signer: true,
        filing_way: true,
        brand: true,
        operation: true,
        personality: true,
        area_scripts: true,
        claim_defaults: false,
        team: true,
        channel: true,
        first_case: true,
      }),
    ).toBe(true);
    // A fact the database did not answer is a step not done, never one assumed done.
    expect(isActivated({ oab_signer: true, team: true })).toBe(false);
  });

  it("says ONE waits for the first case, and only when the facts say no case came", () => {
    expect(waitsFirstCase({ first_case: false })).toBe(true);
    expect(waitsFirstCase({ first_case: true })).toBe(false);
    // Facts that could not be read, or that do not say, never claim the firm has no case.
    expect(waitsFirstCase(null)).toBe(false);
    expect(waitsFirstCase({})).toBe(false);
  });

  it("asks no team of a firm that works alone", () => {
    const alone = {
      oab_signer: true,
      filing_way: true,
      brand: true,
      operation: true,
      personality: true,
      area_scripts: true,
      team: false,
      works_alone: true,
      channel: true,
      first_case: true,
    };
    expect(buildOnboardingSteps(alone).map((step) => step.key)).toEqual([
      "oab",
      "office",
      "operation",
      "filing",
      "personality",
      "areas",
      "channel",
    ]);
    expect(isActivated(alone)).toBe(true);
  });

  it("asks no filing way of a firm that said ONE prepares no filing package (0285)", () => {
    const facts = {
      oab_signer: true,
      filing_way: false,
      files_without_one: true,
      brand: true,
      operation: true,
      team: true,
      personality: true,
      area_scripts: true,
      channel: true,
      first_case: true,
    };
    expect(buildOnboardingSteps(facts).map((step) => step.key)).not.toContain("filing");
    expect(isActivated(facts)).toBe(true);
  });

  it("opens a step that was merged into another where its things are now", () => {
    // The papers a client signs joined the office's step (the owner, 2026-11-24): a link kept from before still works.
    expect(setupStepOf("papeis")).toBe("escritorio");
    expect(setupStepOf("protocolo")).toBe("protocolo");
    expect(setupStepOf("nada")).toBeNull();
    expect(setupStepOf(undefined)).toBeNull();
    expect(SETUP_STEPS).not.toContain("papeis");
  });

  it("knows whether the first questions were answered", () => {
    expect(isSetupAnswered({ setup_answered: true })).toBe(true);
    expect(isSetupAnswered({ setup_answered: false })).toBe(false);
    expect(isSetupAnswered({})).toBe(false);
  });
});
