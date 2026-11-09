"use server";

import { goalInputOf } from "@/lib/controladoria/goals";
import { getMemberContext } from "@/lib/member/context";

/** What came of a save or an archive: its goal, or the code of what went wrong (`goalErrorKey`). */
export type GoalResult = { ok: true; id: string | null } | { ok: false; code: string };

const codeOf = (data: unknown): string => {
  const code = typeof data === "object" && data !== null ? (data as { code?: unknown }).code : null;
  return typeof code === "string" ? code : "failed";
};

/**
 * Creates a closing goal, or changes one (migration 0113). The database decides who may (a partner or the
 * controladoria, never a support visit), checks the module and the agency, and puts the change on the record.
 */
export async function saveClosingGoal(input: unknown): Promise<GoalResult> {
  const read = goalInputOf(input);
  if (!read.ok) return { ok: false, code: read.field };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { goal } = read;
  const { data, error } = await context.supabase.rpc("save_closing_goal", {
    target_org: context.firm.id,
    target_goal: goal.id,
    target_starts_on: goal.startsOn,
    target_ends_on: goal.endsOn,
    target_module: goal.module,
    target_incident: goal.incident,
    target_origin: goal.origin,
    target_partnership: goal.partnership,
    target_target: goal.target,
  });
  if (error) return { ok: false, code: error.code === "23514" ? "period" : "failed" };
  const answer = (data ?? {}) as { ok?: unknown; id?: unknown };
  return answer.ok === true
    ? { ok: true, id: typeof answer.id === "string" ? answer.id : null }
    : { ok: false, code: codeOf(data) };
}

/** Archives a goal with the reason, or brings an archived one back (`reason` null), on the record (0113). */
export async function archiveClosingGoal(input: unknown): Promise<GoalResult> {
  const value = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const id = typeof value.id === "string" && /^[0-9a-f-]{36}$/i.test(value.id) ? value.id : null;
  const reason = typeof value.reason === "string" ? value.reason.trim().slice(0, 300) : null;
  if (!id) return { ok: false, code: "failed" };
  const context = await getMemberContext();
  if (!context?.firm) return { ok: false, code: "failed" };
  const { data, error } = await context.supabase.rpc("archive_closing_goal", {
    target_org: context.firm.id,
    target_goal: id,
    target_reason: reason,
  });
  if (error) return { ok: false, code: "failed" };
  return (data as { ok?: unknown } | null)?.ok === true ? { ok: true, id } : { ok: false, code: codeOf(data) };
}
