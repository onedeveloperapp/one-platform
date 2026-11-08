import "server-only";

import type { CasesState } from "../casos/cases-types";
import { loadCases } from "../casos/load-cases";

import { momentLabel } from "@/lib/ai/approvals";
import { OPEN_STEPS } from "@/lib/cases/journey";
import { type JourneyOverview, readCaseJourney } from "@/lib/cases/journey-read";
import { isCourtTrackingOn } from "@/lib/courts/tracking";
import { overseesFirm } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import type { ModuleCard } from "@/lib/modules/offer";
import { pageScopeOf } from "@/lib/modules/offer";

export type ControladoriaState =
  | {
      kind: "ready";
      cases: Extract<CasesState, { kind: "ready" }>;
      /** How many cases are at each step of their way; null when the database did not say. */
      journey: JourneyOverview | null;
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

const goingOf = (journey: JourneyOverview): number =>
  OPEN_STEPS.reduce((total, step) => total + journey.steps[step], 0);

/**
 * What `/controladoria` reads, under the person's own session: the list of cases, as `/casos` reads it, and how many
 * cases are at each step of their way. For a partner, the controladoria or who manages the firm: the page is theirs,
 * and anybody else is told so, with nothing read for it. It is read when it opens and on "Atualizar", and says when.
 */
export async function loadControladoria(params: { ver?: string; modulo?: string }): Promise<ControladoriaState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  if (!overseesFirm(context.firm.role, context.firm.firmFunction)) return { kind: "not-allowed" };

  const { supabase } = context;
  const firm = context.firm.id;
  const { modules, current } = pageScopeOf(context.catalog, context.modules, params.modulo);
  const [cases, journey, perModule] = await Promise.all([
    loadCases({ ver: params.ver, modulo: params.modulo }),
    readCaseJourney(supabase, firm, current?.key ?? null),
    !current && modules.length > 1
      ? Promise.all(modules.map((module) => readCaseJourney(supabase, firm, module.key)))
      : Promise.resolve(null),
  ]);
  if (cases.kind !== "ready") return cases;
  return {
    kind: "ready",
    cases,
    journey,
    byModule: perModule
      ? modules.flatMap((module, at) => {
          const read = perModule[at];
          return read ? [{ module, going: goingOf(read) }] : [];
        })
      : null,
    readLabel: momentLabel(new Date().toISOString(), context.profile.timezone),
    courtRead: isCourtTrackingOn(),
  };
}
