import "server-only";

import { cookies } from "next/headers";

import type { ClosingGoals } from "@/lib/controladoria/goals";
import { readClosingGoals } from "@/lib/controladoria/goals-read";
import { overseesFirm } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import type { ModuleCard } from "@/lib/modules/offer";
import { pageScopeOf } from "@/lib/modules/offer";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

/** A partnership of the firm a goal may be of: its agency by name, its module, and whether it ended. */
export type GoalPartnership = { id: string; name: string; module: string; ended: boolean };

export type GoalsState =
  | {
      kind: "ready";
      goals: ClosingGoals;
      /** The modules the firm contracted, and the one the page is of (null for every module). */
      modules: ModuleCard[];
      scope: ModuleCard | null;
      partnerships: GoalPartnership[];
      supportVisit: boolean;
      /** The panel of a new goal opens as the page opens (`?nova=1`, from the controladoria's card). */
      create: boolean;
    }
  | { kind: "not-allowed" }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * What `/controladoria/metas` reads, under the person's own session: the firm's closing goals (of a module, or of
 * every one) and the partnerships a goal may be of. The page is the controladoria's (a partner, the controladoria,
 * who manages the firm); who may change a goal is the database's to say.
 */
export async function loadGoals(params: { modulo?: string; nova?: string }): Promise<GoalsState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  if (!overseesFirm(context.firm.role, context.firm.firmFunction)) return { kind: "not-allowed" };
  const { supabase } = context;
  const firm = context.firm.id;
  const { modules, current } = pageScopeOf(context.catalog, context.modules, params.modulo);
  const [goals, links, cookieStore] = await Promise.all([
    readClosingGoals(supabase, firm, current?.key ?? null),
    supabase.rpc("firm_partners", { target_org: firm }),
    cookies(),
  ]);
  if (!goals || links.error) return { kind: "error" };
  const partnerships = ((links.data ?? []) as Record<string, unknown>[]).flatMap((row): GoalPartnership[] => {
    const id = text(row.link_id);
    const module = text(row.module);
    if (!id || !module || (current && module !== current.key)) return [];
    return [{ id, name: text(row.partner) ?? "", module, ended: row.status === "ended" }];
  });
  return {
    kind: "ready",
    goals,
    modules,
    scope: current ?? null,
    partnerships,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    create: params.nova === "1" && goals.mayManage,
  };
}
