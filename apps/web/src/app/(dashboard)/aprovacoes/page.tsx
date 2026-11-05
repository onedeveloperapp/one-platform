import ApprovalsView from "./components/approvals-view";
import { cookies } from "next/headers";

import {
  type ApprovalsState,
  DECIDED_SHOWN,
  type DecidedApproval,
  momentLabel,
  PENDING_PAGE,
  type SecondFactorState,
} from "@/lib/ai/approvals";
import { PENDING_APPROVAL_COLUMNS, pendingApprovalsOf, type PendingRow } from "@/lib/ai/pending-approvals";
import { DRAFT_TASK } from "@/lib/cases/drafts";
import { getMemberContext } from "@/lib/member/context";
import { pageScopeOf } from "@/lib/modules/offer";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

type Embedded<T> = T | T[] | null;

type DecidedRow = {
  id: string;
  task: string;
  status: string;
  edited: boolean;
  decided_auto: boolean | null;
  decided_by: string | null;
  decided_at: string;
  decision_note: string | null;
  ai_tasks: Embedded<{ name: string }>;
};

type TeamRow = { user_id: string; display_name: string | null; email: string | null };

const one = <T,>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

/**
 * /aprovacoes: every decision the firm left to a person, of every case, in one list for whoever reviews many in a
 * row (the owner, 2026-11-05). Each one is also decided where it belongs (the check of a document on its case's
 * documents, the order of the facts on its case's account, ONE's answer in its conversation), which is where the
 * home and the center of what waits lead; this list is reached from the center's "Ver todas" and is out of the
 * main menu. The text of a piece is never here: it is approved only on its case, as the text a lawyer just read.
 * Everything is read under the person's own session: row-level security shows the queue of their firm only, and
 * the decision itself is the database's (`decide_approval`, migration 0016), which asks for the function the task
 * names and for the second factor. `?modulo=` keeps the queue to the answers about the cases of one module
 * (`firm_module_approvals`, migration 0078).
 */
async function loadApprovals(modulo: string | undefined): Promise<ApprovalsState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };

  const firm = context.firm;
  const { supabase } = context;
  const scope = pageScopeOf(context.catalog, context.modules, modulo);
  const module = scope.current?.key ?? null;
  // Under a module, the database names the answers of it first: the ones that wait, with how many, and the latest
  // decided. The queue then reads them as it reads every one.
  const [ofModuleWaiting, ofModuleDecided] = module
    ? await Promise.all([
        supabase.rpc("firm_module_approvals", {
          target_org: firm.id,
          target_module: module,
          target_decided: false,
          target_limit: PENDING_PAGE,
        }),
        supabase.rpc("firm_module_approvals", {
          target_org: firm.id,
          target_module: module,
          target_decided: true,
          target_limit: DECIDED_SHOWN,
        }),
      ])
    : [null, null];
  if (ofModuleWaiting?.error || ofModuleDecided?.error) return { kind: "error" };
  const idsOf = (answer: { data: unknown } | null): string[] | null => {
    if (!answer) return null;
    const ids = (answer.data as { ids?: unknown } | null)?.ids;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  };
  const waitingIds = idsOf(ofModuleWaiting);
  const decidedIds = idsOf(ofModuleDecided);
  const moduleTotal = (ofModuleWaiting?.data as { total?: unknown } | null)?.total;
  // The hours are written here, on the person's own clock, and handed over as
  // text: the browser never formats a date the server formatted differently.
  const timeZone = context.profile.timezone;

  // The text of a piece waits on its case, never here.
  const waitingQuery = supabase
    .from("approvals")
    .select(PENDING_APPROVAL_COLUMNS, { count: "exact" })
    .eq("org_id", firm.id)
    .eq("status", "pending")
    .neq("task", DRAFT_TASK);
  const decidedQuery = supabase
    .from("approvals")
    .select("id, task, status, edited, decided_auto, decided_by, decided_at, decision_note, ai_tasks(name)")
    .eq("org_id", firm.id)
    .in("status", ["approved", "rejected", "returned"]);
  const [pending, decided, team, assurance, cookieStore] = await Promise.all([
    (waitingIds ? waitingQuery.in("id", waitingIds) : waitingQuery)
      .order("created_at", { ascending: true })
      .limit(PENDING_PAGE),
    (decidedIds ? decidedQuery.in("id", decidedIds) : decidedQuery)
      .order("decided_at", { ascending: false })
      .limit(DECIDED_SHOWN),
    supabase.rpc("firm_team", { target_org: firm.id }),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
  ]);
  if (pending.error || decided.error || team.error) return { kind: "error" };

  const names = new Map(
    ((team.data ?? []) as TeamRow[]).map((row) => [
      row.user_id,
      row.display_name?.trim() || row.email?.split("@")[0] || "",
    ]),
  );

  const waiting = await pendingApprovalsOf({
    supabase,
    firmId: firm.id,
    timeZone,
    names,
    rows: (pending.data ?? []) as PendingRow[],
  });
  if (!waiting) return { kind: "error" };

  const recent: DecidedApproval[] = ((decided.data ?? []) as DecidedRow[]).map((row) => ({
    id: row.id,
    taskName: one(row.ai_tasks)?.name ?? row.task,
    status: row.status === "rejected" ? "rejected" : row.status === "returned" ? "returned" : "approved",
    edited: Boolean(row.edited),
    decidedAuto: row.decided_auto === true,
    decidedByName: (row.decided_by && names.get(row.decided_by)) || null,
    decidedLabel: momentLabel(row.decided_at, timeZone),
    note: row.decision_note,
  }));

  // `nextLevel` is aal2 exactly when the account has a verified factor;
  // `currentLevel` is aal2 when this session already confirmed it.
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";

  return {
    kind: "ready",
    firm: { id: firm.id, name: firm.name },
    me: { firmFunction: firm.firmFunction },
    pending: waiting,
    // Under a module, how many of it wait, as the database counted them, less the pieces it named (never here).
    pendingTotal: module
      ? typeof moduleTotal === "number"
        ? Math.max(waiting.length, moduleTotal - ((waitingIds?.length ?? 0) - waiting.length))
        : waiting.length
      : (pending.count ?? waiting.length),
    decided: recent,
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    scope,
  };
}

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const modulo = Array.isArray(query.modulo) ? query.modulo[0] : query.modulo;
  return <ApprovalsView state={await loadApprovals(modulo)} />;
}
