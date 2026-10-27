"use server";

import { revalidatePath } from "next/cache";

import { requireSuperadmin } from "@/lib/admin/session";
import { sendEvent } from "@flyee/jobs";

/**
 * The operator's answer to a court system the firms did not approve (migration 0066): confirm the row of the table
 * as it is, checked against the court's acts, or change its system, saying where it was read. Both go through
 * `admin_set_court_system` (0036), which checks the role, keeps the record and, since 0066, has the planned lawsuits
 * of that court and kind take the row again: the firms are asked to approve once more. What the row holds besides
 * is kept: its start, its notes and, for the same system, its limit (another system's limit is not known yet).
 *
 * A server action is a public endpoint: the role is checked here again.
 */

export type CourtSystemResult = { ok: true } | { ok: false; code: string };

const COURT = /^TJ[A-Z]{2,3}$/;
const KINDS = ["juizado", "comum"] as const;
const SYSTEMS = ["projudi", "eproc", "pje", "esaj", "outro"] as const;

type Row = {
  system: string;
  since: string | null;
  max_file_bytes: number | null;
  source: string;
  notes: string | null;
};

export async function answerCourtSystem(input: {
  court: string;
  kind: string;
  /** The system the row has from now on: the same one to confirm it, another to change it. */
  system: string;
  /** Where the operator read it: the court's act, at least 8 characters. */
  source: string;
}): Promise<CourtSystemResult> {
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  if (
    !COURT.test(input?.court ?? "") ||
    !(KINDS as readonly string[]).includes(input?.kind ?? "") ||
    !(SYSTEMS as readonly string[]).includes(input?.system ?? "")
  ) {
    return { ok: false, code: "invalid_value" };
  }
  const source = String(input.source ?? "").trim();
  if (source.length < 8) return { ok: false, code: "source_required" };

  const { data: row, error: rowError } = await session.supabase
    .from("court_systems")
    .select("system, since, max_file_bytes, source, notes")
    .eq("court", input.court)
    .eq("proceeding_kind", input.kind)
    .maybeSingle();
  if (rowError) return { ok: false, code: "failed" };
  const current = row as Row | null;
  const same = current?.system === input.system;
  const { data, error } = await session.supabase.rpc("admin_set_court_system", {
    target_court: input.court,
    target_kind: input.kind,
    target_system: input.system,
    target_since: current?.since ?? null,
    target_max_file_bytes: same ? (current?.max_file_bytes ?? null) : null,
    target_source: source,
    target_notes: current?.notes ?? null,
    target_confirmed: true,
  });
  if (error) return { ok: false, code: "failed" };
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (!answer.ok) return { ok: false, code: String(answer.code ?? "failed") };
  revalidatePath("/admin/calendario");
  // The cases of those lawsuits are looked at again by the database; the jobs are asked to look now.
  await sendEvent("one/case.advance", { caseId: null }).catch(() => undefined);
  return { ok: true };
}
