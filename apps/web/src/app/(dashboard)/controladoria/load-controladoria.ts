import "server-only";

import { cookies } from "next/headers";

import { momentLabel } from "@/lib/ai/approvals";
import { BOARD_PAGE, type BoardColumn } from "@/lib/cases/board";
import type { CaseCounts, CaseNumbers } from "@/lib/cases/list";
import { readCaseBoard, readCaseList, readCaseStock } from "@/lib/cases/list-read";
import type { CaseStock } from "@/lib/cases/standing";
import { testCaseFactsOf, testCasesAsked, type TestCaseScope, testCaseScope } from "@/lib/cases/test-cases";
import type { ClosingGoals } from "@/lib/controladoria/goals";
import { readClosingGoals } from "@/lib/controladoria/goals-read";
import { isCourtTrackingOn } from "@/lib/courts/tracking";
import { overseesFirm } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { type ModuleCard, pageScopeOf } from "@/lib/modules/offer";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

export type ControladoriaState =
  | {
      kind: "ready";
      /** The numbers of the cards, each beside the same days of the month before (0108); null when unsaid. */
      numbers: CaseNumbers | null;
      /** How many cases each view of the list holds (`firm_cases`): the court's numbers are among them. */
      counts: CaseCounts;
      /** The modules the firm contracted, for the choice above the page, and the one the page is of. */
      modules: ModuleCard[];
      module: ModuleCard | null;
      /**
       * The stock (`firm_case_stock`, migration 0111): each step with its cases, the stagnant ones and their days,
       * and who has the cases, by the rule of the top of the case. Null when the database did not say.
       */
      stock: CaseStock | null;
      /**
       * The board by step (`firm_case_board`, 0112): each column with its first cases, the longest at the step first.
       * Null when the database did not say it.
       */
      board: BoardColumn[] | null;
      /** The closing goals (`firm_closing_goals`, 0113), of the page's module or of every one; null when unread. */
      goals: ClosingGoals | null;
      /** Whether the page's numbers count the firm's test cases (0114), and how it says so. */
      testCases: TestCaseScope;
      /** The cases going in each module, for a firm with more than one and no module chosen. */
      byModule: { module: ModuleCard; going: number }[] | null;
      /** When this page was read, on the person's clock. */
      readLabel: string;
      /** Whether this environment reads the courts (`COURT_TRACKING`); the test court is read anywhere. */
      courtRead: boolean;
      /** The firm's name, which the file of the whole portfolio says. */
      firmName: string;
      /** Whether the person may take the whole portfolio (0117): who decides for the firm, never a support visit. */
      takesPortfolio: boolean;
      /** Where the session's second factor stands, which the whole portfolio asks. */
      factor: "ok" | "challenge" | "missing";
    }
  | { kind: "not-allowed" }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/**
 * What `/controladoria` reads, under the person's own session: the numbers and counts of the firm's list of cases
 * (`firm_cases`, one row read: the list itself is `/casos`'s, which each number opens), the stock and the board by
 * step, the goals (of a module, or of every one). For a partner, the controladoria or who manages the firm: the page
 * is theirs, and anybody else is told so, with nothing read for it. It is read when it opens and on "Atualizar",
 * and says when.
 */
export async function loadControladoria(params: { modulo?: string; testes?: string }): Promise<ControladoriaState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  if (!overseesFirm(context.firm.role, context.firm.firmFunction)) return { kind: "not-allowed" };

  const { supabase } = context;
  const firm = context.firm.id;
  const { modules, current } = pageScopeOf(context.catalog, context.modules, params.modulo);
  // Whether the page counts the test cases decides every read after it (0114).
  const facts = await supabase.rpc("firm_test_cases", { target_org: firm, target_module: current?.key ?? null });
  const testCases = testCaseScope(facts.error ? null : testCaseFactsOf(facts.data), testCasesAsked(params.testes));
  const tests = testCases.counted;
  // The numbers and counts of the list (one row of it), the stock and the board of the page's scope; each module's
  // stock, for the card of the modules, only where there is more than one and none was chosen.
  const module = current?.key ?? null;
  const [list, stock, board, goals, perModule, decides, assurance, cookieStore] = await Promise.all([
    readCaseList(supabase, firm, { filter: null, search: "", module, page: 0, pageSize: 1, tests }),
    readCaseStock(supabase, firm, { module, tests }),
    readCaseBoard(supabase, firm, { module: current?.key ?? null, limit: BOARD_PAGE, tests }),
    readClosingGoals(supabase, firm, current?.key ?? null),
    !current && modules.length > 1
      ? Promise.all(modules.map((module) => readCaseStock(supabase, firm, { module: module.key, tests })))
      : Promise.resolve(null),
    supabase.rpc("decides_for_firm", { target_org: firm }),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
  ]);
  if (!list) return { kind: "error" };
  return {
    kind: "ready",
    numbers: list.numbers,
    counts: list.counts,
    modules,
    module: current,
    stock,
    board,
    goals,
    testCases,
    byModule: perModule
      ? modules.flatMap((module, at) => {
          const read = perModule[at];
          return read ? [{ module, going: read.total }] : [];
        })
      : null,
    readLabel: momentLabel(new Date().toISOString(), context.profile.timezone),
    courtRead: isCourtTrackingOn(),
    firmName: context.firm.name,
    takesPortfolio: !decides.error && decides.data === true && !cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    factor:
      assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing",
  };
}
