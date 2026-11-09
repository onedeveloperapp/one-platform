import "server-only";

import type { CasesState } from "../casos/cases-types";
import { loadCases } from "../casos/load-cases";

import { momentLabel } from "@/lib/ai/approvals";
import { BOARD_PAGE, type BoardColumn } from "@/lib/cases/board";
import { readCaseBoard, readCaseStock } from "@/lib/cases/list-read";
import type { CaseStock } from "@/lib/cases/standing";
import { testCaseFactsOf, testCasesAsked, type TestCaseScope, testCaseScope } from "@/lib/cases/test-cases";
import type { ClosingGoals } from "@/lib/controladoria/goals";
import { readClosingGoals } from "@/lib/controladoria/goals-read";
import { isCourtTrackingOn } from "@/lib/courts/tracking";
import { overseesFirm } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import type { ModuleCard } from "@/lib/modules/offer";
import { pageScopeOf } from "@/lib/modules/offer";

export type ControladoriaState =
  | {
      kind: "ready";
      cases: Extract<CasesState, { kind: "ready" }>;
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
    }
  | { kind: "not-allowed" }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/**
 * What `/controladoria` reads, under the person's own session: the list of cases, as `/casos` reads it, and the
 * stock of the firm (of a module, or of every one). For a partner, the controladoria or who manages the firm: the
 * page is theirs, and anybody else is told so, with nothing read for it. It is read when it opens and on
 * "Atualizar", and says when.
 */
export async function loadControladoria(params: {
  ver?: string;
  modulo?: string;
  testes?: string;
}): Promise<ControladoriaState> {
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
  // The stock of the page's scope is the list's own (`loadCases` reads it once); each module's, for the card of the
  // modules, only where there is more than one and none was chosen.
  const [cases, board, goals, perModule] = await Promise.all([
    loadCases({ ver: params.ver, modulo: params.modulo, tests }),
    readCaseBoard(supabase, firm, { module: current?.key ?? null, limit: BOARD_PAGE, tests }),
    readClosingGoals(supabase, firm, current?.key ?? null),
    !current && modules.length > 1
      ? Promise.all(modules.map((module) => readCaseStock(supabase, firm, { module: module.key, tests })))
      : Promise.resolve(null),
  ]);
  if (cases.kind !== "ready") return cases;
  return {
    kind: "ready",
    cases,
    stock: cases.stock,
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
  };
}
