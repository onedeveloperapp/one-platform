import type { JourneyStepId } from "@/lib/cases/journey";
import type { CaseSection } from "@/lib/cases/sections";

/**
 * The case screen in tabs (the owner, 2026-11-25, on the canvas "ONE · O caso em abas"): the top of the case stays
 * above them, and its cards are in six tabs in the order of the case's way. Pure: which tab each card is in, the tab
 * the screen opens on, and what each tab says of what waits in it. Nothing here decides anything of the case.
 */
export const CASE_TABS = ["cliente", "documentos", "acao", "processo", "dinheiro", "historico"] as const;
export type CaseTab = (typeof CASE_TABS)[number];
export const isCaseTab = (value: unknown): value is CaseTab => (CASE_TABS as readonly unknown[]).includes(value);

/** The tab of each card that the top knows (a section). The cards outside the sections are placed by the screen. */
export const SECTION_TAB: Record<CaseSection, CaseTab> = {
  people: "cliente",
  trip: "cliente",
  statements: "cliente",
  link: "cliente",
  notices: "cliente",
  documents: "documentos",
  signatures: "documentos",
  dossier: "documentos",
  rules: "acao",
  complaints: "acao",
  proceedings: "acao",
  drafts: "acao",
  filing: "acao",
  publications: "processo",
  deadlines: "processo",
  hearings: "processo",
  pieces: "processo",
  summary: "historico",
  timeline: "historico",
};

/** The tab of each step of the case's way: where the work of the step is. */
export const STEP_TAB: Record<JourneyStepId, CaseTab> = {
  intake: "cliente",
  documents: "documentos",
  signature: "documentos",
  drafting: "acao",
  filing: "acao",
  hearing: "processo",
  judgment: "processo",
  payment: "dinheiro",
  closed: "historico",
};

/** A line of the top as the tabs read it: whose it is, how it stands, and the card it is worked in. */
export type TabLine = {
  owner: "client" | "firm" | "one" | "platform";
  tone: "failed" | "attention" | "waiting" | "info";
  section: CaseSection | null;
};

/**
 * The tab the screen opens on: the one the address asks for; else the tab of the first thing that waits for the firm,
 * in the order the top lists them, so its "Resolver" and the open tab agree; else the tab of the step the case is at.
 * Read once on arrival: the screen never moves the person to another tab while they read.
 */
export function openingTab(asked: unknown, blocking: readonly TabLine[], step: JourneyStepId): CaseTab {
  if (isCaseTab(asked)) return asked;
  const first = blocking.find((line) => line.owner === "firm" && line.section !== null);
  return first?.section ? SECTION_TAB[first.section] : STEP_TAB[step];
}

/** What a tab says under its name, the heaviest first: a failure, the firm's turn, ONE at work, the client's turn. */
export type TabMark = { tone: "failed" | "firm" | "working" | "client"; count: number };

/** What waits in each tab, counted by the lines of the top (two things in one card are two). */
export function tabMarks(blocking: readonly TabLine[], working: readonly TabLine[]): Record<CaseTab, TabMark | null> {
  const tally = Object.fromEntries(
    CASE_TABS.map((tab) => [tab, { failed: 0, firm: 0, working: 0, client: 0 }]),
  ) as Record<CaseTab, Record<TabMark["tone"], number>>;
  for (const line of blocking) {
    if (!line.section) continue;
    const of = tally[SECTION_TAB[line.section]];
    if (line.owner === "firm") of[line.tone === "failed" ? "failed" : "firm"] += 1;
    else if (line.owner === "client") of.client += 1;
  }
  for (const line of working) if (line.section) tally[SECTION_TAB[line.section]].working += 1;
  return Object.fromEntries(
    CASE_TABS.map((tab) => {
      const of = tally[tab];
      const tone = (["failed", "firm", "working", "client"] as const).find((kind) => of[kind] > 0);
      return [tab, tone ? { tone, count: of[tone] } : null];
    }),
  ) as Record<CaseTab, TabMark | null>;
}

/** The address of the case on a tab: the tab in `?aba=`, and the card the person was sent to kept after it. */
export function tabAddress(path: string, tab: CaseTab, hash = ""): string {
  return `${path}?aba=${tab}${hash}`;
}
